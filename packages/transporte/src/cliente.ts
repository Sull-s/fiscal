import { ErroFiscal, type Uf, codigoUf } from "@fiscal/core";
import { criarAgenteMtls, requisitarHttps } from "./https";
import { type RetornoSoap, lerRespostaSoap, montarEnvelope, podeTerSidoProcessado } from "./soap";
import {
  type Ambiente,
  CATALOGO_PADRAO,
  type CatalogoWebservices,
  type Contingencia,
  type ModeloSefaz,
  type PedidoWebservice,
  type ServicoSefaz,
  localizarWebservice,
} from "./webservices";

const NS_NFE = "http://www.portalfiscal.inf.br/nfe";

/** Consultas não mudam nada na SEFAZ: repetir é sempre seguro. */
const IDEMPOTENTES: ReadonlySet<ServicoSefaz> = new Set(["status", "consulta", "retAutorizacao"]);

export interface RegistroChamada {
  servico: ServicoSefaz | undefined;
  url: string;
  tentativa: number;
  envelope: string;
  statusHttp?: number;
  resposta?: string;
  duracaoMs: number;
  erro?: { codigo: string; mensagem: string };
}

export interface OpcoesCliente {
  /** Chave e cadeia do certificado do emitente (use `opcoesTls`/`CertificadoA1` de @fiscal/certificado) */
  certificado: { chavePrivadaPem: string; cadeiaPem: string };
  /** Tempo máximo por chamada (padrão 30 s) */
  timeoutMs?: number;
  /** Tentativas quando é seguro repetir (padrão 3) */
  tentativas?: number;
  /** Espera antes da 2ª tentativa; dobra a cada nova (padrão 1000 ms) */
  esperaEntreTentativasMs?: number;
  /** ACs confiáveis para o certificado do servidor (padrão: raízes do Node + ICP-Brasil) */
  autoridades?: readonly string[];
  catalogo?: CatalogoWebservices;
  /** Recebe cada chamada (com XML de ida e volta), para log e auditoria */
  aoRegistrar?: (registro: RegistroChamada) => void;
}

export interface RespostaSefaz extends RetornoSoap {
  url: string;
  statusHttp: number;
  duracaoMs: number;
}

export interface ChamadaPorUrl {
  url: string;
  /** Namespace do nfeDadosMsg */
  namespace: string;
  /** `action` do SOAP 1.2 */
  acao: string;
  mensagem: string;
  /** Usado para decidir se repetir é seguro; sem ele, só repete falhas de conexão */
  servico?: ServicoSefaz;
  /** Elemento da operação que embrulha o nfeDadosMsg (o retorno vem em `<operacao>Result`) */
  operacao?: string;
  /** Consulta pura: pode repetir mesmo se a SEFAZ talvez tenha recebido */
  idempotente?: boolean;
}

export interface StatusServico {
  emOperacao: boolean;
  cStat: string;
  xMotivo: string;
  /** Tempo médio de resposta informado pela SEFAZ, em segundos */
  tempoMedioSegundos: number | null;
  dhRecbto: string | null;
  /**
   * Relógio local − relógio da SEFAZ, em segundos (positivo = PC adiantado).
   * Diferença grande gera rejeição de data de emissão: confira o NTP do computador.
   */
  diferencaRelogioSegundos: number | null;
}

export interface ClienteSefaz {
  chamar(pedido: PedidoWebservice & { mensagem: string }): Promise<RespostaSefaz>;
  chamarUrl(chamada: ChamadaPorUrl): Promise<RespostaSefaz>;
  consultarStatus(pedido: {
    uf: Uf;
    modelo: ModeloSefaz;
    ambiente: Ambiente;
    /** Status da SEFAZ virtual de contingência (SVC) em vez da SEFAZ da UF */
    contingencia?: Contingencia;
  }): Promise<StatusServico>;
  /** Fecha as conexões mantidas abertas */
  fechar(): void;
}

const esperar = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

export function criarClienteSefaz(opcoes: OpcoesCliente): ClienteSefaz {
  const timeoutMs = opcoes.timeoutMs ?? 30_000;
  const tentativas = Math.max(1, opcoes.tentativas ?? 3);
  const espera = opcoes.esperaEntreTentativasMs ?? 1000;
  const catalogo = opcoes.catalogo ?? CATALOGO_PADRAO;

  const agente = criarAgenteMtls(opcoes);

  const postar = (url: string, envelope: string, acao: string) =>
    requisitarHttps(agente, {
      metodo: "POST",
      url,
      corpo: envelope,
      cabecalhos: { "Content-Type": `application/soap+xml; charset=utf-8; action="${acao}"` },
      timeoutMs,
      prefixoErro: "SEFAZ",
      nomeServidor: "A SEFAZ",
    });

  async function chamarUrl(chamada: ChamadaPorUrl): Promise<RespostaSefaz> {
    const envelope = montarEnvelope(chamada.namespace, chamada.mensagem, chamada.operacao);
    let ultimoErro: unknown;

    for (let tentativa = 1; tentativa <= tentativas; tentativa++) {
      const inicio = Date.now();
      const registro: RegistroChamada = {
        servico: chamada.servico,
        url: chamada.url,
        tentativa,
        envelope,
        duracaoMs: 0,
      };
      try {
        const { statusHttp, corpo } = await postar(chamada.url, envelope, chamada.acao);
        registro.statusHttp = statusHttp;
        registro.resposta = corpo;
        registro.duracaoMs = Date.now() - inicio;
        const retorno = lerRespostaSoap(
          corpo,
          statusHttp,
          chamada.operacao ? `${chamada.operacao}Result` : undefined,
        );
        opcoes.aoRegistrar?.(registro);
        return { ...retorno, url: chamada.url, statusHttp, duracaoMs: registro.duracaoMs };
      } catch (e) {
        registro.duracaoMs = Date.now() - inicio;
        registro.erro = {
          codigo: e instanceof ErroFiscal ? e.codigo : "ERRO_INESPERADO",
          mensagem: e instanceof Error ? e.message : String(e),
        };
        opcoes.aoRegistrar?.(registro);
        ultimoErro = e;

        const repetivel =
          e instanceof ErroFiscal &&
          e.codigo !== "SEFAZ_FAULT" &&
          (!podeTerSidoProcessado(e) ||
            chamada.idempotente ||
            (chamada.servico && IDEMPOTENTES.has(chamada.servico)));
        if (!repetivel || tentativa === tentativas) break;
        await esperar(espera * 2 ** (tentativa - 1));
      }
    }
    throw ultimoErro;
  }

  async function chamar(pedido: PedidoWebservice & { mensagem: string }) {
    const ws = localizarWebservice(pedido, catalogo);
    return chamarUrl({
      url: ws.url,
      namespace: ws.namespace,
      acao: ws.acao,
      mensagem: pedido.mensagem,
      servico: pedido.servico,
    });
  }

  async function consultarStatus(pedido: {
    uf: Uf;
    modelo: ModeloSefaz;
    ambiente: Ambiente;
    contingencia?: Contingencia;
  }) {
    const mensagem = `<consStatServ xmlns="${NS_NFE}" versao="4.00"><tpAmb>${pedido.ambiente}</tpAmb><cUF>${codigoUf(pedido.uf)}</cUF><xServ>STATUS</xServ></consStatServ>`;
    const resposta = await chamar({ ...pedido, servico: "status", mensagem });
    const agora = Date.now();
    const r = (resposta.dados.retConsStatServ ?? {}) as Record<string, string | undefined>;
    const dhRecbto = r.dhRecbto ?? null;
    const instanteSefaz = dhRecbto ? Date.parse(dhRecbto) : Number.NaN;
    return {
      emOperacao: r.cStat === "107",
      cStat: r.cStat ?? "",
      xMotivo: r.xMotivo ?? "",
      tempoMedioSegundos: r.tMed ? Number(r.tMed) : null,
      dhRecbto,
      // A SEFAZ informa só segundos inteiros: diferenças abaixo de ~2 s são ruído
      diferencaRelogioSegundos: Number.isNaN(instanteSefaz)
        ? null
        : Math.round((agora - resposta.duracaoMs / 2 - instanteSefaz) / 1000),
    };
  }

  return { chamar, chamarUrl, consultarStatus, fechar: () => agente.destroy() };
}
