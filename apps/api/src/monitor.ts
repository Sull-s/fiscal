import type { Contexto } from "./contexto";
import type { ModeloRegistro } from "./registros";

/**
 * Monitoramento: o que pode parar a emissão de alguma empresa e precisa de gente olhando.
 * Roda junto com as rotinas (a cada 15 minutos) e fica disponível em GET /v1/admin/monitor.
 */

export type Gravidade = "critico" | "aviso";

export interface Alerta {
  /** Identifica o alerta (o mesmo problema mantém a mesma chave, para não repetir avisos) */
  chave: string;
  gravidade: Gravidade;
  empresa?: string;
  mensagem: string;
}

export interface SituacaoMonitor {
  geradoEm: string;
  alertas: Alerta[];
  empresas: {
    id: string;
    nome: string;
    ambiente: 1 | 2;
    certificadoValidoAte: string | null;
    diasCertificado: number | null;
    pendentes: number;
    offline: number;
  }[];
  sefaz: { uf: string; modelo: string; ambiente: number; emOperacao: boolean; motivo: string }[];
}

const DIA = 86_400_000;
const MODELOS: ModeloRegistro[] = ["65", "55", "nfse"];

export async function avaliarMonitor(
  ctx: Contexto,
  opcoes: { agora?: Date; consultarSefaz?: boolean } = {},
): Promise<SituacaoMonitor> {
  const agora = opcoes.agora ?? new Date();
  const alertas: Alerta[] = [];
  const empresas: SituacaoMonitor["empresas"] = [];
  const sefaz: SituacaoMonitor["sefaz"] = [];
  const consultadas = new Set<string>();

  for (const e of await ctx.deps.empresas.listar()) {
    const emite = Boolean(e.nfce || e.nfe || e.nfse);
    const validoAte = e.certificado?.validoAte ?? null;
    const dias = validoAte ? Math.floor((Date.parse(validoAte) - agora.getTime()) / DIA) : null;
    if (emite && !e.certificado) {
      alertas.push({
        chave: `${e.id}:sem-certificado`,
        gravidade: "critico",
        empresa: e.id,
        mensagem: `${e.nome}: sem certificado digital cadastrado; não consegue emitir.`,
      });
    } else if (dias !== null && dias < 0) {
      alertas.push({
        chave: `${e.id}:certificado-vencido`,
        gravidade: "critico",
        empresa: e.id,
        mensagem: `${e.nome}: certificado digital VENCIDO desde ${validoAte?.slice(0, 10)}.`,
      });
    } else if (dias !== null && dias <= 30) {
      alertas.push({
        chave: `${e.id}:certificado-vencendo`,
        gravidade: dias <= 7 ? "critico" : "aviso",
        empresa: e.id,
        mensagem: `${e.nome}: certificado digital vence em ${dias} dia(s) (${validoAte?.slice(0, 10)}). Renove e envie o novo.`,
      });
    }

    // Notas presas: pendente há mais de 30 min; offline há mais de 6 h (o prazo legal é curto)
    let pendentes = 0;
    let offline = 0;
    for (const modelo of MODELOS) {
      for (const situacao of ["pendente", "offline"] as const) {
        const ids = await ctx.registros.listarEmAberto(e.id, modelo, e.ambiente, situacao);
        if (situacao === "pendente") pendentes += ids.length;
        else offline += ids.length;
        for (const id of ids) {
          const r = await ctx.registros.obter(e.id, modelo, e.ambiente, id);
          if (!r) continue;
          const horas = (agora.getTime() - Date.parse(r.criadaEm)) / 3_600_000;
          const limite = situacao === "pendente" ? 0.5 : 6;
          if (horas >= limite) {
            alertas.push({
              chave: `${e.id}:${situacao}:${id}`,
              gravidade: "critico",
              empresa: e.id,
              mensagem: `${e.nome}: nota ${modelo === "nfse" ? "NFS-e" : modelo === "55" ? "NF-e" : "NFC-e"} nº ${r.numero} ${situacao === "pendente" ? "pendente" : "offline sem transmitir"} há ${Math.floor(horas)} h${horas < 1 ? ` ${Math.round(horas * 60)} min` : ""}.`,
            });
          }
        }
      }
    }

    // Webhooks que desistiram hoje
    if (e.webhook) {
      const hoje = agora.toISOString().slice(0, 10);
      const falhas = (await ctx.webhooks.listar(e.id, hoje)).filter((x) => x.situacao === "falhou");
      if (falhas.length) {
        alertas.push({
          chave: `${e.id}:webhook-falhou:${hoje}`,
          gravidade: "aviso",
          empresa: e.id,
          mensagem: `${e.nome}: ${falhas.length} aviso(s) de webhook não entregue(s) hoje (${e.webhook.url}).`,
        });
      }
    }

    // SEFAZ do estado (uma consulta por UF/modelo/ambiente)
    const emitente = e.nfce?.emitente ?? e.nfe?.emitente;
    if (opcoes.consultarSefaz && emitente && e.certificado) {
      const modelo = e.nfce ? "65" : "55";
      const chave = `${emitente.endereco.uf}:${modelo}:${e.ambiente}`;
      if (!consultadas.has(chave)) {
        consultadas.add(chave);
        try {
          const st = await ctx
            .sefaz(e)
            .consultarStatus({ uf: emitente.endereco.uf, modelo, ambiente: e.ambiente });
          sefaz.push({
            uf: emitente.endereco.uf,
            modelo,
            ambiente: e.ambiente,
            emOperacao: st.emOperacao,
            motivo: st.xMotivo,
          });
          if (!st.emOperacao) {
            alertas.push({
              chave: `sefaz:${chave}`,
              gravidade: "critico",
              mensagem: `SEFAZ ${emitente.endereco.uf} (modelo ${modelo}) fora de operação: ${st.cStat} ${st.xMotivo}.`,
            });
          }
          if (Math.abs(st.diferencaRelogioSegundos ?? 0) > 60) {
            alertas.push({
              chave: "relogio",
              gravidade: "aviso",
              mensagem: `Relógio do servidor difere da SEFAZ em ${st.diferencaRelogioSegundos} s: acerte a hora (NTP), senão a SEFAZ rejeita as notas.`,
            });
          }
        } catch (erro) {
          sefaz.push({
            uf: emitente.endereco.uf,
            modelo,
            ambiente: e.ambiente,
            emOperacao: false,
            motivo: erro instanceof Error ? erro.message : String(erro),
          });
          alertas.push({
            chave: `sefaz:${chave}`,
            gravidade: "critico",
            mensagem: `SEFAZ ${emitente.endereco.uf} (modelo ${modelo}) não respondeu: ${erro instanceof Error ? erro.message : String(erro)}`,
          });
        }
      }
    }

    empresas.push({
      id: e.id,
      nome: e.nome,
      ambiente: e.ambiente,
      certificadoValidoAte: validoAte,
      diasCertificado: dias,
      pendentes,
      offline,
    });
  }

  alertas.sort((a, b) => (a.gravidade === b.gravidade ? 0 : a.gravidade === "critico" ? -1 : 1));
  return { geradoEm: agora.toISOString(), alertas, empresas, sefaz };
}

export type EnviarAlertas = (alertas: Alerta[]) => Promise<void>;

/** Envia alertas para um webhook simples (Slack, Discord, Teams via conector…): `{ text }`. */
export function alertasPorUrl(url: string): EnviarAlertas {
  return async (alertas) => {
    const texto = alertas
      .map((a) => `${a.gravidade === "critico" ? "🔴" : "🟡"} ${a.mensagem}`)
      .join("\n");
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // "content" para Discord, "text" para Slack e afins
      body: JSON.stringify({ text: texto, content: texto }),
      signal: AbortSignal.timeout(10_000),
    });
  };
}

const INTERVALO_MS = 15 * 60_000;
/** O mesmo alerta só é avisado de novo depois de 6 horas */
const REPETIR_MS = 6 * 3_600_000;

/**
 * Chamado pelas rotinas: avalia a cada 15 minutos e avisa só os alertas novos (ou que voltaram
 * a valer depois de 6 h). Os avisos também vão para o webhook da empresa como evento "alerta".
 */
export async function vigiar(
  ctx: Contexto,
  enviar: EnviarAlertas | undefined,
  agora = new Date(),
): Promise<{ avaliou: boolean; enviados: number }> {
  const caminho = "_monitor/estado.json";
  const bytes = await ctx.deps.arquivos.ler(caminho);
  const estado = bytes
    ? (JSON.parse(new TextDecoder().decode(bytes)) as {
        ultima: string;
        avisados: Record<string, string>;
      })
    : { ultima: new Date(0).toISOString(), avisados: {} };
  if (agora.getTime() - Date.parse(estado.ultima) < INTERVALO_MS) {
    return { avaliou: false, enviados: 0 };
  }

  const { alertas } = await avaliarMonitor(ctx, { agora, consultarSefaz: true });
  const novos = alertas.filter((a) => {
    const antes = estado.avisados[a.chave];
    return !antes || agora.getTime() - Date.parse(antes) >= REPETIR_MS;
  });
  if (novos.length) {
    if (enviar) await enviar(novos).catch(() => {});
    for (const a of novos) {
      estado.avisados[a.chave] = agora.toISOString();
      if (a.empresa) await ctx.webhooks.publicar(a.empresa, "alerta", a);
    }
  }
  // Esquece alertas que já se resolveram
  const ativos = new Set(alertas.map((a) => a.chave));
  for (const chave of Object.keys(estado.avisados)) {
    if (!ativos.has(chave)) delete estado.avisados[chave];
  }
  estado.ultima = agora.toISOString();
  await ctx.deps.arquivos.gravar(
    caminho,
    new TextEncoder().encode(JSON.stringify(estado)),
    "application/json",
  );
  return { avaliou: true, enviados: novos.length };
}
