export type { ArmazemNumeracao, RegistroNumero, Serie, SituacaoNumero } from "./tipos";
export { armazemEmMemoria } from "./memoria";
export {
  type ExecutarSql,
  type OpcoesPostgres,
  armazemPostgres,
  prepararTabelas,
  sqlTabelas,
} from "./postgres";
export { type Numeracao, type SituacaoSerie, criarNumeracao } from "./numeracao";
