import { createSign } from "node:crypto";
import type { CertificadoA1 } from "@fiscal/certificado";
import {
  ErroFiscal,
  anoMesDaEmissao,
  codigoUf,
  formatarDataHoraSefaz,
  gerarCodigoNumerico,
  montarChaveAcesso,
} from "@fiscal/core";
import {
  escaparTexto,
  formatarDecimal,
  grupo,
  limparTexto,
  somenteDigitos,
  tag,
  texto,
} from "@fiscal/xml";
import type { DadosNota, EmitenteNfce, ItemVenda, NfceMontada, Pagamento, Venda } from "./tipos";
import { URLS_CONSULTA_NFCE } from "./urls-consulta";
import { CST_PIS_NAO_TRIBUTADO, cstPisCofins, validarEmitente, validarVenda } from "./validacao";
import { centavos, formatarValorUnitario, reais, repartir, totalDoItemEmCentavos } from "./valores";

export const NS_NFE = "http://www.portalfiscal.inf.br/nfe";

/** Textos que a SEFAZ exige em homologação (no 1º item e no nome do destinatário). */
export const TEXTO_HOMOLOGACAO_ITEM =
  "NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL";
export const TEXTO_HOMOLOGACAO_DESTINATARIO =
  "NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL";

const CODIGO_FORMA: Record<Pagamento["forma"], string> = {
  dinheiro: "01",
  credito: "03",
  debito: "04",
  pix: "17",
  outros: "99",
};

const CODIGO_BANDEIRA: Record<string, string> = {
  visa: "01",
  mastercard: "02",
  master: "02",
  amex: "03",
  "american express": "03",
  sorocred: "04",
  diners: "05",
  elo: "06",
  hipercard: "07",
  aura: "08",
  cabal: "09",
  alelo: "10",
};

const dec = (c: number) => formatarDecimal(reais(c), 2);

function icms(it: ItemVenda): string {
  const orig = String(it.origem ?? 0);
  const csosn = it.csosn ?? "102";
  if (csosn === "500") {
    return `<ICMS><ICMSSN500><orig>${orig}</orig><CSOSN>500</CSOSN></ICMSSN500></ICMS>`;
  }
  return `<ICMS><ICMSSN102><orig>${orig}</orig><CSOSN>${csosn}</CSOSN></ICMSSN102></ICMS>`;
}

/** PIS e COFINS do item (opcionais na NFC-e): só vão quando o produto tem o CST preenchido. */
function pisCofins(it: ItemVenda): string {
  const cst = cstPisCofins(it.cstPisCofins);
  if (!cst) return "";
  if (CST_PIS_NAO_TRIBUTADO.includes(cst)) {
    return `<PIS><PISNT><CST>${cst}</CST></PISNT></PIS><COFINS><COFINSNT><CST>${cst}</CST></COFINSNT></COFINS>`;
  }
  const zeros = (imp: string) => `<vBC>0.00</vBC><p${imp}>0.0000</p${imp}><v${imp}>0.00</v${imp}>`;
  return `<PIS><PISOutr><CST>${cst}</CST>${zeros("PIS")}</PISOutr></PIS><COFINS><COFINSOutr><CST>${cst}</CST>${zeros("COFINS")}</COFINSOutr></COFINS>`;
}

function pagamento(p: Pagamento): string {
  const tPag = CODIGO_FORMA[p.forma] ?? "99";
  const eletronico = tPag === "03" || tPag === "04" || tPag === "17";
  const integrado = eletronico && p.integrado !== false;
  const card = eletronico
    ? grupo(
        "card",
        tag("tpIntegra", integrado ? "1" : "2"),
        integrado && tag("CNPJ", somenteDigitos(p.cnpjCredenciadora)),
        integrado &&
          tPag !== "17" &&
          tag("tBand", CODIGO_BANDEIRA[String(p.bandeira ?? "").toLowerCase()] ?? "99"),
        integrado && texto("cAut", p.autorizacao, 128),
      )
    : "";
  return grupo(
    "detPag",
    tag("indPag", "0"),
    tag("tPag", tPag),
    tPag === "99" && texto("xPag", p.descricao || "Outros", 60),
    tag("vPag", dec(centavos(p.valor))),
    card,
  );
}

/**
 * QR Code v3 (NT 2025.001). Online: só chave, versão e ambiente (o CSC não entra mais).
 * Offline: dia da emissão, valor e destinatário, mais a assinatura RSA-SHA1 desses campos com a
 * chave do certificado, em base64 (o consumidor consegue conferir a nota antes de ela chegar à SEFAZ).
 */
function parametrosQrCode(d: {
  chave: string;
  tpAmb: 1 | 2;
  offline: boolean;
  dhEmi: string;
  vNF: string;
  docDestinatario: string;
  chavePrivadaPem?: string | undefined;
}): string {
  const base = `${d.chave}|3|${d.tpAmb}`;
  if (!d.offline) return base;
  // 1 CNPJ · 2 CPF · vazio quando não há destinatário identificado
  const doc = d.docDestinatario;
  const tpIdDest = doc.length === 14 ? "1" : doc.length === 11 ? "2" : "";
  const campos = `${base}|${d.dhEmi.slice(8, 10)}|${d.vNF}|${tpIdDest}|${doc}`;
  const assinatura = createSign("RSA-SHA1")
    .update(campos, "utf8")
    .sign(d.chavePrivadaPem ?? "", "base64");
  return `${campos}|${assinatura}`;
}

function validarContingencia(
  contingencia: NonNullable<DadosNota["contingencia"]>,
  emissao: Date,
  temCertificado: boolean,
): string {
  const problemas: string[] = [];
  const xJust = limparTexto(contingencia.justificativa, 256);
  if (xJust.length < 15)
    problemas.push("Justificativa da contingência precisa de 15 a 256 caracteres.");
  if (Number.isNaN(contingencia.inicio.getTime()))
    problemas.push("Início da contingência inválido.");
  // A SEFAZ compara em segundos; 1 s de folga para a hora da emissão truncada
  else if (contingencia.inicio.getTime() > emissao.getTime() + 1000)
    problemas.push("A contingência não pode começar depois da emissão da nota.");
  if (!temCertificado)
    problemas.push("Contingência offline exige o certificado na montagem (assinatura do QR Code).");
  if (problemas.length) {
    throw new ErroFiscal("NFCE_CONTINGENCIA_INVALIDA", problemas.join(" "), { problemas });
  }
  return xJust;
}

/**
 * Monta a NFC-e (modelo 65, leiaute 4.00) de uma venda, com QR Code v3, pronta para assinar
 * (`assinarXml(xml, { elemento: "infNFe", perfil: "sefaz", certificado })`).
 * Com `nota.contingencia`, monta em contingência offline (tpEmis 9) e precisa do `certificado`.
 * Lança ErroFiscal com todos os problemas de cadastro/venda de uma vez.
 */
export function montarNfce(entrada: {
  emitente: EmitenteNfce;
  venda: Venda;
  nota: DadosNota;
  /** Só usado (e obrigatório) em contingência offline */
  certificado?: Pick<CertificadoA1, "chavePrivadaPem">;
}): NfceMontada {
  const { emitente, venda, nota } = entrada;
  validarEmitente(emitente);
  validarVenda(venda);
  // Séries 890 a 999 são reservadas (avulsa e contingências antigas)
  if (!(Number.isInteger(nota.serie) && nota.serie >= 0 && nota.serie <= 889)) {
    throw new ErroFiscal("NFCE_SERIE_INVALIDA", "Série da NFC-e deve ser de 0 a 889.", {
      serie: nota.serie,
    });
  }

  const end = emitente.endereco;
  const uf = end.uf;
  const tpAmb = nota.ambiente;
  const homologacao = tpAmb === 2;
  const emissao = nota.dataEmissao ?? new Date();
  const dhEmi = formatarDataHoraSefaz(emissao, nota.fuso);
  const contingencia = nota.contingencia;
  const offline = contingencia !== undefined;
  const xJustCont = contingencia
    ? validarContingencia(contingencia, emissao, Boolean(entrada.certificado?.chavePrivadaPem))
    : "";
  const cnpj = somenteDigitos(emitente.cnpj);
  const cNF = nota.codigoNumerico ?? gerarCodigoNumerico(nota.numero);
  const chave = montarChaveAcesso({
    uf,
    anoMes: anoMesDaEmissao(dhEmi),
    documentoEmitente: cnpj,
    modelo: "65",
    serie: nota.serie,
    numero: nota.numero,
    tipoEmissao: offline ? 9 : 1,
    codigoNumerico: cNF,
  });

  // Valores em centavos inteiros; desconto e outras despesas repartidos entre os itens
  const totaisItens = venda.itens.map((it) =>
    totalDoItemEmCentavos(it.quantidade, it.valorUnitario),
  );
  const vProd = totaisItens.reduce((s, v) => s + v, 0);
  const desconto = Math.min(centavos(venda.desconto ?? 0), vProd);
  const outras = centavos(venda.outrasDespesas ?? 0);
  const descontos = repartir(desconto, totaisItens);
  const outrosValores = repartir(outras, totaisItens);
  const vNF = vProd - desconto + outras;

  const pago = venda.pagamentos.reduce((s, p) => s + centavos(p.valor), 0);
  if (pago < vNF) {
    throw new ErroFiscal(
      "NFCE_PAGAMENTO_INSUFICIENTE",
      `Pagamentos (R$ ${dec(pago)}) menores que o total da nota (R$ ${dec(vNF)}).`,
      { pago: reais(pago), total: reais(vNF) },
    );
  }
  const troco = pago - vNF;
  if (troco > 0 && !venda.pagamentos.some((p) => p.forma === "dinheiro")) {
    throw new ErroFiscal(
      "NFCE_TROCO_SEM_DINHEIRO",
      "Pagamento maior que o total só é aceito em dinheiro (troco).",
    );
  }

  const ide =
    "<ide>" +
    tag("cUF", codigoUf(uf)) +
    tag("cNF", cNF) +
    texto("natOp", "VENDA") +
    tag("mod", "65") +
    tag("serie", nota.serie) +
    tag("nNF", nota.numero) +
    tag("dhEmi", dhEmi) +
    tag("tpNF", "1") +
    tag("idDest", "1") +
    tag("cMunFG", somenteDigitos(end.codigoMunicipio)) +
    tag("tpImp", "4") +
    tag("tpEmis", offline ? "9" : "1") +
    tag("cDV", chave.slice(-1)) +
    tag("tpAmb", tpAmb) +
    tag("finNFe", "1") +
    tag("indFinal", "1") +
    // 1 = presencial; 4 = entrega em domicílio
    tag("indPres", venda.entrega ? "4" : "1") +
    (venda.entrega ? tag("indIntermed", "0") : "") +
    tag("procEmi", "0") +
    texto("verProc", nota.versaoAplicativo ?? "@fiscal/nfce", 20) +
    (contingencia
      ? tag("dhCont", formatarDataHoraSefaz(contingencia.inicio, nota.fuso)) +
        texto("xJust", xJustCont)
      : "") +
    "</ide>";

  const emit =
    "<emit>" +
    tag("CNPJ", cnpj) +
    texto("xNome", emitente.razaoSocial, 60) +
    texto("xFant", emitente.nomeFantasia, 60) +
    "<enderEmit>" +
    texto("xLgr", end.logradouro, 60) +
    texto("nro", end.numero || "S/N", 60) +
    texto("xCpl", end.complemento, 60) +
    texto("xBairro", end.bairro, 60) +
    tag("cMun", somenteDigitos(end.codigoMunicipio)) +
    texto("xMun", end.municipio, 60) +
    tag("UF", uf) +
    tag("CEP", somenteDigitos(end.cep)) +
    tag("cPais", "1058") +
    tag("xPais", "BRASIL") +
    tag("fone", somenteDigitos(end.telefone)) +
    "</enderEmit>" +
    tag("IE", somenteDigitos(emitente.inscricaoEstadual)) +
    tag("CRT", emitente.crt) +
    "</emit>";

  const destinatario = venda.destinatario ?? {};
  const doc = somenteDigitos(destinatario.documento);
  const endDest = destinatario.endereco ?? {};
  const cepDest = somenteDigitos(endDest.cep);
  const foneDest = somenteDigitos(endDest.telefone);
  const enderDest = venda.entrega
    ? "<enderDest>" +
      texto("xLgr", endDest.logradouro, 60) +
      texto("nro", endDest.numero, 60) +
      texto("xCpl", endDest.complemento, 60) +
      texto("xBairro", endDest.bairro, 60) +
      // Entrega na mesma cidade do emitente, a não ser que venha outra
      tag("cMun", somenteDigitos(endDest.codigoMunicipio) || somenteDigitos(end.codigoMunicipio)) +
      texto("xMun", endDest.municipio || end.municipio, 60) +
      tag("UF", endDest.uf || uf) +
      tag("CEP", cepDest.length === 8 ? cepDest : "") +
      tag("cPais", "1058") +
      tag("xPais", "BRASIL") +
      tag("fone", foneDest.length >= 6 ? foneDest.slice(0, 14) : "") +
      "</enderDest>"
    : "";
  const dest = doc
    ? "<dest>" +
      tag(doc.length === 14 ? "CNPJ" : "CPF", doc) +
      (homologacao
        ? texto("xNome", TEXTO_HOMOLOGACAO_DESTINATARIO)
        : texto("xNome", destinatario.nome, 60)) +
      enderDest +
      tag("indIEDest", "9") +
      "</dest>"
    : "";

  const det = venda.itens
    .map((it, i) => {
      const xProd = homologacao && i === 0 ? TEXTO_HOMOLOGACAO_ITEM : it.descricao;
      const unidade = it.unidade || "UN";
      const qtd = formatarDecimal(it.quantidade, 4);
      const vUn = formatarValorUnitario(it.valorUnitario);
      const prod =
        "<prod>" +
        texto("cProd", it.codigo || String(i + 1), 60) +
        tag("cEAN", "SEM GTIN") +
        texto("xProd", xProd, 120) +
        tag("NCM", somenteDigitos(it.ncm)) +
        tag("CEST", somenteDigitos(it.cest)) +
        tag("CFOP", somenteDigitos(it.cfop)) +
        texto("uCom", unidade, 6) +
        tag("qCom", qtd) +
        tag("vUnCom", vUn) +
        tag("vProd", dec(totaisItens[i] ?? 0)) +
        tag("cEANTrib", "SEM GTIN") +
        texto("uTrib", unidade, 6) +
        tag("qTrib", qtd) +
        tag("vUnTrib", vUn) +
        ((descontos[i] ?? 0) > 0 ? tag("vDesc", dec(descontos[i] ?? 0)) : "") +
        ((outrosValores[i] ?? 0) > 0 ? tag("vOutro", dec(outrosValores[i] ?? 0)) : "") +
        tag("indTot", "1") +
        "</prod>";
      return `<det nItem="${i + 1}">${prod}<imposto>${icms(it)}${pisCofins(it)}</imposto>${texto("infAdProd", it.observacao, 500)}</det>`;
    })
    .join("");

  const zeros = (...nomes: string[]) => nomes.map((n) => tag(n, "0.00")).join("");
  const total =
    "<total><ICMSTot>" +
    zeros("vBC", "vICMS", "vICMSDeson", "vFCP", "vBCST", "vST", "vFCPST", "vFCPSTRet") +
    tag("vProd", dec(vProd)) +
    zeros("vFrete", "vSeg") +
    tag("vDesc", dec(desconto)) +
    zeros("vII", "vIPI", "vIPIDevol", "vPIS", "vCOFINS") +
    tag("vOutro", dec(outras)) +
    tag("vNF", dec(vNF)) +
    "</ICMSTot></total>";

  const transp = "<transp><modFrete>9</modFrete></transp>";
  const pag = `<pag>${venda.pagamentos.map(pagamento).join("")}${troco > 0 ? tag("vTroco", dec(troco)) : ""}</pag>`;
  const infAdic = grupo("infAdic", texto("infCpl", venda.informacoesComplementares, 5000));
  const rt = emitente.responsavelTecnico;
  const infRespTec = rt
    ? "<infRespTec>" +
      tag("CNPJ", somenteDigitos(rt.cnpj)) +
      texto("xContato", rt.contato, 60) +
      texto("email", rt.email, 60) +
      tag("fone", somenteDigitos(rt.telefone)) +
      "</infRespTec>"
    : "";

  const corpo = ide + emit + dest + det + total + transp + pag + infAdic + infRespTec;
  const urls = URLS_CONSULTA_NFCE[uf][tpAmb];
  const qrCode = `${urls.qrCode}?p=${parametrosQrCode({
    chave,
    tpAmb,
    offline,
    dhEmi,
    vNF: dec(vNF),
    docDestinatario: doc,
    chavePrivadaPem: entrada.certificado?.chavePrivadaPem,
  })}`;
  const infNFeSupl = `<infNFeSupl><qrCode>${escaparTexto(qrCode)}</qrCode><urlChave>${escaparTexto(urls.urlChave)}</urlChave></infNFeSupl>`;
  const xml = `<NFe xmlns="${NS_NFE}"><infNFe Id="NFe${chave}" versao="4.00">${corpo}</infNFe>${infNFeSupl}</NFe>`;

  return {
    xml,
    chave,
    numero: nota.numero,
    serie: nota.serie,
    dataEmissao: dhEmi,
    ambiente: tpAmb,
    valorTotal: reais(vNF),
    troco: reais(troco),
    qrCode,
    urlConsulta: urls.urlChave,
    offline,
  };
}
