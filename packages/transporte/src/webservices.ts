import { ErroFiscal, type Uf } from "@fiscal/core";
import { CATALOGO_OFICIAL } from "./catalogo-oficial";

/** 1 = produção, 2 = homologação */
export type Ambiente = 1 | 2;

/** Modelos que usam os webservices "NFe 4.00" da SEFAZ */
export type ModeloSefaz = "55" | "65";

export type ServicoSefaz =
  | "autorizacao"
  | "retAutorizacao"
  | "status"
  | "consulta"
  | "evento"
  | "inutilizacao";

/**
 * Quem atende: a própria UF, uma SEFAZ virtual (SVRS, SVAN), a contingência (SVC-AN, SVC-RS)
 * ou o Ambiente Nacional (AN: eventos do destinatário, distribuição de DF-e).
 */
export type Autorizador = Uf | "SVRS" | "SVAN" | "SVC-AN" | "SVC-RS" | "AN";

export type Contingencia = "SVC-AN" | "SVC-RS";

/** Nome do WSDL e da operação SOAP de cada serviço (iguais em todas as UFs no leiaute 4.00). */
export const OPERACOES: Record<ServicoSefaz, { wsdl: string; metodo: string }> = {
  autorizacao: { wsdl: "NFeAutorizacao4", metodo: "nfeAutorizacaoLote" },
  retAutorizacao: { wsdl: "NFeRetAutorizacao4", metodo: "nfeRetAutorizacaoLote" },
  status: { wsdl: "NFeStatusServico4", metodo: "nfeStatusServicoNF" },
  consulta: { wsdl: "NFeConsultaProtocolo4", metodo: "nfeConsultaNF" },
  evento: { wsdl: "NFeRecepcaoEvento4", metodo: "nfeRecepcaoEvento" },
  inutilizacao: { wsdl: "NFeInutilizacao4", metodo: "nfeInutilizacaoNF" },
};

/** URL do serviço; com wsdl/método quando a UF foge do padrão de OPERACOES (ex.: PR, GO). */
export type Endereco = string | { url: string; wsdl: string; metodo: string };

type EnderecosPorAmbiente = Record<Ambiente, Partial<Record<ServicoSefaz, Endereco>>>;

export interface CatalogoWebservices {
  /** Qual autorizador atende cada UF, por modelo */
  autorizadorDaUf: Record<ModeloSefaz, Partial<Record<Uf, Autorizador>>>;
  /** Endereços de cada autorizador, por modelo e ambiente */
  enderecos: Record<ModeloSefaz, Partial<Record<Autorizador, EnderecosPorAmbiente>>>;
}

/**
 * Catálogo completo (todas as UFs, SVRS, SVAN e contingências SVC), gerado de fonte pública por
 * scripts/atualizar-catalogo-sefaz.mjs. Os testes conferem a NFC-e do RS com os endereços em produção.
 */
export const CATALOGO_PADRAO: CatalogoWebservices = CATALOGO_OFICIAL;

/**
 * Contingência SVC de cada UF (NF-e modelo 55; a NFC-e não tem SVC, usa a emissão offline).
 * Fonte: sped-nfe src/Factories/Contingency.php.
 */
export const CONTINGENCIA_DA_UF: Record<Uf, Contingencia> = {
  AC: "SVC-AN",
  AL: "SVC-AN",
  AM: "SVC-RS",
  AP: "SVC-AN",
  BA: "SVC-RS",
  CE: "SVC-AN",
  DF: "SVC-AN",
  ES: "SVC-AN",
  GO: "SVC-RS",
  MA: "SVC-RS",
  MG: "SVC-AN",
  MS: "SVC-RS",
  MT: "SVC-RS",
  PA: "SVC-AN",
  PB: "SVC-AN",
  PE: "SVC-RS",
  PI: "SVC-AN",
  PR: "SVC-RS",
  RJ: "SVC-AN",
  RN: "SVC-AN",
  RO: "SVC-AN",
  RR: "SVC-AN",
  RS: "SVC-AN",
  SC: "SVC-AN",
  SE: "SVC-AN",
  SP: "SVC-AN",
  TO: "SVC-AN",
};

/** Junta endereços extras ao catálogo, sem alterar o original. */
export function estenderCatalogo(
  base: CatalogoWebservices,
  extra: {
    autorizadorDaUf?: Partial<Record<ModeloSefaz, Partial<Record<Uf, Autorizador>>>>;
    enderecos?: Partial<
      Record<ModeloSefaz, Partial<Record<Autorizador, Partial<EnderecosPorAmbiente>>>>
    >;
  },
): CatalogoWebservices {
  const resultado = structuredClone(base);
  for (const modelo of ["55", "65"] as const) {
    Object.assign(resultado.autorizadorDaUf[modelo], extra.autorizadorDaUf?.[modelo]);
    for (const [aut, porAmbiente] of Object.entries(extra.enderecos?.[modelo] ?? {})) {
      const enderecos = resultado.enderecos[modelo];
      const atual = enderecos[aut as Autorizador] ?? { 1: {}, 2: {} };
      enderecos[aut as Autorizador] = atual;
      for (const amb of [1, 2] as const) Object.assign(atual[amb], porAmbiente?.[amb]);
    }
  }
  return resultado;
}

export interface Webservice {
  autorizador: Autorizador;
  url: string;
  wsdl: string;
  metodo: string;
  /** Namespace do nfeDadosMsg: http://www.portalfiscal.inf.br/nfe/wsdl/<wsdl> */
  namespace: string;
  /** Valor do `action` no Content-Type SOAP 1.2 */
  acao: string;
}

export interface PedidoWebservice {
  uf: Uf;
  modelo: ModeloSefaz;
  ambiente: Ambiente;
  servico: ServicoSefaz;
  /** Em contingência SVC, autorização/consulta/status vão para o SVC (só NF-e modelo 55) */
  contingencia?: Contingencia;
}

export function localizarWebservice(
  pedido: PedidoWebservice,
  catalogo: CatalogoWebservices = CATALOGO_PADRAO,
): Webservice {
  const { uf, modelo, ambiente, servico, contingencia } = pedido;
  const autorizador = contingencia ?? catalogo.autorizadorDaUf[modelo][uf];
  if (!autorizador) {
    throw new ErroFiscal(
      "WEBSERVICE_NAO_CONFIGURADO",
      `Emissão do modelo ${modelo} para ${uf} ainda não configurada no catálogo de webservices.`,
      { uf, modelo },
    );
  }
  if (contingencia && modelo !== "55") {
    throw new ErroFiscal(
      "CONTINGENCIA_INVALIDA",
      "A NFC-e não tem contingência SVC: use a emissão offline (tpEmis 9).",
      { modelo, contingencia },
    );
  }
  const endereco = catalogo.enderecos[modelo][autorizador]?.[ambiente]?.[servico];
  if (!endereco) {
    throw new ErroFiscal(
      "WEBSERVICE_NAO_CONFIGURADO",
      `Serviço "${servico}" do ${autorizador} (modelo ${modelo}, ${ambiente === 1 ? "produção" : "homologação"}) não está no catálogo.`,
      { uf, modelo, ambiente, servico, autorizador },
    );
  }
  const { url, wsdl, metodo } =
    typeof endereco === "string" ? { url: endereco, ...OPERACOES[servico] } : endereco;
  const namespace = `http://www.portalfiscal.inf.br/nfe/wsdl/${wsdl}`;
  return { autorizador, url, wsdl, metodo, namespace, acao: `${namespace}/${metodo}` };
}
