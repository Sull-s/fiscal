/**
 * @fiscal/api como biblioteca: o mesmo serviço do agente local e do servidor, para embutir num
 * app (Electron, Node) ou montar um servidor próprio. O programa de linha de comando é principal.ts.
 */
export { criarApp, criarServico, origemPermitida } from "./app";
export { espelharPasta, gravarCopiaDiaria, type ResultadoBackup } from "./backup";
export { type Cofre, criarCofre, gerarChaveMestra } from "./cofre";
export type { DependenciasApi } from "./contexto";
export {
  type Empresa,
  type RepositorioEmpresas,
  empresaPublica,
  gerarChaveApi,
  repositorioEmpresasEmArquivos,
} from "./empresas";
export { type Alerta, alertasPorUrl } from "./monitor";
export { type OpcoesServicoFiscal, type ServicoFiscal, iniciarServicoFiscal } from "./servidor";
