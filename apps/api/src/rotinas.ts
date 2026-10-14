import type { Contexto } from "./contexto";
import { vigiar } from "./monitor";
import { sincronizarDfe } from "./servicos/dfe";
import {
  MODELO_NFCE,
  type Operacao,
  resolverPendenteNfce,
  transmitirOfflineNfce,
} from "./servicos/nfce";
import { MODELO_NFE, resolverPendenteNfe } from "./servicos/nfe";
import { MODELO_NFSE, resolverPendenteNfse } from "./servicos/nfse";

export interface ResumoRotinas {
  transmitidasOffline: number;
  pendentesResolvidas: number;
  /** Documentos novos baixados da distribuição DF-e */
  dfeNovos: number;
  webhooks: { entregues: number; pendentes: number };
  /** Alertas novos enviados pelo monitoramento nesta rodada */
  alertas: number;
  erros: { empresa: string; erro: string }[];
}

/**
 * Trabalho de fundo, para rodar de tempos em tempos (o servidor chama a cada minuto):
 *  1. transmite as NFC-e offline (se a SEFAZ voltou);
 *  2. resolve NFC-e e NFS-e pendentes (sem resposta na emissão) consultando pela chave/Id da DPS;
 *  3. baixa as notas de fornecedores (DF-e), de hora em hora, nas empresas que ativaram;
 *  4. monitora (a cada 15 min) certificados, notas presas, SEFAZ e relógio, e avisa;
 *  5. reenvia webhooks que falharam.
 * Cada mudança de situação gera webhook. Uma empresa com problema não atrapalha as outras.
 */
export async function executarRotinas(
  ctx: Contexto,
  opcoes: { agora?: Date; idadeMinimaPendenteMs?: number } = {},
): Promise<ResumoRotinas> {
  const agora = opcoes.agora ?? new Date();
  // Dá tempo para a própria emissão (ou o cliente) resolver antes de a rotina consultar
  const idadeMinima = opcoes.idadeMinimaPendenteMs ?? 60_000;
  const resumo: ResumoRotinas = {
    transmitidasOffline: 0,
    pendentesResolvidas: 0,
    dfeNovos: 0,
    webhooks: { entregues: 0, pendentes: 0 },
    alertas: 0,
    erros: [],
  };

  for (const cadastrada of await ctx.deps.empresas.listar()) {
    if (!cadastrada.certificado) continue;
    // Empresa em produção também pode ter notas de teste (tela de testes, Fiscal-Ambiente: 2)
    for (const ambiente of cadastrada.ambiente === 1 ? ([1, 2] as const) : ([2] as const)) {
      const empresa = { ...cadastrada, ambiente };
      const op: Operacao = { ctx, empresa };
      const { registros } = ctx;
      try {
        if (empresa.nfce) {
          const offline = await registros.listarEmAberto(
            empresa.id,
            MODELO_NFCE,
            empresa.ambiente,
            "offline",
          );
          if (offline.length) {
            const t = await transmitirOfflineNfce(op);
            resumo.transmitidasOffline += t.transmitidas.filter(
              (x) => x.situacao !== "offline",
            ).length;
          }
        }
        for (const [modelo, resolver] of [
          [MODELO_NFCE, resolverPendenteNfce],
          [MODELO_NFE, resolverPendenteNfe],
          [MODELO_NFSE, resolverPendenteNfse],
        ] as const) {
          const configurado = { "65": empresa.nfce, "55": empresa.nfe, nfse: empresa.nfse }[modelo];
          if (!configurado) continue;
          const ids = await registros.listarEmAberto(
            empresa.id,
            modelo,
            empresa.ambiente,
            "pendente",
          );
          for (const id of ids) {
            const r = await registros.obter(empresa.id, modelo, empresa.ambiente, id);
            if (!r || agora.getTime() - Date.parse(r.criadaEm) < idadeMinima) continue;
            if ((await resolver(op, r)).situacao !== "pendente") resumo.pendentesResolvidas++;
          }
        }
        // Notas de fornecedores: sincronizarDfe só consulta quando a espera de 1 hora já passou
        if (empresa.dfe?.ativo && ambiente === cadastrada.ambiente)
          resumo.dfeNovos += (await sincronizarDfe(op, agora)).novos;
      } catch (erro) {
        const mensagem = erro instanceof Error ? erro.message : String(erro);
        resumo.erros.push({ empresa: empresa.id, erro: mensagem });
        ctx.deps.aoRegistrar?.({ empresa: empresa.id, rotina: "erro", erro: mensagem });
      }
    }
  }

  resumo.alertas = (await vigiar(ctx, ctx.deps.enviarAlertas, agora)).enviados;
  resumo.webhooks = await ctx.webhooks.processar(agora);
  return resumo;
}
