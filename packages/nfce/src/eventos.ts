import {
  ErroFiscal,
  type Uf,
  codigoUf,
  formatarDataHoraSefaz,
  limparCnpj,
  validarChaveAcesso,
} from "@fiscal/core";
import { limparTexto, somenteDigitos, tag, texto } from "@fiscal/xml";
import { NS_NFE } from "./montar";

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

  const sequencia = dados.sequencia ?? 1;
  const id = `ID110111${dados.chave}${String(sequencia).padStart(2, "0")}`;
  const corpo =
    tag("cOrgao", dados.chave.slice(0, 2)) +
    tag("tpAmb", dados.ambiente) +
    documento(dados.documentoEmitente) +
    tag("chNFe", dados.chave) +
    tag("dhEvento", formatarDataHoraSefaz(dados.dataEvento ?? new Date(), dados.fuso)) +
    tag("tpEvento", "110111") +
    tag("nSeqEvento", sequencia) +
    tag("verEvento", "1.00") +
    `<detEvento versao="1.00"><descEvento>Cancelamento</descEvento>${tag("nProt", nProt)}${texto("xJust", xJust)}</detEvento>`;

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
