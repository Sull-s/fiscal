import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import { documento as formatarDocumento } from "../formato";
import { type DadosDanfse, lerDanfse } from "./ler";
import { LOGO_NFSE_PNG_BASE64 } from "./logo-nfse";

/** Consulta pública da NFS-e pela chave: é o conteúdo do QR Code. */
export const URL_CONSULTA_NFSE = "https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave=";

const OP_SIMPLES: Record<string, string> = {
  "1": "Não Optante",
  "2": "Optante - Microempreendedor Individual (MEI)",
  "3": "Optante - Microempresa ou Empresa de Pequeno Porte",
};
const REG_APUR_SN: Record<string, string> = {
  "1": "Federais e Municipal",
  "2": "Federais",
  "3": "Municipal",
};
const TRIB_ISSQN: Record<string, string> = {
  "1": "Operação Tributável",
  "2": "Exportação de Serviço",
  "3": "Não Incidência",
  "4": "Imunidade",
};
const RET_ISSQN: Record<string, string> = {
  "1": "Não Retido",
  "2": "Retido pelo Tomador",
  "3": "Retido pelo Intermediário",
};
const TP_EMIT: Record<string, string> = { "1": "Prestador", "2": "Tomador", "3": "Intermediário" };
// cStat 107 acompanha as notas de MEI; 100 é a geração comum
const SITUACAO: Record<string, string> = { "100": "NFS-e", "107": "NFS-e MEI" };

const cep = (v: string) => (/^\d{8}$/.test(v) ? v.replace(/(\d{5})(\d{3})/, "$1-$2") : v);
function fone(v: string) {
  const d = v.replace(/\D/g, "");
  if (d.length === 11) return d.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3");
  if (d.length === 10) return d.replace(/(\d{2})(\d{4})(\d{4})/, "($1) $2-$3");
  return v;
}
function reais(v: string) {
  if (!v) return "";
  const [inteiro = "0", dec = "00"] = Number(v).toFixed(2).split(".");
  return `R$ ${inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${dec}`;
}
const dataHora = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}:${m[6]}` : iso;
};
const data = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
};
const codTrib = (c: string) =>
  c.length === 6 ? `${c.slice(0, 2)}.${c.slice(2, 4)}.${c.slice(4)}` : c;
// "Nome - UF", o formato do cabeçalho do DANFSE oficial
const municipioUF = (m: string) => m.replace("/", " - ");

// ---- desenho

const A4 = { w: 595.28, h: 841.89 };
const M = 22;
const LARG = A4.w - 2 * M;
const CINZA = "#f0f0f0";
const BORDA = "#999";

type Doc = PDFKit.PDFDocument;
interface Campo {
  rot: string;
  val: string;
  /** Fração da largura útil (a soma da faixa precisa dar 1) */
  f: number;
  forte?: boolean;
  tam?: number;
}

function tituloSecao(doc: Doc, y: number, titulo: string) {
  doc.rect(M, y, LARG, 13).fillAndStroke(CINZA, BORDA);
  doc
    .fillColor("#000")
    .font("Helvetica-Bold")
    .fontSize(7)
    .text(titulo, M + 4, y + 3.8);
  return y + 13;
}

function faixa(doc: Doc, y: number, campos: Campo[], altura = 22) {
  let x = M;
  for (const c of campos) {
    const w = LARG * c.f;
    doc.rect(x, y, w, altura).stroke(BORDA);
    doc
      .font("Helvetica")
      .fontSize(5.2)
      .fillColor("#666")
      .text(c.rot.toUpperCase(), x + 3, y + 2.5, { width: w - 6, lineBreak: false });
    doc
      .font(c.forte ? "Helvetica-Bold" : "Helvetica")
      .fontSize(c.tam ?? 7.2)
      .fillColor("#000")
      .text(c.val || "-", x + 3, y + 9.5, { width: w - 6, height: altura - 11, ellipsis: true });
    x += w;
  }
  return y + altura;
}

function paragrafo(doc: Doc, y: number, rotulo: string, valor: string, altura = 26) {
  doc.rect(M, y, LARG, altura).stroke(BORDA);
  if (rotulo) {
    doc
      .font("Helvetica")
      .fontSize(5.2)
      .fillColor("#666")
      .text(rotulo.toUpperCase(), M + 3, y + 2.5, { width: LARG - 6, lineBreak: false });
  }
  doc
    .font("Helvetica")
    .fontSize(7)
    .fillColor("#000")
    .text(valor || "-", M + 3, y + (rotulo ? 9.5 : 4), {
      width: LARG - 6,
      height: altura - (rotulo ? 11 : 6),
      ellipsis: true,
    });
  return y + altura;
}

export interface OpcoesDanfse {
  /** Nome do sistema emissor nos metadados do PDF */
  criador?: string;
  /** Comprimir o conteúdo do PDF (padrão true; false só para inspecionar/testar) */
  comprimir?: boolean;
}

/**
 * DANFSE v2.0 (uma página A4) a partir do XML da NFS-e Nacional.
 * Desde a NT 008/2026 o PDF oficial foi descontinuado: o documento auxiliar é do emitente.
 */
export async function gerarDanfse(
  xmlNfse: string | DadosDanfse,
  opcoes: OpcoesDanfse = {},
): Promise<Buffer> {
  const d = typeof xmlNfse === "string" ? lerDanfse(xmlNfse) : xmlNfse;
  const qrPng = await QRCode.toBuffer(URL_CONSULTA_NFSE + d.chave, {
    margin: 0,
    scale: 8,
    errorCorrectionLevel: "M",
  });

  const doc = new PDFDocument({
    size: "A4",
    margin: 0,
    compress: opcoes.comprimir ?? true,
    info: {
      Title: `DANFSe ${d.nNFSe} - ${d.chave}`,
      Author: d.prestador.nome,
      Creator: opcoes.criador ?? "@fiscal/documentos",
    },
  });
  const pedacos: Buffer[] = [];
  doc.on("data", (c: Buffer) => pedacos.push(c));
  const pronto = new Promise<Buffer>((ok) => doc.on("end", () => ok(Buffer.concat(pedacos))));

  let y = M;

  // Cabeçalho: logo | título | ambiente
  const alturaTopo = 40;
  doc.rect(M, y, LARG, alturaTopo).stroke(BORDA);
  const logoLarg = 78;
  const logoAlt = logoLarg * (48.502 / 231.505);
  doc.image(Buffer.from(LOGO_NFSE_PNG_BASE64, "base64"), M + 8, y + (alturaTopo - logoAlt) / 2, {
    width: logoLarg,
    height: logoAlt,
  });
  const ambLarg = 140;
  const ambX = M + LARG - ambLarg - 8;
  const tituloX = M + 8 + logoLarg + 8;
  const tituloLarg = ambX - tituloX - 8;
  doc
    .font("Helvetica-Bold")
    .fontSize(11)
    .fillColor("#000")
    .text("DANFSe", tituloX, y + 10, { width: tituloLarg, align: "center" });
  doc
    .font("Helvetica")
    .fontSize(6.8)
    .text("Documento Auxiliar da NFS-e", tituloX, y + 23, { width: tituloLarg, align: "center" });
  doc
    .font("Helvetica")
    .fontSize(6.3)
    .fillColor("#333")
    .text(`Município: ${municipioUF(d.prestador.municipio) || d.municipioEmissor}`, ambX, y + 6, {
      width: ambLarg,
      align: "center",
    })
    .text(`Ambiente Gerador: ${d.ambGer}`, ambX, y + 16, { width: ambLarg, align: "center" })
    .text(`Tipo de Ambiente: ${d.tpAmb}`, ambX, y + 26, { width: ambLarg, align: "center" });
  y += alturaTopo;

  // Chave de acesso | QR Code com o texto de autenticidade
  const alturaChave = 40;
  doc.rect(M, y, LARG, alturaChave).stroke(BORDA);
  const qrLado = 34;
  const textoLarg = 96;
  const qrX = M + LARG - qrLado - 8;
  const textoX = qrX - textoLarg - 8;
  const divisorX = textoX - 8;
  doc
    .moveTo(divisorX, y)
    .lineTo(divisorX, y + alturaChave)
    .stroke(BORDA);
  doc.image(qrPng, qrX, y + (alturaChave - qrLado) / 2, { width: qrLado, height: qrLado });
  doc
    .font("Helvetica")
    .fontSize(5)
    .fillColor("#666")
    .text(
      "A autenticidade desta NFS-e pode ser verificada pela leitura deste código QR ou pela consulta da chave de acesso no portal nacional da NFS-e.",
      textoX,
      y + (alturaChave - 26) / 2,
      { width: textoLarg },
    );
  doc
    .font("Helvetica")
    .fontSize(5.2)
    .fillColor("#666")
    .text("CHAVE DE ACESSO DA NFS-e", M + 8, y + 6);
  doc
    .font("Courier-Bold")
    .fontSize(9.4)
    .fillColor("#000")
    .text(d.chave, M + 8, y + 15, { width: divisorX - M - 16, characterSpacing: 0.6 });
  y += alturaChave;

  // Identificação
  y = faixa(doc, y, [
    { rot: "Número da NFS-e", val: d.nNFSe, f: 0.14, forte: true, tam: 9 },
    { rot: "Competência", val: data(d.dCompet), f: 0.14 },
    { rot: "Emissão da NFS-e", val: dataHora(d.dhProc), f: 0.22 },
    { rot: "Número da DPS", val: d.nDPS, f: 0.12 },
    { rot: "Série da DPS", val: d.serie, f: 0.12 },
    { rot: "Emissão da DPS", val: dataHora(d.dhEmiDps), f: 0.26 },
  ]);
  y = faixa(
    doc,
    y,
    [
      { rot: "Emitente da NFS-e", val: TP_EMIT[d.tpEmit] ?? d.tpEmit, f: 0.25 },
      { rot: "Situação da NFS-e", val: SITUACAO[d.cStat] ?? `Código ${d.cStat}`, f: 0.25 },
      { rot: "Número do DFe", val: d.nDFSe, f: 0.25 },
      { rot: "Versão do aplicativo", val: d.verAplic, f: 0.25 },
    ],
    18,
  );

  // Prestador
  y = tituloSecao(doc, y, "PRESTADOR / FORNECEDOR");
  y = faixa(doc, y, [
    { rot: "CNPJ / CPF / NIF", val: formatarDocumento(d.prestador.doc), f: 0.25, forte: true },
    { rot: "Nome / Nome Empresarial", val: d.prestador.nome, f: 0.45 },
    { rot: "Inscrição Municipal", val: d.prestador.im, f: 0.15 },
    { rot: "Telefone", val: fone(d.prestador.fone), f: 0.15 },
  ]);
  y = faixa(doc, y, [
    { rot: "Endereço", val: d.prestador.endereco, f: 0.5 },
    { rot: "Município / UF", val: d.prestador.municipio, f: 0.2 },
    { rot: "Código IBGE / CEP", val: `${d.prestador.cMun} / ${cep(d.prestador.cep)}`, f: 0.3 },
  ]);
  y = faixa(doc, y, [
    { rot: "E-mail", val: d.prestador.email, f: 0.34 },
    {
      rot: "Simples Nacional na Data de Competência",
      val: OP_SIMPLES[d.prestador.opSimpNac] ?? "-",
      f: 0.4,
    },
    {
      rot: "Regime de Apuração pelo SN",
      val: REG_APUR_SN[d.prestador.regApTribSN] ?? "-",
      f: 0.26,
    },
  ]);

  // Tomador
  y = tituloSecao(doc, y, "TOMADOR / ADQUIRENTE");
  y = faixa(doc, y, [
    { rot: "CNPJ / CPF / NIF", val: formatarDocumento(d.tomador.doc), f: 0.25, forte: true },
    { rot: "Nome / Nome Empresarial", val: d.tomador.nome, f: 0.45 },
    { rot: "Inscrição Municipal", val: d.tomador.im, f: 0.15 },
    { rot: "Telefone", val: fone(d.tomador.fone), f: 0.15 },
  ]);
  y = faixa(doc, y, [
    { rot: "Endereço", val: d.tomador.endereco, f: 0.5 },
    { rot: "Município / UF", val: d.tomador.municipio, f: 0.2 },
    { rot: "Código IBGE / CEP", val: `${d.tomador.cMun} / ${cep(d.tomador.cep)}`, f: 0.3 },
  ]);
  y = faixa(doc, y, [{ rot: "E-mail", val: d.tomador.email, f: 1 }], 18);

  // Serviço
  y = tituloSecao(doc, y, "SERVIÇO PRESTADO");
  y = faixa(doc, y, [
    {
      rot: "Código de Tributação Nacional / Municipal",
      val: `${codTrib(d.servico.cTribNac)} / ${d.servico.cTribMun || "-"}`,
      f: 0.32,
    },
    { rot: "Código da NBS", val: d.servico.cNBS, f: 0.2 },
    { rot: "Local da Prestação", val: d.servico.localPrestacao, f: 0.48 },
  ]);
  y = paragrafo(doc, y, "Serviço (classificação nacional)", d.servico.xTribNac, 26);
  y = paragrafo(doc, y, "Descrição do Serviço", d.servico.descricao, 36);

  // Tributação
  y = tituloSecao(doc, y, "TRIBUTAÇÃO MUNICIPAL (ISSQN)");
  y = faixa(doc, y, [
    { rot: "Tipo de Tributação", val: TRIB_ISSQN[d.issqn.tipo] ?? "-", f: 0.26 },
    { rot: "Município de Incidência", val: d.issqn.municipioIncidencia, f: 0.24 },
    { rot: "BC ISSQN", val: reais(d.issqn.vBC), f: 0.15 },
    { rot: "Alíquota", val: d.issqn.pAliq ? `${d.issqn.pAliq}%` : "", f: 0.11 },
    { rot: "Retenção", val: RET_ISSQN[d.issqn.retencao] ?? "-", f: 0.13 },
    { rot: "ISSQN Apurado", val: reais(d.issqn.vISSQN), f: 0.11 },
  ]);
  y = tituloSecao(doc, y, "TRIBUTAÇÃO FEDERAL");
  y = faixa(
    doc,
    y,
    [
      { rot: "IRRF", val: reais(d.federal.vRetIRRF), f: 0.2 },
      { rot: "Contrib. Previdenciária Retida", val: reais(d.federal.vRetCP), f: 0.2 },
      { rot: "CSLL Retida", val: reais(d.federal.vRetCSLL), f: 0.2 },
      { rot: "PIS", val: reais(d.federal.vPis), f: 0.2 },
      { rot: "COFINS", val: reais(d.federal.vCofins), f: 0.2 },
    ],
    18,
  );

  // Valores
  y = tituloSecao(doc, y, "VALOR TOTAL DA NFS-e");
  y = faixa(
    doc,
    y,
    [
      {
        rot: "Valor da Operação / Serviço",
        val: reais(d.valores.vServ),
        f: 0.25,
        forte: true,
        tam: 9,
      },
      { rot: "Desconto Incondicionado", val: reais(d.valores.vDescIncond), f: 0.2 },
      { rot: "Desconto Condicionado", val: reais(d.valores.vDescCond), f: 0.2 },
      { rot: "Total das Retenções", val: reais(d.valores.vTotalRet), f: 0.2 },
      { rot: "Valor Líquido", val: reais(d.valores.vLiq), f: 0.15, forte: true, tam: 9 },
    ],
    26,
  );

  y = tituloSecao(doc, y, "INFORMAÇÕES COMPLEMENTARES");
  y = paragrafo(doc, y, "", d.servico.infoCompl, 30);

  doc
    .font("Helvetica")
    .fontSize(5.5)
    .fillColor("#666")
    .text(
      "Documento auxiliar gerado pelo emitente conforme NT 008/2026. A autenticidade deve ser conferida no Portal Nacional da NFS-e.",
      M,
      y + 6,
      { width: LARG, align: "center" },
    );

  // Tarja de ambiente de teste
  if (d.tpAmb !== "1") {
    doc.save();
    doc.rotate(-38, { origin: [A4.w / 2, A4.h / 2] });
    doc
      .font("Helvetica-Bold")
      .fontSize(52)
      .fillColor("#d00")
      .opacity(0.16)
      .text("SEM VALOR FISCAL", 0, A4.h / 2 - 40, { width: A4.w, align: "center" });
    doc.restore();
    doc.opacity(1);
  }

  doc.end();
  return pronto;
}
