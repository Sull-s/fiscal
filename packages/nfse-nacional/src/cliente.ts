import { gunzipSync, gzipSync } from "node:zlib";
import { ErroFiscal } from "@fiscal/core";
import {
  type OpcoesAgenteMtls,
  type PedidoHttps,
  criarAgenteMtls,
  podeTerSidoProcessado,
  requisitarHttps,
} from "@fiscal/transporte";

/** Endereços oficiais do Sistema Nacional (SEFIN). */
export const AMBIENTES_NFSE = {
  1: "https://sefin.nfse.gov.br/SefinNacional",
  2: "https://sefin.producaorestrita.nfse.gov.br/SefinNacional",
} as const;

const gzipBase64 = (texto: string) => gzipSync(Buffer.from(texto, "utf8")).toString("base64");
const deGzipBase64 = (b64: string) => gunzipSync(Buffer.from(b64, "base64")).toString("utf8");

export interface ErroNfse {
  codigo: string;
  descricao: string;
  complemento?: string;
}

type Json = Record<string, unknown>;

/** Lê campo ignorando maiúsculas/minúsculas (a API devolve "Codigo", "codigo", "idDPS", "idDps"…). */
function campo(json: Json | null, nome: string): unknown {
  if (!json) return undefined;
  const chave = Object.keys(json).find((k) => k.toLowerCase() === nome.toLowerCase());
  return chave === undefined ? undefined : json[chave];
}

/** Normaliza a lista de erros, que vem em formatos diferentes conforme a rota e a versão da API. */
export function lerErros(json: Json | null, statusHttp: number, corpo: string): ErroNfse[] {
  const bruto = campo(json, "erros") ?? campo(json, "erro");
  const lista = Array.isArray(bruto) ? bruto : bruto ? [bruto] : [];
  const erros = lista.map((e): ErroNfse => {
    if (typeof e === "string") return { codigo: "", descricao: e };
    const o = e as Json;
    const complemento = campo(o, "complemento");
    return {
      codigo: String(campo(o, "codigo") ?? ""),
      descricao: String(campo(o, "descricao") ?? campo(o, "mensagem") ?? ""),
      ...(complemento ? { complemento: String(complemento) } : {}),
    };
  });
  if (erros.length === 0 && statusHttp >= 400) {
    erros.push({
      codigo: `HTTP_${statusHttp}`,
      descricao:
        statusHttp === 403
          ? "Acesso negado: certificado recusado ou emitente não habilitado no ambiente."
          : corpo.slice(0, 300),
    });
  }
  return erros;
}

export interface RespostaNfse {
  statusHttp: number;
  json: Json | null;
  corpo: string;
}

export interface ResultadoEmissaoNfse {
  /** "pendente": sem resposta, o governo pode ter gerado a NFS-e. Resolva com `consultarDps(id)` */
  situacao: "autorizada" | "rejeitada" | "pendente";
  chave?: string;
  /** XML da NFS-e gerada pelo Sistema Nacional (é o documento fiscal que vale) */
  xmlNfse?: string;
  dataProcessamento?: string;
  erros: ErroNfse[];
  alertas: ErroNfse[];
  resposta?: RespostaNfse;
}

export interface OpcoesClienteNfse extends OpcoesAgenteMtls {
  ambiente: 1 | 2;
  /** Padrão 60 s */
  timeoutMs?: number;
  userAgent?: string;
  /** Para log/auditoria de cada chamada */
  aoRegistrar?: (registro: {
    metodo: string;
    url: string;
    statusHttp?: number;
    duracaoMs: number;
    erro?: string;
  }) => void;
  /** Substitui a chamada HTTPS (testes) */
  requisitar?: (pedido: PedidoHttps) => Promise<{ statusHttp: number; corpo: string }>;
}

export function criarClienteNfse(opcoes: OpcoesClienteNfse) {
  const base = AMBIENTES_NFSE[opcoes.ambiente];
  const agente = opcoes.requisitar ? null : criarAgenteMtls(opcoes);
  const requisitar =
    opcoes.requisitar ??
    ((p: PedidoHttps) => requisitarHttps(agente as NonNullable<typeof agente>, p));

  async function chamar(metodo: "GET" | "POST", rota: string, corpo?: Json): Promise<RespostaNfse> {
    const url = base + rota;
    const inicio = Date.now();
    try {
      const r = await requisitar({
        metodo,
        url,
        ...(corpo ? { corpo: JSON.stringify(corpo) } : {}),
        cabecalhos: {
          Accept: "application/json",
          "User-Agent": opcoes.userAgent ?? "@fiscal/nfse-nacional",
          ...(corpo ? { "Content-Type": "application/json" } : {}),
        },
        timeoutMs: opcoes.timeoutMs ?? 60_000,
        prefixoErro: "NFSE",
        nomeServidor: "O Sistema Nacional da NFS-e",
      });
      opcoes.aoRegistrar?.({
        metodo,
        url,
        statusHttp: r.statusHttp,
        duracaoMs: Date.now() - inicio,
      });
      let json: Json | null = null;
      try {
        json = JSON.parse(r.corpo) as Json;
      } catch {
        // resposta não-JSON (HTML de erro do servidor, por exemplo)
      }
      return { statusHttp: r.statusHttp, json, corpo: r.corpo };
    } catch (e) {
      opcoes.aoRegistrar?.({
        metodo,
        url,
        duracaoMs: Date.now() - inicio,
        erro: e instanceof Error ? e.message : String(e),
      });
      throw e;
    }
  }

  const xmlNfseDe = (json: Json | null) => {
    const b64 = campo(json, "nfseXmlGZipB64");
    return typeof b64 === "string" ? deGzipBase64(b64) : undefined;
  };

  return {
    /**
     * POST /nfse: envia a DPS assinada. Sem resposta → "pendente" (nunca reenvia sozinho:
     * a mesma DPS de novo daria "DPS duplicada"; consulte com `consultarDps`).
     */
    async emitir(xmlDpsAssinado: string): Promise<ResultadoEmissaoNfse> {
      let resposta: RespostaNfse;
      try {
        resposta = await chamar("POST", "/nfse", { dpsXmlGZipB64: gzipBase64(xmlDpsAssinado) });
      } catch (e) {
        if (podeTerSidoProcessado(e)) {
          return {
            situacao: "pendente",
            erros: [
              {
                codigo: e instanceof ErroFiscal ? e.codigo : "",
                descricao: e instanceof Error ? e.message : String(e),
              },
            ],
            alertas: [],
          };
        }
        throw e;
      }
      const { json, statusHttp, corpo } = resposta;
      const chave = campo(json, "chaveAcesso");
      const xmlNfse = xmlNfseDe(json);
      const alertas = lerErros({ erros: campo(json, "alertas") } as Json, 200, "");
      if ((statusHttp === 200 || statusHttp === 201) && typeof chave === "string" && xmlNfse) {
        return {
          situacao: "autorizada",
          chave,
          xmlNfse,
          ...(campo(json, "dataHoraProcessamento")
            ? { dataProcessamento: String(campo(json, "dataHoraProcessamento")) }
            : {}),
          erros: [],
          alertas,
          resposta,
        };
      }
      if (statusHttp >= 500 && !json) {
        // Servidor caiu no meio: pode ou não ter gerado
        return {
          situacao: "pendente",
          erros: lerErros(json, statusHttp, corpo),
          alertas,
          resposta,
        };
      }
      return { situacao: "rejeitada", erros: lerErros(json, statusHttp, corpo), alertas, resposta };
    },

    /** GET /nfse/{chave}: XML da NFS-e pela chave de acesso (50 dígitos). */
    async consultarNfse(chave: string) {
      const resposta = await chamar("GET", `/nfse/${chave}`);
      const xmlNfse = xmlNfseDe(resposta.json);
      return {
        encontrada: Boolean(xmlNfse),
        ...(xmlNfse ? { xmlNfse } : {}),
        erros: xmlNfse ? [] : lerErros(resposta.json, resposta.statusHttp, resposta.corpo),
        resposta,
      };
    },

    /** GET /dps/{id}: descobre a chave da NFS-e gerada a partir do Id da DPS (resolve "pendentes"). */
    async consultarDps(idDps: string) {
      const resposta = await chamar("GET", `/dps/${idDps}`);
      const chave = campo(resposta.json, "chaveAcesso");
      return {
        encontrada: typeof chave === "string" && chave.length === 50,
        ...(typeof chave === "string" ? { chave } : {}),
        erros:
          typeof chave === "string"
            ? []
            : lerErros(resposta.json, resposta.statusHttp, resposta.corpo),
        resposta,
      };
    },

    /** POST /nfse/{chave}/eventos: registra o evento (ex.: cancelamento e101101) já assinado. */
    async registrarEvento(chave: string, xmlEventoAssinado: string) {
      const resposta = await chamar("POST", `/nfse/${chave}/eventos`, {
        // Nome do campo conforme a API do Sistema Nacional (o curto "pedReg…" dá HTTP 500 genérico)
        pedidoRegistroEventoXmlGZipB64: gzipBase64(xmlEventoAssinado),
      });
      const b64 = campo(resposta.json, "eventoXmlGZipB64");
      const registrado = resposta.statusHttp === 200 || resposta.statusHttp === 201;
      return {
        registrado,
        ...(typeof b64 === "string" ? { xmlEvento: deGzipBase64(b64) } : {}),
        erros: registrado ? [] : lerErros(resposta.json, resposta.statusHttp, resposta.corpo),
        resposta,
      };
    },

    fechar: () => agente?.destroy(),
  };
}

export type ClienteNfse = ReturnType<typeof criarClienteNfse>;
