import { gerarChaveMestra } from "./cofre";
import { iniciarServicoFiscal } from "./servidor";

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

const env = process.env;
const servico = await iniciarServicoFiscal({
  chaveMestra,
  ...(env.FISCAL_PASTA_DADOS ? { pastaDados: env.FISCAL_PASTA_DADOS } : {}),
  ...(env.FISCAL_BANCO_URL ? { bancoUrl: env.FISCAL_BANCO_URL } : {}),
  ...(env.FISCAL_TOKEN_ADMIN ? { tokenAdmin: env.FISCAL_TOKEN_ADMIN } : {}),
  ...(env.FISCAL_CORS_ORIGENS
    ? { origensPermitidas: env.FISCAL_CORS_ORIGENS.split(",").map((o) => o.trim()) }
    : {}),
  ...(env.FISCAL_ALERTA_URL ? { alertaUrl: env.FISCAL_ALERTA_URL } : {}),
  ...(env.FISCAL_PASTA_BACKUP ? { pastaBackup: env.FISCAL_PASTA_BACKUP } : {}),
});
if (env.FISCAL_BANCO_URL) console.log("Dados no Postgres (FISCAL_BANCO_URL).");

const host = env.HOST;
const porta = await servico.ouvir(Number(env.PORTA ?? 8787), host);
console.log(
  `@fiscal/api ouvindo em http://${host ?? "localhost"}:${porta}${servico.pastaDados ? ` (dados em ${servico.pastaDados})` : ""}`,
);
