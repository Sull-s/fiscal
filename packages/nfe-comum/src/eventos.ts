import {
  ErroFiscal,
  type Uf,
  codigoUf,
  formatarDataHoraSefaz,
  limparCnpj,
  validarChaveAcesso,
} from "@fiscal/core";
import { limparTexto, somenteDigitos, tag, texto } from "@fiscal/xml";
import { NS_NFE } from "./constantes";

function exigirJustificativa(justificativa: string): string {
  const xJust = limparTexto(justificativa, 255);
  if (xJust.length < 15) {
    throw new ErroFiscal(
      "JUSTIFICATIVA_CURTA",
      "A justificativa precisa ter pelo menos 15 caracteres (exigência da SEFAZ).",
    );
  }
  return xJust;
}

/** CNPJ ou CPF do emitente, na tag certa. */
function documento(doc: string): string {
  const limpo = limparCnpj(doc);
  return limpo.length === 11 ? tag("CPF", limpo) : tag("CNPJ", limpo);
}

/**
 * Evento de cancelamento (110111), pronto para assinar
 * (`assinarXml(xml, { elemento: "infEvento", perfil: "sefaz", certificado })`).
 * O prazo de cancelamento da NFC-e é curto (em geral 30 minutos após a autorização; varia por UF).
 *
 * Com `chaveSubstituta`, vira cancelamento por substituição (110112): a nota online que ficou
 * pendente acabou autorizada, mas a venda já tinha saído em contingência offline com outra chave.
 * Esse evento tem prazo maior que o cancelamento comum.
 */
export function montarCancelamento(dados: {
  chave: string;
  /** Protocolo de autorização da nota (15 dígitos) */
  protocolo: string;
  justificativa: string;
  documentoEmitente: string;
  ambiente: 1 | 2;
  /** Padrão 1 */
  sequencia?: number;
  dataEvento?: Date;
  fuso?: string;
  /** Chave da NFC-e (offline) que substitui esta */
  chaveSubstituta?: string;
  /** verAplic do cancelamento por substituição. Padrão "@fiscal/nfce" */
  versaoAplicativo?: string;
}): { xml: string; id: string } {
  const xJust = exigirJustificativa(dados.justificativa);
  if (!validarChaveAcesso(dados.chave)) {
    throw new ErroFiscal("CHAVE_INVALIDA", "Chave de acesso inválida.", { chave: dados.chave });
  }
  const nProt = somenteDigitos(dados.protocolo);
  if (nProt.length !== 15) {
    throw new ErroFiscal(
      "PROTOCOLO_INVALIDO",
      "Nota sem protocolo de autorização válido (15 dígitos): não há o que cancelar.",
    );
  }

  const substituta = dados.chaveSubstituta;
  if (substituta !== undefined && (!validarChaveAcesso(substituta) || substituta === dados.chave)) {
    throw new ErroFiscal("CHAVE_INVALIDA", "Chave da nota substituta inválida.", {
      chave: substituta,
    });
  }
  const tpEvento = substituta ? "110112" : "110111";
  const detalhe = substituta
    ? "<descEvento>Cancelamento por substituicao</descEvento>" +
      tag("cOrgaoAutor", dados.chave.slice(0, 2)) +
      tag("tpAutor", "1") +
      texto("verAplic", dados.versaoAplicativo ?? "@fiscal/nfce", 20) +
      tag("nProt", nProt) +
      texto("xJust", xJust) +
      tag("chNFeRef", substituta)
    : `<descEvento>Cancelamento</descEvento>${tag("nProt", nProt)}${texto("xJust", xJust)}`;

  const sequencia = dados.sequencia ?? 1;
  const id = `ID${tpEvento}${dados.chave}${String(sequencia).padStart(2, "0")}`;
  const corpo =
    tag("cOrgao", dados.chave.slice(0, 2)) +
    tag("tpAmb", dados.ambiente) +
    documento(dados.documentoEmitente) +
    tag("chNFe", dados.chave) +
    tag("dhEvento", formatarDataHoraSefaz(dados.dataEvento ?? new Date(), dados.fuso)) +
    tag("tpEvento", tpEvento) +
    tag("nSeqEvento", sequencia) +
    tag("verEvento", "1.00") +
    `<detEvento versao="1.00">${detalhe}</detEvento>`;

  return {
    xml: `<evento xmlns="${NS_NFE}" versao="1.00"><infEvento Id="${id}">${corpo}</infEvento></evento>`,
    id,
  };
}

/**
 * Inutilização de numeração: avisa a SEFAZ que números da série não serão usados (ex.: nota que
 * nunca chegou à SEFAZ e cujo número foi pulado). Pronta para assinar (elemento "infInut").
 */
export function montarInutilizacao(dados: {
  uf: Uf;
  /** CNPJ do emitente */
  cnpj: string;
  ambiente: 1 | 2;
  /** Padrão "65" (NFC-e) */
  modelo?: "55" | "65";
  serie: number;
  inicio: number;
  fim: number;
  justificativa: string;
  /** Ano da inutilização (padrão: ano atual) */
  ano?: number;
}): { xml: string; id: string } {
  const xJust = exigirJustificativa(dados.justificativa);
  const { inicio, fim, serie } = dados;
  if (
    !(
      Number.isInteger(inicio) &&
      Number.isInteger(fim) &&
      inicio >= 1 &&
      fim >= inicio &&
      fim <= 999_999_999
    )
  ) {
    throw new ErroFiscal("FAIXA_INVALIDA", "Faixa de números inválida.", { inicio, fim });
  }
  const cUF = String(codigoUf(dados.uf));
  const ano = String(dados.ano ?? new Date().getFullYear()).slice(-2);
  const cnpj = limparCnpj(dados.cnpj).padStart(14, "0");
  const modelo = dados.modelo ?? "65";
  const id =
    `ID${cUF}${ano}${cnpj}${modelo}` +
    `${String(serie).padStart(3, "0")}${String(inicio).padStart(9, "0")}${String(fim).padStart(9, "0")}`;
  const corpo =
    tag("tpAmb", dados.ambiente) +
    tag("xServ", "INUTILIZAR") +
    tag("cUF", cUF) +
    tag("ano", ano) +
    tag("CNPJ", cnpj) +
    tag("mod", modelo) +
    tag("serie", serie) +
    tag("nNFIni", inicio) +
    tag("nNFFin", fim) +
    texto("xJust", xJust);

  return {
    xml: `<inutNFe xmlns="${NS_NFE}" versao="4.00"><infInut Id="${id}">${corpo}</infInut></inutNFe>`,
    id,
  };
}

/** Texto fixo exigido pelo leiaute da CC-e (sem acentos, exatamente assim). */
export const CONDICAO_USO_CCE =
  "A Carta de Correcao e disciplinada pelo paragrafo 1o-A do art. 7o do Convenio S/N, de 15 de " +
  "dezembro de 1970 e pode ser utilizada para regularizacao de erro ocorrido na emissao de " +
  "documento fiscal, desde que o erro nao esteja relacionado com: I - as variaveis que " +
  "determinam o valor do imposto tais como: base de calculo, aliquota, diferenca de preco, " +
  "quantidade, valor da operacao ou da prestacao; II - a correcao de dados cadastrais que " +
  "implique mudanca do remetente ou do destinatario; III - a data de emissao ou de saida.";

/**
 * Carta de correção eletrônica (110110), só para NF-e modelo 55. Pronta para assinar.
 * Cada carta nova substitui a anterior (sequência 1, 2, 3… até 20): mande sempre o texto completo.
 * Não serve para corrigir valores, impostos, quantidade, emitente/destinatário nem datas.
 */
export function montarCartaCorrecao(dados: {
  chave: string;
  /** O que está sendo corrigido (15 a 1000 caracteres) */
  correcao: string;
  documentoEmitente: string;
  ambiente: 1 | 2;
  /** 1 na primeira carta; some 1 a cada nova carta da mesma nota */
  sequencia: number;
  dataEvento?: Date;
  fuso?: string;
}): { xml: string; id: string } {
  if (!validarChaveAcesso(dados.chave)) {
    throw new ErroFiscal("CHAVE_INVALIDA", "Chave de acesso inválida.", { chave: dados.chave });
  }
  if (dados.chave.slice(20, 22) !== "55") {
    throw new ErroFiscal("CCE_SO_NFE", "Carta de correção só existe para NF-e (modelo 55).");
  }
  if (!(Number.isInteger(dados.sequencia) && dados.sequencia >= 1 && dados.sequencia <= 20)) {
    throw new ErroFiscal("CCE_SEQUENCIA_INVALIDA", "Sequência da carta de correção: 1 a 20.");
  }
  const xCorrecao = limparTexto(dados.correcao, 1000);
  if (xCorrecao.length < 15) {
    throw new ErroFiscal(
      "CCE_CORRECAO_CURTA",
      "O texto da correção precisa ter pelo menos 15 caracteres.",
    );
  }
  const id = `ID110110${dados.chave}${String(dados.sequencia).padStart(2, "0")}`;
  const corpo =
    tag("cOrgao", dados.chave.slice(0, 2)) +
    tag("tpAmb", dados.ambiente) +
    documento(dados.documentoEmitente) +
    tag("chNFe", dados.chave) +
    tag("dhEvento", formatarDataHoraSefaz(dados.dataEvento ?? new Date(), dados.fuso)) +
    tag("tpEvento", "110110") +
    tag("nSeqEvento", dados.sequencia) +
    tag("verEvento", "1.00") +
    `<detEvento versao="1.00"><descEvento>Carta de Correcao</descEvento>${texto("xCorrecao", xCorrecao)}${tag("xCondUso", CONDICAO_USO_CCE)}</detEvento>`;
  return {
    xml: `<evento xmlns="${NS_NFE}" versao="1.00"><infEvento Id="${id}">${corpo}</infEvento></evento>`,
    id,
  };
}
