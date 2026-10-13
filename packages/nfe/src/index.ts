export { TEXTO_HOMOLOGACAO_DESTINATARIO, montarNfe } from "./montar";
export { destinoDaOperacao, validarNfe } from "./validacao";
export { type EmissaoNfe, emitirNfe } from "./emitir";
export { cancelarNfe, consultarNfe, inutilizarNumeracaoNfe } from "./sefaz";
export {
  CONDICAO_USO_CCE,
  type ResultadoAutorizacao,
  type ResultadoConsulta,
  type ResultadoEvento,
  enviarCartaCorrecao,
  montarCancelamento,
  montarCartaCorrecao,
  montarInutilizacao,
} from "@fiscal/nfe-comum";
export type * from "./tipos";
