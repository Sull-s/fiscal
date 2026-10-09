export {
  type Alinhamento,
  type LinhaTermica,
  alinharColunas,
  quebrarTexto,
} from "./termico/modelo";
export { type DadosDanfeNfce, lerDanfeNfce, montarDanfeNfce } from "./termico/danfe-nfce";
export {
  type LarguraPapel,
  type OpcoesEscPos,
  paraEscPos,
  paraHtml,
  paraTexto,
} from "./termico/renderizadores";
export { chaveEmGrupos, dataHora, documento, moeda, quantidade } from "./formato";
export { type DadosDanfse, lerDanfse } from "./danfse/ler";
export { type OpcoesDanfse, URL_CONSULTA_NFSE, gerarDanfse } from "./danfse/pdf";
