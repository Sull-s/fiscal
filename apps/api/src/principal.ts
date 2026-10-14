import { mkdirSync } from "node:fs";
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
  executar = (sql, p) => banco.query<Record<string, unknown>>(sql, p);
  arquivos = armazemDisco(join(pasta, "arquivos"));
}
await prepararTabelas({ executar });

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
});

const porta = Number(process.env.PORTA ?? 8787);
serve({ fetch: app.fetch, port: porta }, () => {
  console.log(
    `@fiscal/api ouvindo em http://localhost:${porta}${urlBanco ? "" : ` (dados em ${pasta})`}`,
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
