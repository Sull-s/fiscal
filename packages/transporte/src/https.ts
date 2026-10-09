import { Agent, request } from "node:https";
import { rootCertificates } from "node:tls";
import { ErroFiscal } from "@fiscal/core";
import { RAIZES_ICP_BRASIL } from "./raizes-icp";

export interface OpcoesAgenteMtls {
  /** Chave e cadeia do certificado do emitente (CertificadoA1 de @fiscal/certificado serve) */
  certificado: { chavePrivadaPem: string; cadeiaPem: string };
  /** ACs confiáveis para o certificado do servidor (padrão: raízes do Node + ICP-Brasil) */
  autoridades?: readonly string[];
}

/**
 * Agente HTTPS que apresenta o certificado do emitente (mTLS) e mantém conexões abertas.
 * Usa PEM, nunca o .pfx cru: o OpenSSL 3 do Node recusa PKCS#12 com RC2-40 (comum na ICP-Brasil).
 */
export function criarAgenteMtls(opcoes: OpcoesAgenteMtls): Agent {
  return new Agent({
    keepAlive: true,
    minVersion: "TLSv1.2",
    key: opcoes.certificado.chavePrivadaPem,
    cert: opcoes.certificado.cadeiaPem,
    ca: [...(opcoes.autoridades ?? [...rootCertificates, ...RAIZES_ICP_BRASIL])],
  });
}

export interface PedidoHttps {
  metodo: "GET" | "POST" | "PUT" | "DELETE";
  url: string;
  corpo?: string;
  cabecalhos?: Record<string, string>;
  timeoutMs: number;
  /** Prefixo dos códigos de erro: "SEFAZ" → SEFAZ_SEM_RESPOSTA, SEFAZ_SEM_CONEXAO */
  prefixoErro: string;
  /** Como o servidor aparece nas mensagens: "A SEFAZ", "O Sistema Nacional da NFS-e" */
  nomeServidor: string;
}

const DICAS: Record<string, string> = {
  CERT_HAS_EXPIRED: "O certificado está vencido.",
  UNABLE_TO_VERIFY_LEAF_SIGNATURE:
    "Cadeia do servidor não verificada: confira a data/hora do computador.",
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY: "A AC do servidor não está entre as autoridades confiáveis.",
  ECONNRESET: "Conexão cortada: muitas vezes o servidor recusou o certificado do emitente.",
  EPROTO: "Falha no handshake TLS: certificado do emitente inválido ou não aceito.",
  ENOTFOUND: "Endereço não encontrado: confira a internet/DNS.",
  ECONNREFUSED: "Servidor recusou a conexão (fora do ar?).",
};

/**
 * Faz a requisição e classifica falhas de rede com `detalhes.podeTerSidoProcessado`:
 * false se o pedido não chegou inteiro ao servidor (seguro repetir), true se chegou e não houve
 * resposta (pode ter sido processado: consulte antes de repetir operações que mudam algo).
 */
export function requisitarHttps(agente: Agent, pedido: PedidoHttps) {
  const { url, corpo, timeoutMs, prefixoErro, nomeServidor } = pedido;
  const host = new URL(url).host;
  return new Promise<{ statusHttp: number; corpo: string; cabecalhos: Record<string, unknown> }>(
    (ok, falha) => {
      let enviado = false;
      const req = request(url, {
        method: pedido.metodo,
        agent: agente,
        headers: {
          ...pedido.cabecalhos,
          ...(corpo !== undefined ? { "Content-Length": String(Buffer.byteLength(corpo)) } : {}),
        },
      });
      const relogio = setTimeout(() => {
        req.destroy(
          new ErroFiscal(
            `${prefixoErro}_SEM_RESPOSTA`,
            `${nomeServidor} não respondeu em ${timeoutMs / 1000} segundos.`,
            { podeTerSidoProcessado: enviado },
          ),
        );
      }, timeoutMs);

      req.on("finish", () => {
        enviado = true;
      });
      req.on("response", (res) => {
        const partes: Buffer[] = [];
        res.on("data", (c: Buffer) => partes.push(c));
        res.on("end", () => {
          clearTimeout(relogio);
          ok({
            statusHttp: res.statusCode ?? 0,
            corpo: Buffer.concat(partes).toString("utf8"),
            cabecalhos: res.headers,
          });
        });
        res.on("error", (e) => {
          clearTimeout(relogio);
          falha(e);
        });
      });
      req.on("error", (e: Error & { code?: string }) => {
        clearTimeout(relogio);
        if (e instanceof ErroFiscal) return falha(e);
        const causa = e.code ?? e.message;
        const dica = e.code ? DICAS[e.code] : undefined;
        falha(
          enviado
            ? new ErroFiscal(
                `${prefixoErro}_SEM_RESPOSTA`,
                `A conexão com ${host} caiu antes da resposta (${causa}).`,
                { podeTerSidoProcessado: true, causa, dica },
              )
            : new ErroFiscal(
                `${prefixoErro}_SEM_CONEXAO`,
                `Não consegui conectar em ${host} (${causa}).${dica ? ` ${dica}` : ""}`,
                { podeTerSidoProcessado: false, causa, dica },
              ),
        );
      });
      req.end(corpo);
    },
  );
}
