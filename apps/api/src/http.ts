import { ErroFiscal } from "@fiscal/core";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Contexto } from "./contexto";
import type { Empresa } from "./empresas";

export type Ambiente = { Variables: { empresa: Empresa; ctx: Contexto } };

/** Erros de rede: tentar de novo mais tarde resolve. */
const INDISPONIVEL = /_(SEM_CONEXAO|SEM_RESPOSTA|PARALISADA)$/;

export function statusDoErro(erro: ErroFiscal): ContentfulStatusCode {
  if (INDISPONIVEL.test(erro.codigo)) return 503;
  if (erro.codigo.startsWith("CERTIFICADO_")) return 409;
  return 422;
}

/** Formato único de erro da API: { erro: { codigo, mensagem, detalhes? } } */
export function responderErro(erro: unknown, c: Context) {
  if (erro instanceof ErroFiscal) {
    return c.json(
      {
        erro: {
          codigo: erro.codigo,
          mensagem: erro.message,
          ...(erro.detalhes ? { detalhes: erro.detalhes } : {}),
        },
      },
      erro instanceof ErroHttp ? erro.status : statusDoErro(erro),
    );
  }
  if (erro instanceof HTTPException) {
    return c.json({ erro: { codigo: `HTTP_${erro.status}`, mensagem: erro.message } }, erro.status);
  }
  console.error("[api] erro inesperado:", erro);
  return c.json({ erro: { codigo: "ERRO_INTERNO", mensagem: "Erro interno." } }, 500);
}

export function falhar(status: ContentfulStatusCode, codigo: string, mensagem: string): never {
  throw new ErroHttp(status, codigo, mensagem);
}

/** Erro com status HTTP explícito (404, 400…), no mesmo formato dos demais. */
export class ErroHttp extends ErroFiscal {
  constructor(
    readonly status: ContentfulStatusCode,
    codigo: string,
    mensagem: string,
  ) {
    super(codigo, mensagem);
  }
}

export async function lerCorpo<T>(c: Context): Promise<T> {
  try {
    return (await c.req.json()) as T;
  } catch {
    return falhar(400, "JSON_INVALIDO", "Corpo da requisição não é um JSON válido.");
  }
}
