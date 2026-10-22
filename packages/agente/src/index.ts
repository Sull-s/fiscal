import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { type ServicoFiscal, gerarChaveMestra, iniciarServicoFiscal } from "@fiscal/api";

/**
 * Emissor fiscal EMBUTIDO no app: o mesmo serviço do agente local (numeração, XMLs, contingência
 * offline, rotinas, backup), rodando dentro do processo do app — sem servidor, sem porta aberta
 * e sem o cliente baixar nada separado. Feito para o processo principal do Electron (ou qualquer
 * programa Node instalado no PC).
 *
 *   const agente = await iniciarAgente({
 *     pastaDados: join(app.getPath("userData"), "fiscal"),
 *     chaveMestra: () => chaveMestraProtegida({ arquivo, proteger, abrir }),
 *   });
 *   const r = await agente.fetch("/v1/nfce", { method: "POST", body: JSON.stringify(venda) });
 *
 * Uma empresa por instalação (id "principal"). A tela de configuração (@fiscal/ui
 * ConfigurarEmissor) grava CNPJ, endereço, certificado A1 e senha pelas rotas /v1/admin; as
 * vendas usam as rotas /v1. A autenticação das duas é feita aqui dentro: o app nunca vê token.
 */
export interface OpcoesAgente {
  /** Pasta dos dados fiscais (XMLs, numeração, cadastro). Ex.: userData/fiscal */
  pastaDados: string;
  /**
   * Chave que cifra o certificado e a senha. Guarde-a com a proteção do sistema operacional
   * (veja chaveMestraProtegida); nunca no código nem em arquivo aberto.
   */
  chaveMestra: () => string | Promise<string>;
  /** Cópia de hora em hora dos XMLs (ponha uma pasta do OneDrive/Google Drive do cliente) */
  pastaBackup?: string;
  /** Webhook para alertas (Discord, Slack…): certificado vencendo, SEFAZ fora, nota presa */
  alertaUrl?: string;
  /** Recebe os eventos (chamadas à SEFAZ, rotinas). Padrão: console.log */
  aoRegistrar?: (evento: Record<string, unknown>) => void;
  /** Padrão "principal" */
  empresaId?: string;
}

export interface Agente {
  /**
   * Chamada à API fiscal sem rede: caminho relativo ("/v1/nfce", "/v1/admin/empresas/principal")
   * ou URL qualquer (só o caminho é usado). A autenticação é acrescentada aqui.
   */
  fetch(entrada: string | URL | Request, init?: RequestInit): Promise<Response>;
  /** Id da empresa desta instalação */
  readonly empresaId: string;
  /** true quando a empresa está cadastrada e com certificado (já pode emitir) */
  configurado(): Promise<boolean>;
  /** O serviço completo (rotinas, contexto, ouvir em porta para outro app local) */
  readonly servico: ServicoFiscal;
  /** Para rotinas e fecha o banco. Chame ao sair do app */
  parar(): Promise<void>;
}

export async function iniciarAgente(opcoes: OpcoesAgente): Promise<Agente> {
  const empresaId = opcoes.empresaId ?? "principal";
  // Token do administrador só na memória deste processo: nada para vazar em disco
  const tokenAdmin = randomBytes(32).toString("base64url");
  const servico = await iniciarServicoFiscal({
    chaveMestra: await opcoes.chaveMestra(),
    pastaDados: opcoes.pastaDados,
    tokenAdmin,
    ...(opcoes.pastaBackup ? { pastaBackup: opcoes.pastaBackup } : {}),
    ...(opcoes.alertaUrl ? { alertaUrl: opcoes.alertaUrl } : {}),
    ...(opcoes.aoRegistrar ? { aoRegistrar: opcoes.aoRegistrar } : {}),
  });

  const interno = (caminho: string, init: RequestInit = {}, token?: string) => {
    const cabecalhos = new Headers(init.headers);
    if (token) cabecalhos.set("Authorization", `Bearer ${token}`);
    return servico.fetch(
      new Request(new URL(caminho, "http://agente.local"), { ...init, headers: cabecalhos }),
    );
  };
  const admin = (caminho: string, init: RequestInit = {}) =>
    interno(`/v1/admin${caminho}`, init, tokenAdmin);

  // Chave de API da empresa: criada sob demanda, só na memória. As de execuções anteriores são
  // apagadas na primeira vez (nesta instalação só o próprio app usa a empresa).
  let chaveApi: string | null = null;
  let limpou = false;
  async function obterChaveApi(): Promise<string | null> {
    if (chaveApi) return chaveApi;
    const r = await admin(`/empresas/${empresaId}`);
    if (r.status === 404) return null;
    const empresa = (await r.json()) as { chavesApi?: { id: string }[] };
    if (!limpou) {
      for (const k of empresa.chavesApi ?? [])
        await admin(`/empresas/${empresaId}/chaves/${k.id}`, { method: "DELETE" });
      limpou = true;
    }
    const nova = (await (
      await admin(`/empresas/${empresaId}/chaves`, { method: "POST" })
    ).json()) as {
      chave: string;
    };
    chaveApi = nova.chave;
    return chaveApi;
  }

  return {
    empresaId,
    servico,
    async fetch(entrada, init) {
      const requisicao = entrada instanceof Request ? entrada : null;
      const url = new URL(requisicao ? requisicao.url : String(entrada), "http://agente.local");
      const caminho = url.pathname + url.search;
      const pedido: RequestInit = requisicao
        ? {
            method: requisicao.method,
            headers: requisicao.headers,
            ...(requisicao.method !== "GET" && requisicao.method !== "HEAD"
              ? { body: await requisicao.arrayBuffer() }
              : {}),
            ...init,
          }
        : (init ?? {});
      if (url.pathname.startsWith("/v1/admin")) return interno(caminho, pedido, tokenAdmin);
      if (url.pathname.startsWith("/v1/")) {
        const chave = await obterChaveApi();
        if (!chave) {
          return Response.json(
            {
              erro: {
                codigo: "EMISSOR_NAO_CONFIGURADO",
                mensagem: "Configure a nota fiscal (empresa e certificado) antes de emitir.",
              },
            },
            { status: 409 },
          );
        }
        const r = await interno(caminho, pedido, chave);
        // Chave apagada por fora (ex.: reinstalação): gera outra e tenta uma vez
        if (r.status !== 401) return r;
        chaveApi = null;
        const outra = await obterChaveApi();
        return outra ? interno(caminho, pedido, outra) : r;
      }
      return interno(caminho, pedido);
    },
    async configurado() {
      const r = await admin(`/empresas/${empresaId}`);
      if (!r.ok) return false;
      const e = (await r.json()) as { certificado?: unknown };
      return Boolean(e.certificado);
    },
    parar: () => servico.parar(),
  };
}

/**
 * Chave mestra guardada com a proteção do sistema operacional: gerada na primeira execução,
 * gravada CIFRADA por `proteger` e lida de volta por `abrir`. No Electron (≥ 38, API assíncrona):
 *
 *   chaveMestraProtegida({
 *     arquivo: join(app.getPath("userData"), "fiscal", "chave.bin"),
 *     proteger: (t) => safeStorage.encryptStringAsync(t),
 *     abrir: (b) => safeStorage.decryptStringAsync(b),
 *   })
 *
 * No Windows o safeStorage usa o DPAPI: só este usuário, neste PC, abre a chave. Se o arquivo
 * se perder, os certificados cadastrados não abrem mais (basta enviar o A1 de novo pela tela).
 * `abrir` pode devolver o texto ou { result, shouldReEncrypt } (safeStorage): quando o sistema
 * pede, a chave é cifrada de novo e regravada.
 */
export async function chaveMestraProtegida(opcoes: {
  arquivo: string;
  proteger: (texto: string) => Uint8Array | Promise<Uint8Array>;
  abrir: (
    dados: Buffer,
  ) =>
    | string
    | { result: string; shouldReEncrypt?: boolean }
    | Promise<string | { result: string; shouldReEncrypt?: boolean }>;
}): Promise<string> {
  if (existsSync(opcoes.arquivo)) {
    const aberto = await opcoes.abrir(readFileSync(opcoes.arquivo));
    if (typeof aberto === "string") return aberto;
    if (aberto.shouldReEncrypt) writeFileSync(opcoes.arquivo, await opcoes.proteger(aberto.result));
    return aberto.result;
  }
  const chave = gerarChaveMestra();
  mkdirSync(dirname(opcoes.arquivo), { recursive: true });
  writeFileSync(opcoes.arquivo, await opcoes.proteger(chave));
  return chave;
}

export type { ServicoFiscal } from "@fiscal/api";
