import {
  type ResultadoConsulta,
  type ResultadoEvento,
  cancelarNota,
  consultarNota,
  inutilizarNumeracao,
} from "@fiscal/nfe-comum";
import type { ClienteSefaz } from "@fiscal/transporte";

type SemModelo<T> = Omit<T, "modelo">;

/** Situação da NF-e pela chave (resolve as pendentes). Com `xmlNota`, devolve o nfeProc. */
export const consultarNfe = (
  cliente: ClienteSefaz,
  pedido: SemModelo<Parameters<typeof consultarNota>[1]>,
): Promise<ResultadoConsulta> => consultarNota(cliente, { ...pedido, modelo: "55" });

/** Cancela uma NF-e autorizada (em geral até 24 h depois da autorização). */
export const cancelarNfe = (
  cliente: ClienteSefaz,
  pedido: SemModelo<Parameters<typeof cancelarNota>[1]>,
): Promise<ResultadoEvento> => cancelarNota(cliente, { ...pedido, modelo: "55" });

/** Inutiliza números da série da NF-e. */
export const inutilizarNumeracaoNfe = (
  cliente: ClienteSefaz,
  pedido: SemModelo<Parameters<typeof inutilizarNumeracao>[1]>,
): Promise<ResultadoEvento> => inutilizarNumeracao(cliente, { ...pedido, modelo: "55" });
