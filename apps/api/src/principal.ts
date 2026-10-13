import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { armazemDisco } from "@fiscal/armazenamento";
import { armazemPostgres, prepararTabelas } from "@fiscal/numeracao";
import { serve } from "@hono/node-server";
import { criarServico } from "./app";
import { criarCofre, gerarChaveMestra } from "./cofre";
import { repositorioEmpresasEmArquivos } from "./empresas";

/**
 * Variáveis de ambiente:
 *   FISCAL_CHAVE_MESTRA   32 bytes em base64 (cifra certificados). OBRIGATÓRIA. Guarde fora do servidor também:
 *                         sem ela, os certificados cadastrados não abrem mais.
 *   FISCAL_TOKEN_ADMIN    token para /v1/admin (cadastro de empresas). Sem ele, admin desligado.
 *   FISCAL_PASTA_DADOS    pasta de XMLs, PDFs, cadastro e numeração (padrão ./dados)
 *   PORTA                 padrão 8787
 */
const chaveMestra = process.env.FISCAL_CHAVE_MESTRA;
if (!chaveMestra) {
  console.error("Defina FISCAL_CHAVE_MESTRA. Sugestão gerada agora (guarde em lugar seguro):");
  console.error(`  FISCAL_CHAVE_MESTRA=${gerarChaveMestra()}`);
  process.exit(1);
}

const pasta = resolve(process.env.FISCAL_PASTA_DADOS ?? "dados");
mkdirSync(join(pasta, "numeracao"), { recursive: true });

// Numeração em PostgreSQL embutido (PGlite gravando na pasta): atômico, sem servidor de banco
const banco = new PGlite(join(pasta, "numeracao"));
const executar = (sql: string, p: unknown[]) => banco.query<Record<string, unknown>>(sql, p);
await prepararTabelas({ executar });

const arquivos = armazemDisco(join(pasta, "arquivos"));
const { app, executarRotinas } = criarServico({
  cofre: criarCofre(chaveMestra),
  empresas: repositorioEmpresasEmArquivos(arquivos),
  arquivos,
  numeracao: armazemPostgres({ executar }),
  ...(process.env.FISCAL_TOKEN_ADMIN ? { tokenAdmin: process.env.FISCAL_TOKEN_ADMIN } : {}),
  aoRegistrar: (e) => console.log(JSON.stringify({ hora: new Date().toISOString(), ...e })),
});

const porta = Number(process.env.PORTA ?? 8787);
serve({ fetch: app.fetch, port: porta }, () => {
  console.log(`@fiscal/api ouvindo em http://localhost:${porta} (dados em ${pasta})`);
});

// Rotinas a cada minuto: transmite NFC-e offline, resolve pendentes e reenvia webhooks.
// Nunca duas rodadas ao mesmo tempo.
let rodando = false;
setInterval(async () => {
  if (rodando) return;
  rodando = true;
  try {
    const r = await executarRotinas();
    if (r.transmitidasOffline || r.pendentesResolvidas || r.erros.length || r.webhooks.entregues) {
      console.log(JSON.stringify({ hora: new Date().toISOString(), rotinas: r }));
    }
  } catch (erro) {
    console.error("[rotinas]", erro);
  } finally {
    rodando = false;
  }
}, 60_000).unref();
