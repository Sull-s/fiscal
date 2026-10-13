import { ErroFiscal } from "@fiscal/core";
import { XMLParser } from "fast-xml-parser";

/**
 * Envelope SOAP 1.2 da NF-e 4.00: a mensagem vai dentro de <nfeDadosMsg>, sem cabeçalho.
 * Com `operacao` (ex.: "nfeDistDFeInteresse"), o nfeDadosMsg vai dentro do elemento da operação,
 * como pede o webservice de distribuição do Ambiente Nacional.
 */
export function montarEnvelope(namespace: string, mensagem: string, operacao?: string): string {
  const corpo = operacao
    ? `<${operacao} xmlns="${namespace}"><nfeDadosMsg>${mensagem}</nfeDadosMsg></${operacao}>`
    : `<nfeDadosMsg xmlns="${namespace}">${mensagem}</nfeDadosMsg>`;
  return `<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body>${corpo}</soap12:Body></soap12:Envelope>`;
}

const leitor = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  removeNSPrefix: true,
  // Mantém tudo como texto: "0100" não pode virar 100, nem chave de 44 dígitos virar número
  parseTagValue: false,
  parseAttributeValue: false,
});

/** Converte XML em objeto simples (prefixos de namespace removidos, valores como texto). */
export function lerXmlComoObjeto(xml: string): Record<string, unknown> {
  return leitor.parse(xml) as Record<string, unknown>;
}

export interface RetornoSoap {
  /** XML de retorno da SEFAZ (conteúdo do nfeResultMsg), ex.: <retConsStatServ …>…</retConsStatServ> */
  xmlRetorno: string;
  /** O mesmo retorno como objeto: { retConsStatServ: { cStat: "107", … } } */
  dados: Record<string, unknown>;
}

/** Conteúdo do elemento de retorno (nfeResultMsg, ou `<operação>Result` na distribuição). */
const reResultado = (elemento: string) =>
  new RegExp(`<(?:[\\w-]+:)?${elemento}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${elemento}>`);
const RE_FAULT = /<(?:[\w-]+:)?Fault\b[\s\S]*?<\/(?:[\w-]+:)?Fault>/;
const RE_MOTIVO =
  /<(?:[\w-]+:)?(?:Text|faultstring)\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?(?:Text|faultstring)>/;

/**
 * Lê a resposta HTTP de um webservice da SEFAZ.
 * Os erros trazem `detalhes.podeTerSidoProcessado`: se true, NÃO dá para saber se a SEFAZ
 * processou o pedido (ex.: autorização) e é preciso consultar antes de tentar de novo.
 */
export function lerRespostaSoap(
  corpo: string,
  statusHttp: number,
  elementoResultado = "nfeResultMsg",
): RetornoSoap {
  const fault = RE_FAULT.exec(corpo);
  if (fault) {
    const motivo = RE_MOTIVO.exec(fault[0])?.[1]?.trim() ?? "";
    throw new ErroFiscal(
      "SEFAZ_FAULT",
      `A SEFAZ recusou a chamada (HTTP ${statusHttp})${motivo ? `: ${motivo}` : ""}.`,
      { statusHttp, motivo, podeTerSidoProcessado: false },
    );
  }

  const resultado = reResultado(elementoResultado).exec(corpo);
  if (!resultado) {
    if (statusHttp !== 200) {
      throw new ErroFiscal(
        "SEFAZ_HTTP",
        `A SEFAZ respondeu HTTP ${statusHttp}${statusHttp === 403 ? " (certificado recusado na conexão?)" : ""}.`,
        // 4xx: o servidor recusou antes de processar; 5xx: pode ter caído no meio do processamento
        { statusHttp, inicio: corpo.slice(0, 300), podeTerSidoProcessado: statusHttp >= 500 },
      );
    }
    throw new ErroFiscal("SEFAZ_RESPOSTA_INVALIDA", `Resposta da SEFAZ sem ${elementoResultado}.`, {
      statusHttp,
      inicio: corpo.slice(0, 300),
      podeTerSidoProcessado: true,
    });
  }

  const xmlRetorno = (resultado[1] ?? "").trim();
  return { xmlRetorno, dados: lerXmlComoObjeto(xmlRetorno) };
}

/** Atalho para ler `detalhes.podeTerSidoProcessado` de qualquer erro. */
export function podeTerSidoProcessado(erro: unknown): boolean {
  if (erro instanceof ErroFiscal) return erro.detalhes?.podeTerSidoProcessado !== false;
  return true;
}
