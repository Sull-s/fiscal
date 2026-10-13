import PDFDocument from "pdfkit";
import { chaveEmGrupos, dataHora, documento, moeda } from "../formato";
import { modulosCode128C } from "./code128";
import { type DadosDanfe, type ItemDanfe, lerDanfe } from "./ler";

/**
 * DANFE retrato em A4 (Manual de Orientação do Contribuinte, anexo do DANFE), a partir do XML da
 * NF-e: canhoto, cabeçalho com código de barras da chave, destinatário, faturas, cálculo do
 * imposto, transporte, produtos (continua nas folhas seguintes) e dados adicionais.
 */

const A4 = { w: 595.28, h: 841.89 };
const M = 20;
const LARG = A4.w - 2 * M;
const BORDA = "#000";
const ROTULO = 5;
const VALOR = 7.5;

const MODALIDADE_FRETE: Record<string, string> = {
  "0": "0-Remetente (CIF)",
  "1": "1-Destinatário (FOB)",
  "2": "2-Terceiros",
  "3": "3-Próprio Remetente",
  "4": "4-Próprio Destinatário",
  "9": "9-Sem Frete",
};

type Doc = PDFKit.PDFDocument;
interface Campo {
  rot: string;
  val: string;
  /** Largura em pontos (a última da faixa ocupa o resto) */
  w?: number;
  alinhar?: "left" | "right" | "center";
  forte?: boolean;
}

const dinheiro = (v: string) => (v === "" ? "" : moeda(v));
const decimal = (v: string, casas: number) => (v === "" ? "" : moeda(v, casas));
const data = (iso: string) => dataHora(iso).slice(0, 10);
const hora = (iso: string) => dataHora(iso).slice(11);
function fone(v: string) {
  const d = v.replace(/\D/g, "");
  if (d.length === 11) return d.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3");
  if (d.length === 10) return d.replace(/(\d{2})(\d{4})(\d{4})/, "($1) $2-$3");
  return v;
}
const cep = (v: string) => (/^\d{8}$/.test(v) ? v.replace(/(\d{5})(\d{3})/, "$1-$2") : v);
/** Quantidade com até 4 casas, sem zeros sobrando à direita além de 2 */
function qtd(v: string) {
  const [i = "0", f = ""] = Number(v || 0)
    .toFixed(4)
    .split(".");
  const frac = f.replace(/0+$/, "").padEnd(2, "0");
  return `${i.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${frac}`;
}

function faixa(doc: Doc, y: number, campos: Campo[], altura = 20) {
  let x = M;
  campos.forEach((c, i) => {
    const w = i === campos.length - 1 ? M + LARG - x : (c.w ?? 0);
    doc.rect(x, y, w, altura).lineWidth(0.5).stroke(BORDA);
    doc
      .font("Helvetica")
      .fontSize(ROTULO)
      .fillColor("#000")
      .text(c.rot.toUpperCase(), x + 2, y + 2, { width: w - 4, lineBreak: false, ellipsis: true });
    doc
      .font(c.forte ? "Helvetica-Bold" : "Helvetica")
      .fontSize(VALOR)
      .text(c.val, x + 2, y + altura - 10.5, {
        width: w - 4,
        align: c.alinhar ?? "left",
        lineBreak: false,
        ellipsis: true,
      });
    x += w;
  });
  return y + altura;
}

function tituloBloco(doc: Doc, y: number, titulo: string) {
  doc
    .font("Helvetica-Bold")
    .fontSize(6)
    .fillColor("#000")
    .text(titulo, M, y + 2);
  return y + 9;
}

function codigoDeBarras(doc: Doc, chave: string, x: number, y: number, w: number, h: number) {
  const modulos = modulosCode128C(chave);
  const largura = w / modulos.length;
  doc.save().fillColor("#000");
  let i = 0;
  while (i < modulos.length) {
    if (modulos[i] === "1") {
      let fim = i;
      while (modulos[fim + 1] === "1") fim++;
      doc.rect(x + i * largura, y, (fim - i + 1) * largura, h).fill();
      i = fim + 1;
    } else i++;
  }
  doc.restore();
}

/** Canhoto destacável, só na primeira folha. */
function canhoto(doc: Doc, d: DadosDanfe, y: number) {
  const h = 46;
  const wNum = 95;
  doc
    .rect(M, y, LARG - wNum, 22)
    .lineWidth(0.5)
    .stroke(BORDA);
  doc
    .font("Helvetica")
    .fontSize(6)
    .text(
      `RECEBEMOS DE ${d.emitente.nome.toUpperCase()} OS PRODUTOS E/OU SERVIÇOS CONSTANTES DA NOTA FISCAL ELETRÔNICA INDICADA AO LADO`,
      M + 3,
      y + 4,
      { width: LARG - wNum - 6 },
    );
  faixaLivre(doc, M, y + 22, 120, 24, "Data de recebimento");
  faixaLivre(
    doc,
    M + 120,
    y + 22,
    LARG - wNum - 120,
    24,
    "Identificação e assinatura do recebedor",
  );
  doc.rect(M + LARG - wNum, y, wNum, h).stroke(BORDA);
  doc
    .font("Helvetica-Bold")
    .fontSize(10)
    .text("NF-e", M + LARG - wNum, y + 6, { width: wNum, align: "center" })
    .fontSize(8)
    .text(`Nº ${numeroFormatado(d.numero)}`, M + LARG - wNum, y + 20, {
      width: wNum,
      align: "center",
    })
    .text(`SÉRIE ${d.serie.padStart(3, "0")}`, M + LARG - wNum, y + 31, {
      width: wNum,
      align: "center",
    });
  const corte = y + h + 5;
  doc
    .moveTo(M, corte)
    .lineTo(M + LARG, corte)
    .dash(3, { space: 2 })
    .stroke("#555")
    .undash();
  return corte + 5;
}

function faixaLivre(doc: Doc, x: number, y: number, w: number, h: number, rotulo: string) {
  doc.rect(x, y, w, h).stroke(BORDA);
  doc
    .font("Helvetica")
    .fontSize(ROTULO)
    .text(rotulo.toUpperCase(), x + 2, y + 2);
}

const numeroFormatado = (n: string) =>
  n.padStart(9, "0").replace(/(\d{3})(\d{3})(\d{3})/, "$1.$2.$3");

/** Cabeçalho (emitente, caixa DANFE, código de barras), repetido em todas as folhas. */
function cabecalho(doc: Doc, d: DadosDanfe, inicio: number, folha: number, folhas: number) {
  let y = inicio;
  const h = 92;
  const wEmit = 215;
  const wDanfe = 100;
  const wChave = LARG - wEmit - wDanfe;
  const xDanfe = M + wEmit;
  const xChave = xDanfe + wDanfe;
  doc.rect(M, y, wEmit, h).stroke(BORDA);
  doc.rect(xDanfe, y, wDanfe, h).stroke(BORDA);
  doc.rect(xChave, y, wChave, h).stroke(BORDA);

  // Emitente
  const e = d.emitente;
  doc
    .font("Helvetica-Bold")
    .fontSize(9.5)
    .text(e.nome, M + 4, y + 10, { width: wEmit - 8, align: "center" });
  const yEnd = doc.y + 4;
  doc
    .font("Helvetica")
    .fontSize(7)
    .text(
      [
        e.logradouro,
        [e.bairro, cep(e.cep)].filter(Boolean).join(" - "),
        `${e.municipio} - ${e.uf}${e.fone ? `  Fone: ${fone(e.fone)}` : ""}`,
      ].join("\n"),
      M + 4,
      yEnd,
      { width: wEmit - 8, align: "center" },
    );

  // Caixa DANFE
  doc
    .font("Helvetica-Bold")
    .fontSize(12)
    .text("DANFE", xDanfe, y + 6, { width: wDanfe, align: "center" });
  doc
    .font("Helvetica")
    .fontSize(6)
    .text("Documento Auxiliar da Nota Fiscal Eletrônica", xDanfe + 6, y + 21, {
      width: wDanfe - 12,
      align: "center",
    });
  doc
    .fontSize(7)
    .text("0 - ENTRADA", xDanfe + 8, y + 42)
    .text("1 - SAÍDA", xDanfe + 8, y + 51);
  doc.rect(xDanfe + wDanfe - 24, y + 41, 14, 16).stroke(BORDA);
  doc
    .font("Helvetica-Bold")
    .fontSize(11)
    .text(d.tipo, xDanfe + wDanfe - 24, y + 44, { width: 14, align: "center" });
  doc
    .fontSize(8)
    .text(`Nº ${numeroFormatado(d.numero)}`, xDanfe, y + 63, { width: wDanfe, align: "center" })
    .text(`SÉRIE ${d.serie.padStart(3, "0")}`, xDanfe, y + 73, { width: wDanfe, align: "center" })
    .font("Helvetica")
    .fontSize(7)
    .text(`FOLHA ${folha}/${folhas}`, xDanfe, y + 83, { width: wDanfe, align: "center" });

  // Código de barras e chave
  codigoDeBarras(doc, d.chave, xChave + 10, y + 5, wChave - 20, 32);
  doc
    .font("Helvetica")
    .fontSize(ROTULO)
    .text("CHAVE DE ACESSO", xChave + 4, y + 41);
  doc
    .font("Helvetica-Bold")
    .fontSize(7.4)
    .text(chaveEmGrupos(d.chave), xChave + 4, y + 49, { width: wChave - 8, align: "center" });
  doc
    .font("Helvetica")
    .fontSize(7)
    .text(
      "Consulta de autenticidade no portal nacional da NF-e www.nfe.fazenda.gov.br/portal ou no site da Sefaz Autorizadora",
      xChave + 6,
      y + 64,
      { width: wChave - 12, align: "center" },
    );
  y += h;

  const protocolo = d.protocolo
    ? `${d.protocolo.numero} - ${dataHora(d.protocolo.data)}`
    : "NOTA NÃO AUTORIZADA";
  y = faixa(doc, y, [
    { rot: "Natureza da operação", val: d.naturezaOperacao, w: wEmit + wDanfe },
    { rot: "Protocolo de autorização de uso", val: protocolo, alinhar: "center", forte: true },
  ]);
  return faixa(doc, y, [
    { rot: "Inscrição estadual", val: e.ie, w: 185 },
    { rot: "Inscrição estadual do subst. trib.", val: e.ieSt, w: 185 },
    { rot: "CNPJ", val: documento(e.cnpj) },
  ]);
}

function destinatario(doc: Doc, d: DadosDanfe, inicio: number) {
  let y = inicio;
  y = tituloBloco(doc, y, "DESTINATÁRIO / REMETENTE");
  const dd = d.destinatario;
  y = faixa(doc, y, [
    { rot: "Nome / razão social", val: dd.nome, w: 340 },
    { rot: "CNPJ / CPF", val: documento(dd.documento), w: 130, alinhar: "center" },
    { rot: "Data da emissão", val: data(d.dataEmissao), alinhar: "center" },
  ]);
  y = faixa(doc, y, [
    { rot: "Endereço", val: dd.logradouro, w: 270 },
    { rot: "Bairro / distrito", val: dd.bairro, w: 130 },
    { rot: "CEP", val: cep(dd.cep), w: 70, alinhar: "center" },
    { rot: "Data da saída/entrada", val: data(d.dataSaida), alinhar: "center" },
  ]);
  return faixa(doc, y, [
    { rot: "Município", val: dd.municipio, w: 200 },
    { rot: "Fone / fax", val: fone(dd.fone), w: 100 },
    { rot: "UF", val: dd.uf, w: 30, alinhar: "center" },
    { rot: "Inscrição estadual", val: dd.ie, w: 140 },
    { rot: "Hora da saída/entrada", val: hora(d.dataSaida), alinhar: "center" },
  ]);
}

function faturas(doc: Doc, d: DadosDanfe, inicio: number) {
  let y = inicio;
  if (d.duplicatas.length === 0) return y;
  y = tituloBloco(doc, y, "FATURA / DUPLICATAS");
  const porLinha = 6;
  const w = LARG / porLinha;
  const linhas = Math.ceil(d.duplicatas.length / porLinha);
  doc.rect(M, y, LARG, linhas * 22).stroke(BORDA);
  d.duplicatas.forEach((dup, i) => {
    const x = M + (i % porLinha) * w;
    const yl = y + Math.floor(i / porLinha) * 22;
    doc
      .font("Helvetica")
      .fontSize(6)
      .text(`Nº ${dup.numero}`, x + 3, yl + 3)
      .text(`Venc. ${data(`${dup.vencimento}T00:00:00`)}`, x + 3, yl + 10)
      .font("Helvetica-Bold")
      .text(`R$ ${dinheiro(dup.valor)}`, x + 3, yl + 17 - 2, { width: w - 6, align: "right" });
  });
  return y + linhas * 22;
}

function calculoImposto(doc: Doc, d: DadosDanfe, inicio: number) {
  let y = inicio;
  const t = d.totais;
  const v = (k: string) => dinheiro(t[k] ?? "0");
  y = tituloBloco(doc, y, "CÁLCULO DO IMPOSTO");
  const w = LARG / 9;
  const linha = (campos: [string, string][], forte = false) =>
    faixa(
      doc,
      y,
      campos.map(([rot, val], i) => ({
        rot,
        val,
        w,
        alinhar: "right" as const,
        forte: forte && i === campos.length - 1,
      })),
    );
  y = linha([
    ["Base cálc. ICMS", v("vBC")],
    ["Valor do ICMS", v("vICMS")],
    ["Base cálc. ICMS ST", v("vBCST")],
    ["Valor ICMS ST", v("vST")],
    ["V. imp. import.", v("vII")],
    ["V. ICMS UF remet.", dinheiro(t.vICMSUFRemet ?? "0")],
    ["Valor do FCP", v("vFCP")],
    ["Valor do PIS", v("vPIS")],
    ["V. total produtos", v("vProd")],
  ]);
  return linha(
    [
      ["Valor do frete", v("vFrete")],
      ["Valor do seguro", v("vSeg")],
      ["Desconto", v("vDesc")],
      ["Outras despesas", v("vOutro")],
      ["Valor total IPI", v("vIPI")],
      ["V. ICMS UF dest.", dinheiro(t.vICMSUFDest ?? "0")],
      ["V. tot. tributos", dinheiro(t.vTotTrib ?? "0")],
      ["Valor da COFINS", v("vCOFINS")],
      ["V. total da nota", v("vNF")],
    ],
    true,
  );
}

function transporte(doc: Doc, d: DadosDanfe, inicio: number) {
  let y = inicio;
  const t = d.transporte;
  y = tituloBloco(doc, y, "TRANSPORTADOR / VOLUMES TRANSPORTADOS");
  y = faixa(doc, y, [
    { rot: "Nome / razão social", val: t.nome, w: 190 },
    { rot: "Frete por conta", val: MODALIDADE_FRETE[t.modalidade] ?? t.modalidade, w: 95 },
    { rot: "Código ANTT", val: "", w: 60 },
    { rot: "Placa do veículo", val: "", w: 60 },
    { rot: "UF", val: "", w: 25 },
    { rot: "CNPJ / CPF", val: documento(t.documento), alinhar: "center" },
  ]);
  y = faixa(doc, y, [
    { rot: "Endereço", val: t.endereco, w: 250 },
    { rot: "Município", val: t.municipio, w: 155 },
    { rot: "UF", val: t.uf, w: 25 },
    { rot: "Inscrição estadual", val: t.ie },
  ]);
  const vol = t.volumes[0] ?? { qVol: "", esp: "", marca: "", nVol: "", pesoB: "", pesoL: "" };
  return faixa(doc, y, [
    { rot: "Quantidade", val: vol.qVol, w: 70, alinhar: "right" },
    { rot: "Espécie", val: vol.esp, w: 100 },
    { rot: "Marca", val: vol.marca, w: 100 },
    { rot: "Numeração", val: vol.nVol, w: 95 },
    { rot: "Peso bruto", val: decimal(vol.pesoB, 3), w: 95, alinhar: "right" },
    { rot: "Peso líquido", val: decimal(vol.pesoL, 3), alinhar: "right" },
  ]);
}

// Tabela de produtos (larguras somam LARG = 555,28)
const COLUNAS: {
  rot: string;
  w: number;
  valor: (i: ItemDanfe) => string;
  alinhar?: "right" | "center";
}[] = [
  { rot: "Código", w: 45, valor: (i) => i.codigo },
  { rot: "Descrição do produto / serviço", w: 120.28, valor: (i) => i.descricao },
  { rot: "NCM/SH", w: 38, valor: (i) => i.ncm, alinhar: "center" },
  { rot: "O/CST", w: 24, valor: (i) => i.cst, alinhar: "center" },
  { rot: "CFOP", w: 24, valor: (i) => i.cfop, alinhar: "center" },
  { rot: "Un", w: 20, valor: (i) => i.unidade, alinhar: "center" },
  { rot: "Quant.", w: 36, valor: (i) => qtd(i.quantidade), alinhar: "right" },
  { rot: "Valor unit.", w: 38, valor: (i) => decimal(i.valorUnitario, 2), alinhar: "right" },
  { rot: "Valor total", w: 40, valor: (i) => dinheiro(i.valorTotal), alinhar: "right" },
  { rot: "Valor desc.", w: 32, valor: (i) => dinheiro(i.desconto), alinhar: "right" },
  { rot: "B.cálc. ICMS", w: 36, valor: (i) => dinheiro(i.bcIcms), alinhar: "right" },
  { rot: "Valor ICMS", w: 30, valor: (i) => dinheiro(i.valorIcms), alinhar: "right" },
  { rot: "Valor IPI", w: 28, valor: (i) => dinheiro(i.valorIpi), alinhar: "right" },
  { rot: "Alíq. ICMS", w: 22, valor: (i) => decimal(i.aliquotaIcms, 2), alinhar: "right" },
  { rot: "Alíq. IPI", w: 22, valor: (i) => decimal(i.aliquotaIpi, 2), alinhar: "right" },
];
const ALT_CAB_TABELA = 14;

function cabecalhoTabela(doc: Doc, inicio: number, simples: boolean) {
  let y = inicio;
  y = tituloBloco(doc, y, "DADOS DOS PRODUTOS / SERVIÇOS");
  let x = M;
  for (const c of COLUNAS) {
    doc.rect(x, y, c.w, ALT_CAB_TABELA).stroke(BORDA);
    const rot = c.rot === "O/CST" && simples ? "O/CSOSN" : c.rot;
    doc
      .font("Helvetica")
      .fontSize(4.6)
      .text(rot.toUpperCase(), x + 1, y + 2, { width: c.w - 2, align: "center" });
    x += c.w;
  }
  return y + ALT_CAB_TABELA;
}

function alturaItem(doc: Doc, it: ItemDanfe) {
  const desc = it.informacoes ? `${it.descricao}\n${it.informacoes}` : it.descricao;
  doc.font("Helvetica").fontSize(6);
  return Math.max(10, doc.heightOfString(desc, { width: (COLUNAS[1]?.w ?? 100) - 4 }) + 4);
}

function linhaItem(doc: Doc, it: ItemDanfe, y: number, h: number) {
  let x = M;
  for (const [i, c] of COLUNAS.entries()) {
    doc
      .moveTo(x, y)
      .lineTo(x, y + h)
      .stroke("#888");
    const texto = i === 1 && it.informacoes ? `${it.descricao}\n${it.informacoes}` : c.valor(it);
    doc
      .font("Helvetica")
      .fontSize(6)
      .fillColor("#000")
      .text(texto, x + 2, y + 2, { width: c.w - 4, align: c.alinhar ?? "left" });
    x += c.w;
  }
  doc
    .moveTo(x, y)
    .lineTo(x, y + h)
    .stroke("#888");
  doc
    .moveTo(M, y + h)
    .lineTo(M + LARG, y + h)
    .stroke("#ccc");
}

const ALT_ADICIONAIS = 90;

function dadosAdicionais(doc: Doc, d: DadosDanfe, inicio: number) {
  let y = inicio;
  y = tituloBloco(doc, y, "DADOS ADICIONAIS");
  const wInfo = LARG * 0.65;
  const h = ALT_ADICIONAIS - 9;
  doc.rect(M, y, wInfo, h).stroke(BORDA);
  doc.rect(M + wInfo, y, LARG - wInfo, h).stroke(BORDA);
  doc
    .font("Helvetica")
    .fontSize(ROTULO)
    .text("INFORMAÇÕES COMPLEMENTARES", M + 2, y + 2);
  doc.text("RESERVADO AO FISCO", M + wInfo + 2, y + 2);
  doc
    .fontSize(6.5)
    .text(d.informacoesComplementares, M + 3, y + 10, {
      width: wInfo - 6,
      height: h - 12,
      ellipsis: true,
    })
    .text(d.informacoesFisco, M + wInfo + 3, y + 10, {
      width: LARG - wInfo - 6,
      height: h - 12,
      ellipsis: true,
    });
}

function tarja(doc: Doc, texto: string, cor: string) {
  doc.save();
  doc.rotate(-38, { origin: [A4.w / 2, A4.h / 2] });
  doc
    .font("Helvetica-Bold")
    .fontSize(48)
    .fillColor(cor)
    .opacity(0.16)
    .text(texto, 0, A4.h / 2 - 30, { width: A4.w, align: "center" });
  doc.restore();
  doc.opacity(1).fillColor("#000");
}

export interface OpcoesDanfe {
  /** Imprime a tarja CANCELADA (o XML da nota não diz isso; vem do seu cadastro) */
  cancelada?: boolean;
  criador?: string;
  /** Padrão true; false só para inspecionar/testar */
  comprimir?: boolean;
}

/** DANFE em PDF (A4 retrato) a partir do XML da NF-e. */
export async function gerarDanfe(
  xmlNfe: string | DadosDanfe,
  opcoes: OpcoesDanfe = {},
): Promise<Buffer> {
  const d = typeof xmlNfe === "string" ? lerDanfe(xmlNfe) : xmlNfe;
  const doc = new PDFDocument({
    size: "A4",
    margin: 0,
    autoFirstPage: false,
    compress: opcoes.comprimir ?? true,
    info: {
      Title: `DANFE ${d.numero} - ${d.chave}`,
      Author: d.emitente.nome,
      Creator: opcoes.criador ?? "@fiscal/documentos",
    },
  });
  const pedacos: Buffer[] = [];
  doc.on("data", (c: Buffer) => pedacos.push(c));
  const pronto = new Promise<Buffer>((ok) => doc.on("end", () => ok(Buffer.concat(pedacos))));
  const simples = d.crt !== "3";

  // Primeiro decide quais itens vão em cada folha (o cabeçalho mostra "FOLHA x/total")
  doc.addPage();
  const alturas = d.itens.map((it) => alturaItem(doc, it));
  const linhasFatura = Math.ceil(d.duplicatas.length / 6);
  const alturaFaturas = linhasFatura ? 9 + linhasFatura * 22 : 0;
  // canhoto 56 · cabeçalho 132 · destinatário 69 · imposto 49 · transporte 69 · tabela 9 + 14
  const yItensPrimeira = M + 56 + 132 + 69 + alturaFaturas + 49 + 69 + 9 + ALT_CAB_TABELA;
  const yItensDemais = M + 132 + 9 + ALT_CAB_TABELA;
  const limitePrimeira = A4.h - M - ALT_ADICIONAIS - 4;
  const limiteDemais = A4.h - M;
  const paginas: number[][] = [[]];
  let y = yItensPrimeira;
  alturas.forEach((h, i) => {
    const limite = paginas.length === 1 ? limitePrimeira : limiteDemais;
    if (y + h > limite && (paginas.at(-1)?.length ?? 0) > 0) {
      paginas.push([]);
      y = yItensDemais;
    }
    paginas.at(-1)?.push(i);
    y += h;
  });

  paginas.forEach((indices, p) => {
    if (p > 0) doc.addPage();
    let yy: number;
    if (p === 0) {
      yy = canhoto(doc, d, M);
      yy = cabecalho(doc, d, yy, 1, paginas.length);
      yy = destinatario(doc, d, yy);
      yy = faturas(doc, d, yy);
      yy = calculoImposto(doc, d, yy);
      yy = transporte(doc, d, yy);
    } else {
      yy = cabecalho(doc, d, M, p + 1, paginas.length);
    }
    yy = cabecalhoTabela(doc, yy, simples);
    const inicioTabela = yy;
    for (const i of indices) {
      const it = d.itens[i];
      const h = alturas[i] ?? 10;
      if (it) linhaItem(doc, it, yy, h);
      yy += h;
    }
    const fimTabela = p === 0 ? limitePrimeira : limiteDemais;
    doc.rect(M, inicioTabela, LARG, fimTabela - inicioTabela).stroke(BORDA);
    if (p === 0) dadosAdicionais(doc, d, limitePrimeira + 4);
    if (d.ambiente !== "1") tarja(doc, "SEM VALOR FISCAL", "#d00");
    if (opcoes.cancelada) tarja(doc, "CANCELADA", "#d00");
    else if (!d.protocolo && d.ambiente === "1") tarja(doc, "NÃO AUTORIZADA", "#d00");
  });

  doc.end();
  return pronto;
}
