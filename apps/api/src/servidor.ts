import { mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import {
  type ArmazemArquivos,
  armazemDisco,
  armazemPostgres as arquivosPostgres,
} from "@fiscal/armazenamento";
import { armazemPostgres, prepararTabelas } from "@fiscal/numeracao";
import { serve } from "@hono/node-server";
import pg from "pg";
import { criarServico } from "./app";
import { espelharPasta, gravarCopiaDiaria } from "./backup";
import { criarCofre } from "./cofre";
import type { DependenciasApi } from "./contexto";
import { repositorioEmpresasEmArquivos } from "./empresas";
import { alertasPorUrl } from "./monitor";

export interface OpcoesServicoFiscal {
  /** 32 bytes em base64: cifra certificados e senhas. Sem ela os certificados não abrem mais */
  chaveMestra: string;
  /** Pasta de XMLs, PDFs, cadastro e numeração (padrão ./dados). Ignorada com bancoUrl */
  pastaDados?: string;
  /** Postgres (Supabase, Neon…): tudo fica no banco em vez da pasta */
  bancoUrl?: string;
  /** Token das rotas /v1/admin. Sem ele, o cadastro de empresas fica desligado */
  tokenAdmin?: string;
  /** Origens liberadas para o navegador (CORS); aceita https://*.dominio */
  origensPermitidas?: string[];
  /** Webhook dos alertas (Slack, Discord…) */
  alertaUrl?: string;
  /** Só sem bancoUrl: cópia de hora em hora dos arquivos e diária da numeração (OneDrive…) */
  pastaBackup?: string;
  /** Recebe cada evento (chamadas à SEFAZ, rotinas, backup). Padrão: console.log em JSON */
  aoRegistrar?: (evento: Record<string, unknown>) => void;
  /** Intervalo das rotinas (offline, pendentes, webhooks). Padrão 60 s; 0 desliga */
  intervaloRotinasMs?: number;
  /** Troca dependências (testes) */
  extra?: Partial<DependenciasApi>;
}

/**
 * Monta o serviço fiscal completo sobre disco (PGlite + pasta) ou Postgres e liga as rotinas de
 * fundo e o backup. Não abre porta: use `fetch` direto (app embutido) ou `ouvir` (servidor HTTP).
 * É o mesmo código do agente local, do servidor e do app com o emissor embutido.
 */
export async function iniciarServicoFiscal(opcoes: OpcoesServicoFiscal) {
  const registrar =
    opcoes.aoRegistrar ??
    ((e: Record<string, unknown>) =>
      console.log(JSON.stringify({ hora: new Date().toISOString(), ...e })));
  const pasta = resolve(opcoes.pastaDados ?? "dados");

  let executar: (sql: string, p: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  let arquivos: ArmazemArquivos;
  let bancoLocal: PGlite | undefined;
  let pool: pg.Pool | undefined;
  if (opcoes.bancoUrl) {
    // Postgres de verdade: várias instâncias da API podem dividir o mesmo banco
    pool = new pg.Pool({ connectionString: opcoes.bancoUrl, max: 5 });
    const p = pool;
    executar = (sql, valores) => p.query(sql, valores);
    arquivos = arquivosPostgres({ executar });
  } else {
    // PostgreSQL embutido (PGlite gravando na pasta) para a numeração: atômico, sem servidor
    mkdirSync(join(pasta, "numeracao"), { recursive: true });
    const banco = new PGlite(join(pasta, "numeracao"));
    bancoLocal = banco;
    executar = (sql, valores) => banco.query<Record<string, unknown>>(sql, valores);
    arquivos = armazemDisco(join(pasta, "arquivos"));
  }
  await prepararTabelas({ executar });

  const pastaBackup = !opcoes.bancoUrl && opcoes.pastaBackup ? resolve(opcoes.pastaBackup) : null;
  const backup: { ultimo?: string; erro?: string; copiados?: number } = {};

  const servico = criarServico({
    cofre: criarCofre(opcoes.chaveMestra),
    empresas: repositorioEmpresasEmArquivos(arquivos),
    arquivos,
    numeracao: armazemPostgres({ executar }),
    ...(opcoes.tokenAdmin ? { tokenAdmin: opcoes.tokenAdmin } : {}),
    aoRegistrar: registrar,
    ...(opcoes.origensPermitidas?.length ? { origensPermitidas: opcoes.origensPermitidas } : {}),
    ...(opcoes.alertaUrl ? { enviarAlertas: alertasPorUrl(opcoes.alertaUrl) } : {}),
    // Sem o caminho da pasta: /saude pode estar aberta na internet (túnel)
    ...(pastaBackup ? { saude: () => ({ backup: { ...backup } }) } : {}),
    ...opcoes.extra,
  });

  const temporizadores: ReturnType<typeof setInterval>[] = [];

  // Rotinas: transmite NFC-e offline, resolve pendentes e reenvia webhooks. Nunca duas ao mesmo tempo.
  const intervalo = opcoes.intervaloRotinasMs ?? 60_000;
  let rodando = false;
  const rodarRotinas = async () => {
    if (rodando) return;
    rodando = true;
    try {
      const r = await servico.executarRotinas();
      if (
        r.transmitidasOffline ||
        r.pendentesResolvidas ||
        r.erros.length ||
        r.webhooks.entregues ||
        r.alertas ||
        r.dfeNovos
      ) {
        registrar({ rotinas: r });
      }
    } catch (erro) {
      registrar({ rotinas: "erro", erro: erro instanceof Error ? erro.message : String(erro) });
    } finally {
      rodando = false;
    }
  };
  if (intervalo > 0) temporizadores.push(setInterval(rodarRotinas, intervalo));

  // Backup: arquivos de hora em hora (só o que mudou), numeração uma vez por dia
  if (pastaBackup) {
    let diaNumeracao = "";
    const fazerBackup = async () => {
      try {
        const r = await espelharPasta(join(pasta, "arquivos"), join(pastaBackup, "arquivos"));
        const hoje = new Date().toISOString().slice(0, 10);
        if (bancoLocal && diaNumeracao !== hoje) {
          const copia = await bancoLocal.dumpDataDir("gzip");
          await gravarCopiaDiaria(
            join(pastaBackup, "numeracao"),
            "numeracao",
            ".tar.gz",
            new Uint8Array(await copia.arrayBuffer()),
          );
          diaNumeracao = hoje;
        }
        await writeFile(
          join(pastaBackup, "ULTIMO-BACKUP.txt"),
          [
            `Último backup: ${new Date().toLocaleString("pt-BR")}`,
            `Arquivos novos: ${r.copiados}`,
            `Arquivos conferidos: ${r.verificados}`,
            "",
          ].join("\r\n"),
        );
        Object.assign(backup, { ultimo: r.hora, copiados: r.copiados, erro: undefined });
        if (r.copiados) registrar({ backup: r });
      } catch (erro) {
        backup.erro = erro instanceof Error ? erro.message : String(erro);
        registrar({ backup: "erro", erro: backup.erro });
      }
    };
    temporizadores.push(setTimeout(fazerBackup, 30_000));
    temporizadores.push(setInterval(fazerBackup, 60 * 60_000));
  }
  // Não seguram o processo aberto sozinhos
  for (const t of temporizadores) t.unref?.();

  let servidor: ReturnType<typeof serve> | undefined;
  return {
    ...servico,
    /** Atende uma requisição sem abrir porta (app embutido, testes) */
    fetch: (requisicao: Request) => servico.app.fetch(requisicao),
    /** Pasta dos dados (sem bancoUrl) */
    pastaDados: opcoes.bancoUrl ? null : pasta,
    rodarRotinas,
    /** Abre a porta HTTP. Porta 0 = qualquer livre. Devolve a porta escolhida */
    ouvir(porta: number, host?: string): Promise<number> {
      return new Promise((ok) => {
        servidor = serve(
          { fetch: servico.app.fetch, port: porta, ...(host ? { hostname: host } : {}) },
          (info) => ok(info.port),
        );
      });
    },
    /** Para rotinas, porta e banco (feche antes de sair do app) */
    async parar() {
      for (const t of temporizadores) clearInterval(t);
      await new Promise<void>((ok) => (servidor ? servidor.close(() => ok()) : ok()));
      await bancoLocal?.close();
      await pool?.end();
    },
  };
}

export type ServicoFiscal = Awaited<ReturnType<typeof iniciarServicoFiscal>>;
