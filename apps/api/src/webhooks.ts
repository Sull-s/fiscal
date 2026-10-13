import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { ArmazemArquivos } from "@fiscal/armazenamento";
import { ErroFiscal } from "@fiscal/core";
import type { Cofre } from "./cofre";
import type { Empresa, RepositorioEmpresas } from "./empresas";

/**
 * Webhooks: avisam o sistema do cliente quando uma nota muda de situação (ex.: pendente →
 * autorizada, offline transmitida, cancelada), sem ele precisar ficar consultando.
 *
 * Entrega "pelo menos uma vez": o mesmo evento pode chegar repetido (use `id` para ignorar
 * duplicados). Cada envio é assinado com HMAC-SHA256 do segredo da empresa:
 *   Fiscal-Assinatura: t=<unix>,v1=<hex de HMAC(segredo, "<t>.<corpo>")>
 */

export interface EventoWebhook {
  /** evt_… único; o mesmo em todas as tentativas */
  id: string;
  /** "nfce.autorizada", "nfce.offline", "nfse.cancelada", "teste"… */
  tipo: string;
  empresa: string;
  criadoEm: string;
  dados: unknown;
}

interface Entrega {
  evento: EventoWebhook;
  url: string;
  situacao: "pendente" | "entregue" | "falhou";
  tentativas: number;
  proximaTentativa: string;
  ultimoStatus?: number;
  ultimoErro?: string;
  entregueEm?: string;
}

export type EnviarWebhook = (pedido: {
  url: string;
  corpo: string;
  cabecalhos: Record<string, string>;
}) => Promise<number>;

/** Espera antes de cada nova tentativa: 1 min, 5 min, 30 min, 2 h, 6 h, 12 h (≈ 21 h no total). */
export const ESPERAS_MS = [60_000, 300_000, 1_800_000, 7_200_000, 21_600_000, 43_200_000];
/** Dias olhados a cada rodada (cobre as ≈ 21 h de tentativas com folga). */
const DIAS_NA_FILA = 3;

export const enviarComFetch: EnviarWebhook = async ({ url, corpo, cabecalhos }) => {
  const r = await fetch(url, {
    method: "POST",
    headers: cabecalhos,
    body: corpo,
    signal: AbortSignal.timeout(10_000),
    redirect: "manual",
  });
  return r.status;
};

export function assinarWebhook(segredo: string, corpo: string, momento: Date) {
  const t = Math.floor(momento.getTime() / 1000);
  const v1 = createHmac("sha256", segredo).update(`${t}.${corpo}`).digest("hex");
  return `t=${t},v1=${v1}`;
}

/**
 * Confere a assinatura de um webhook recebido (para o sistema do cliente copiar).
 * Recusa assinaturas com mais de `toleranciaSegundos` (evita reenvio de mensagens antigas).
 */
export function verificarWebhook(
  segredo: string,
  corpo: string,
  cabecalho: string,
  agora = new Date(),
  toleranciaSegundos = 300,
): boolean {
  const partes = Object.fromEntries(cabecalho.split(",").map((p) => p.split("=", 2)));
  const t = Number(partes.t);
  if (!Number.isFinite(t) || Math.abs(agora.getTime() / 1000 - t) > toleranciaSegundos) {
    return false;
  }
  const esperado = Buffer.from(createHmac("sha256", segredo).update(`${t}.${corpo}`).digest("hex"));
  const recebido = Buffer.from(String(partes.v1 ?? ""));
  return esperado.length === recebido.length && timingSafeEqual(esperado, recebido);
}

/** https sempre; http só para localhost (desenvolvimento). */
export function validarUrlWebhook(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new ErroFiscal("WEBHOOK_URL_INVALIDA", "URL do webhook inválida.");
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  if (!(u.protocol === "https:" || (u.protocol === "http:" && local))) {
    throw new ErroFiscal("WEBHOOK_URL_INVALIDA", "O webhook precisa ser https.");
  }
  return u.toString();
}

export const gerarSegredoWebhook = () => `whsec_${randomBytes(32).toString("base64url")}`;
const contextoSegredo = (empresa: string) => `${empresa}:webhook`;

export function criarWebhooks(deps: {
  armazem: ArmazemArquivos;
  empresas: RepositorioEmpresas;
  cofre: Cofre;
  enviar?: EnviarWebhook;
}) {
  const { armazem, cofre } = deps;
  const enviar = deps.enviar ?? enviarComFetch;
  const dia = (d: Date) => d.toISOString().slice(0, 10);
  const pasta = (empresa: string, d: string) => `_webhooks/${empresa}/${d}/`;
  const json = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));
  const ler = async (caminho: string) => {
    const b = await armazem.ler(caminho);
    return b ? (JSON.parse(new TextDecoder().decode(b)) as Entrega) : null;
  };

  // Primeira tentativa corre em segundo plano: a resposta da API não espera o sistema do cliente
  const emAndamento = new Set<Promise<unknown>>();

  async function tentar(empresa: Empresa, caminho: string, e: Entrega, agora: Date) {
    const segredo = empresa.webhook
      ? cofre.decifrar(empresa.webhook.segredo, contextoSegredo(empresa.id)).toString("utf8")
      : "";
    const corpo = JSON.stringify(e.evento);
    e.tentativas++;
    try {
      const status = await enviar({
        url: e.url,
        corpo,
        cabecalhos: {
          "Content-Type": "application/json",
          "User-Agent": "fiscal-webhooks/1",
          "Fiscal-Evento-Id": e.evento.id,
          "Fiscal-Evento-Tipo": e.evento.tipo,
          "Fiscal-Assinatura": assinarWebhook(segredo, corpo, agora),
        },
      });
      e.ultimoStatus = status;
      if (status >= 200 && status < 300) {
        e.situacao = "entregue";
        e.entregueEm = agora.toISOString();
      } else {
        e.ultimoErro = `HTTP ${status}`;
      }
    } catch (erro) {
      e.ultimoErro = erro instanceof Error ? erro.message : String(erro);
    }
    if (e.situacao === "pendente") {
      const espera = ESPERAS_MS[e.tentativas - 1];
      if (espera === undefined) e.situacao = "falhou";
      else e.proximaTentativa = new Date(agora.getTime() + espera).toISOString();
    }
    await armazem.gravar(caminho, json(e), "application/json");
    return e;
  }

  return {
    /**
     * Cria o evento e dispara a primeira entrega em segundo plano (falhas ficam para `processar`).
     * Sem webhook configurado, não faz nada.
     */
    async publicar(empresaId: string, tipo: string, dados: unknown, agora = new Date()) {
      const empresa = await deps.empresas.obter(empresaId);
      if (!empresa?.webhook) return null;
      const evento: EventoWebhook = {
        id: `evt_${randomBytes(12).toString("hex")}`,
        tipo,
        empresa: empresaId,
        criadoEm: agora.toISOString(),
        dados,
      };
      const entrega: Entrega = {
        evento,
        url: empresa.webhook.url,
        situacao: "pendente",
        tentativas: 0,
        proximaTentativa: agora.toISOString(),
      };
      const caminho = `${pasta(empresaId, dia(agora))}${agora.getTime()}-${evento.id}.json`;
      await armazem.gravar(caminho, json(entrega), "application/json");
      const envio: Promise<unknown> = tentar(empresa, caminho, entrega, agora)
        .catch(() => {})
        .finally(() => emAndamento.delete(envio));
      emAndamento.add(envio);
      return evento;
    },

    /** Espera as primeiras entregas em andamento (testes e desligamento do servidor). */
    async aguardar() {
      while (emAndamento.size) await Promise.all([...emAndamento]);
    },

    /** Reenvia o que está pendente e já passou da hora. Chamado pelas rotinas. */
    async processar(agora = new Date()) {
      let entregues = 0;
      let pendentes = 0;
      for (const empresa of await deps.empresas.listar()) {
        if (!empresa.webhook) continue;
        for (let d = DIAS_NA_FILA - 1; d >= 0; d--) {
          const prefixo = pasta(empresa.id, dia(new Date(agora.getTime() - d * 86_400_000)));
          for (const caminho of await armazem.listar(prefixo)) {
            const e = await ler(caminho);
            if (e?.situacao !== "pendente") continue;
            if (new Date(e.proximaTentativa) > agora) {
              pendentes++;
              continue;
            }
            const r = await tentar(empresa, caminho, e, agora);
            if (r.situacao === "entregue") entregues++;
            else if (r.situacao === "pendente") pendentes++;
          }
        }
      }
      return { entregues, pendentes };
    },

    /** Entregas de um dia (AAAA-MM-DD), para conferir o que foi enviado. */
    async listar(empresaId: string, diaIso: string) {
      const entregas = await Promise.all(
        (await armazem.listar(pasta(empresaId, diaIso))).map((c) => ler(c)),
      );
      return entregas
        .filter((e): e is Entrega => e !== null)
        .map(({ evento, situacao, tentativas, ultimoStatus, ultimoErro, entregueEm }) => ({
          id: evento.id,
          tipo: evento.tipo,
          criadoEm: evento.criadoEm,
          situacao,
          tentativas,
          ...(ultimoStatus !== undefined ? { ultimoStatus } : {}),
          ...(ultimoErro && situacao !== "entregue" ? { ultimoErro } : {}),
          ...(entregueEm ? { entregueEm } : {}),
        }));
    },

    cifrarSegredo: (empresaId: string, segredo: string) =>
      cofre.cifrar(segredo, contextoSegredo(empresaId)),
  };
}

export type Webhooks = ReturnType<typeof criarWebhooks>;
