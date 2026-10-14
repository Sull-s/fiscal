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
import { criarCofre, gerarChaveMestra } from "./cofre";
import { repositorioEmpresasEmArquivos } from "./empresas";
import { alertasPorUrl } from "./monitor";

/**
 * Variáveis de ambiente:
 *   FISCAL_CHAVE_MESTRA   32 bytes em base64 (cifra certificados). OBRIGATÓRIA. Guarde fora do servidor também:
 *                         sem ela, os certificados cadastrados não abrem mais.
 *   FISCAL_TOKEN_ADMIN    token para /v1/admin (cadastro de empresas). Sem ele, admin desligado.
 *   FISCAL_BANCO_URL      Postgres (Supabase, Neon…): numeração, XMLs, PDFs e cadastro ficam no banco.
 *                         Sem ela, tudo fica na pasta FISCAL_PASTA_DADOS.
 *   FISCAL_PASTA_DADOS    pasta de XMLs, PDFs, cadastro e numeração (padrão ./dados)
 *   FISCAL_ALERTA_URL     webhook para alertas (Slack, Discord…): certificado vencendo, SEFAZ fora,
 *                         notas presas, relógio errado
 *   FISCAL_CORS_ORIGENS   origens liberadas para chamar a API do navegador (@fiscal/ui), separadas
 *                         por vírgula. Ex.: https://app.cliente.com.br
 *                         Aceita domínio com subdomínios: https://*.base44.app
 *   FISCAL_PASTA_BACKUP   só sem FISCAL_BANCO_URL: a cada hora copia os XMLs e o cadastro para esta
 *                         pasta (ponha uma pasta do OneDrive/Google Drive) e, uma vez por dia, a
 *                         numeração. Nunca apaga nada lá.
 *   HOST                  endereço de escuta. 127.0.0.1 = só este computador (agente local)
 *   PORTA                 padrão 8787
 */
const chaveMestra = process.env.FISCAL_CHAVE_MESTRA;
if (!chaveMestra) {
  console.error("Defina FISCAL_CHAVE_MESTRA. Sugestão gerada agora (guarde em lugar seguro):");
  console.error(`  FISCAL_CHAVE_MESTRA=${gerarChaveMestra()}`);
  process.exit(1);
}

const urlBanco = process.env.FISCAL_BANCO_URL;
const pasta = resolve(process.env.FISCAL_PASTA_DADOS ?? "dados");
let executar: (sql: string, p: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
let arquivos: ArmazemArquivos;
let bancoLocal: PGlite | undefined;
if (urlBanco) {
  // Postgres de verdade: várias instâncias da API podem dividir o mesmo banco
  const pool = new pg.Pool({ connectionString: urlBanco, max: 5 });
  executar = (sql, p) => pool.query(sql, p);
  arquivos = arquivosPostgres({ executar });
  console.log("Dados no Postgres (FISCAL_BANCO_URL).");
} else {
  // PostgreSQL embutido (PGlite gravando na pasta) para a numeração: atômico, sem servidor de banco
  mkdirSync(join(pasta, "numeracao"), { recursive: true });
  const banco = new PGlite(join(pasta, "numeracao"));
  bancoLocal = banco;
  executar = (sql, p) => banco.query<Record<string, unknown>>(sql, p);
  arquivos = armazemDisco(join(pasta, "arquivos"));
}
await prepararTabelas({ executar });

const pastaBackup =
  !urlBanco && process.env.FISCAL_PASTA_BACKUP ? resolve(process.env.FISCAL_PASTA_BACKUP) : null;
const backup: { ultimo?: string; erro?: string; copiados?: number } = {};

const { app, executarRotinas } = criarServico({
  cofre: criarCofre(chaveMestra),
  empresas: repositorioEmpresasEmArquivos(arquivos),
  arquivos,
  numeracao: armazemPostgres({ executar }),
  ...(process.env.FISCAL_TOKEN_ADMIN ? { tokenAdmin: process.env.FISCAL_TOKEN_ADMIN } : {}),
  aoRegistrar: (e) => console.log(JSON.stringify({ hora: new Date().toISOString(), ...e })),
  ...(process.env.FISCAL_CORS_ORIGENS
    ? { origensPermitidas: process.env.FISCAL_CORS_ORIGENS.split(",").map((o) => o.trim()) }
    : {}),
  ...(process.env.FISCAL_ALERTA_URL
    ? { enviarAlertas: alertasPorUrl(process.env.FISCAL_ALERTA_URL) }
    : {}),
  ...(pastaBackup ? { saude: () => ({ backup: { pasta: pastaBackup, ...backup } }) } : {}),
});

const porta = Number(process.env.PORTA ?? 8787);
const host = process.env.HOST;
serve({ fetch: app.fetch, port: porta, ...(host ? { hostname: host } : {}) }, () => {
  console.log(
    `@fiscal/api ouvindo em http://${host ?? "localhost"}:${porta}${urlBanco ? "" : ` (dados em ${pasta})`}`,
  );
});

// Rotinas a cada minuto: transmite NFC-e offline, resolve pendentes e reenvia webhooks.
// Nunca duas rodadas ao mesmo tempo.
let rodando = false;
setInterval(async () => {
  if (rodando) return;
  rodando = true;
  try {
    const r = await executarRotinas();
    if (
      r.transmitidasOffline ||
      r.pendentesResolvidas ||
      r.erros.length ||
      r.webhooks.entregues ||
      r.alertas ||
      r.dfeNovos
    ) {
      console.log(JSON.stringify({ hora: new Date().toISOString(), rotinas: r }));
    }
  } catch (erro) {
    console.error("[rotinas]", erro);
  } finally {
    rodando = false;
  }
}, 60_000).unref();

// Backup do agente local: XMLs e cadastro a cada hora (só o que mudou), numeração uma vez por dia
if (pastaBackup) {
  const destino = pastaBackup;
  let diaNumeracao = "";
  const fazerBackup = async () => {
    try {
      const r = await espelharPasta(join(pasta, "arquivos"), join(destino, "arquivos"));
      const hoje = new Date().toISOString().slice(0, 10);
      if (bancoLocal && diaNumeracao !== hoje) {
        const copia = await bancoLocal.dumpDataDir("gzip");
        await gravarCopiaDiaria(
          join(destino, "numeracao"),
          "numeracao",
          ".tar.gz",
          new Uint8Array(await copia.arrayBuffer()),
        );
        diaNumeracao = hoje;
      }
      await writeFile(
        join(destino, "ULTIMO-BACKUP.txt"),
        [
          `Último backup: ${new Date().toLocaleString("pt-BR")}`,
          `Arquivos novos: ${r.copiados}`,
          `Arquivos conferidos: ${r.verificados}`,
          "",
        ].join("\r\n"),
      );
      Object.assign(backup, { ultimo: r.hora, copiados: r.copiados, erro: undefined });
      if (r.copiados) console.log(JSON.stringify({ hora: r.hora, backup: r }));
    } catch (erro) {
      backup.erro = erro instanceof Error ? erro.message : String(erro);
      console.error("[backup]", erro);
    }
  };
  setTimeout(fazerBackup, 30_000).unref();
  setInterval(fazerBackup, 60 * 60_000).unref();
}
