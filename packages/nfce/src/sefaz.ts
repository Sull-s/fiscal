import { ErroFiscal, type Uf } from "@fiscal/core";
import {
  type ResultadoAutorizacao,
  type ResultadoConsulta,
  type ResultadoEvento,
  autorizarNota,
  cancelarNota,
  consultarNota,
} from "@fiscal/nfe-comum";
import type { ClienteSefaz } from "@fiscal/transporte";

export {
  type ResultadoAutorizacao,
  type ResultadoConsulta,
  type ResultadoEvento,
  type SituacaoAutorizacao,
  type SituacaoNaSefaz,
  inutilizarNumeracao,
} from "@fiscal/nfe-comum";

type SemModelo<T> = Omit<T, "modelo">;

/**
 * Envia a NFC-e assinada para autorização (modo síncrono) e classifica a resposta.
 * Nunca reenvia por conta própria: se não houver resposta, devolve "pendente".
 */
export const autorizarNfce = (
  cliente: ClienteSefaz,
  pedido: SemModelo<Parameters<typeof autorizarNota>[1]>,
): Promise<ResultadoAutorizacao> => autorizarNota(cliente, { ...pedido, modelo: "65" });

/**
 * Consulta a situação da nota pela chave. É o jeito de resolver notas "pendentes".
 * Com `xmlNota`, devolve também o <nfeProc> pronto quando autorizada.
 */
export const consultarNfce = (
  cliente: ClienteSefaz,
  pedido: SemModelo<Parameters<typeof consultarNota>[1]>,
): Promise<ResultadoConsulta> => consultarNota(cliente, { ...pedido, modelo: "65" });

/** Cancela uma NFC-e autorizada (com `chaveSubstituta`, por substituição). 135/136/155 = registrado. */
export const cancelarNfce = (
  cliente: ClienteSefaz,
  pedido: SemModelo<Parameters<typeof cancelarNota>[1]>,
): Promise<ResultadoEvento> => cancelarNota(cliente, { ...pedido, modelo: "65" });

/**
 * Transmite uma NFC-e emitida em contingência offline (a mesma que foi impressa, sem alterar nada).
 * Pode ser chamada de novo sem risco: se a SEFAZ já tiver autorizado, devolve o protocolo (204).
 * Rejeitada: a venda já aconteceu; corrija o problema e emita de novo (o cupom impresso não vale).
 */
export async function transmitirNfceOffline(
  cliente: ClienteSefaz,
  pedido: { uf: Uf; ambiente: 1 | 2; xmlAssinado: string },
): Promise<ResultadoAutorizacao> {
  if (!/<tpEmis>9<\/tpEmis>/.test(pedido.xmlAssinado)) {
    throw new ErroFiscal(
      "NFCE_NAO_E_OFFLINE",
      "Esta NFC-e não foi emitida em contingência offline (tpEmis 9).",
    );
  }
  return autorizarNfce(cliente, pedido);
}
