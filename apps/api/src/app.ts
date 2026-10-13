import { situacaoCertificado } from "@fiscal/certificado";
import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { hashToken, hashesIguais } from "./cofre";
import { type DependenciasApi, criarContexto } from "./contexto";
import { autenticarChaveApi, empresaPublica } from "./empresas";
import { type Ambiente, falhar, lerCorpo, responderErro } from "./http";
import { rotasAdmin } from "./rotas/admin";
import { rotasNfce } from "./rotas/nfce";
import { rotasNfe } from "./rotas/nfe";
import { rotasNfse } from "./rotas/nfse";
import { executarRotinas } from "./rotinas";
import { gerarSegredoWebhook, validarUrlWebhook } from "./webhooks";

/**
 * API fiscal multi-empresa.
 *   /saude                         aberta
 *   /v1/admin/...                  token do administrador
 *   /v1/...                        chave de API da empresa (Authorization: Bearer fsk_…)
 */
export function criarApp(deps: DependenciasApi) {
  return criarServico(deps).app;
}

/** App HTTP + rotinas de fundo (transmitir offline, resolver pendentes, reenviar webhooks). */
export function criarServico(deps: DependenciasApi) {
  const ctx = criarContexto(deps);
  const app = montarApp(deps, ctx);
  return {
    app,
    ctx,
    executarRotinas: (opcoes?: Parameters<typeof executarRotinas>[1]) =>
      executarRotinas(ctx, opcoes),
  };
}

function montarApp(deps: DependenciasApi, ctx: ReturnType<typeof criarContexto>) {
  const app = new Hono<Ambiente>();
  app.onError(responderErro);
  app.notFound((c) =>
    c.json({ erro: { codigo: "ROTA_NAO_ENCONTRADA", mensagem: "Rota não encontrada." } }, 404),
  );

  app.get("/saude", (c) =>
    c.json({ ok: true, servico: "@fiscal/api", hora: new Date().toISOString() }),
  );

  // ---- Administração
  if (deps.tokenAdmin) {
    const hashAdmin = hashToken(deps.tokenAdmin);
    app.use(
      "/v1/admin/*",
      bearerAuth({ verifyToken: (token) => hashesIguais(hashToken(token), hashAdmin) }),
    );
    app.route("/v1/admin", rotasAdmin(ctx));
  }

  // ---- Rotas da empresa
  app.use("/v1/*", async (c, next) => {
    if (c.req.path.startsWith("/v1/admin")) return next();
    const token = /^Bearer (.+)$/.exec(c.req.header("Authorization") ?? "")?.[1] ?? "";
    const empresa = await autenticarChaveApi(deps.empresas, token);
    if (!empresa) falhar(401, "NAO_AUTORIZADO", "Chave de API ausente ou inválida.");
    c.set("empresa", empresa);
    c.set("ctx", ctx);
    await next();
  });

  app.get("/v1/empresa", (c) => {
    const empresa = c.get("empresa");
    const cert = empresa.certificado;
    return c.json({
      ...empresaPublica(empresa),
      situacaoCertificado: cert
        ? situacaoCertificado({ validoDe: new Date(0), validoAte: new Date(cert.validoAte) })
        : null,
    });
  });

  /** Status da SEFAZ da UF da empresa e diferença de relógio. */
  app.get("/v1/sefaz/status", async (c) => {
    const empresa = c.get("empresa");
    const uf =
      empresa.nfce?.emitente.endereco.uf ??
      empresa.nfe?.emitente.endereco.uf ??
      falhar(409, "NFCE_NAO_CONFIGURADA", "Cadastre os dados de NFC-e ou NF-e para saber a UF.");
    const modelo = c.req.query("modelo") === "55" ? "55" : "65";
    return c.json(
      await ctx.sefaz(empresa).consultarStatus({ uf, modelo, ambiente: empresa.ambiente }),
    );
  });

  /** Situação da numeração: próximo, pendentes, liberados, lacunas. */
  app.get("/v1/numeracao/:modelo", async (c) => {
    const empresa = c.get("empresa");
    const modelo = c.req.param("modelo");
    const serie = {
      "55": empresa.nfe?.serie,
      "65": empresa.nfce?.serie,
      nfse: empresa.nfse?.serie,
    }[modelo];
    if (!serie)
      falhar(404, "SERIE_NAO_CONFIGURADA", "Modelo sem série configurada (use 55, 65 ou nfse).");
    return c.json(
      await ctx.numeracao.situacao({
        empresa: empresa.id,
        modelo,
        ambiente: empresa.ambiente,
        serie,
      }),
    );
  });

  /** ZIP do mês para o contador. ?ambiente=2 para homologação; ?pdf=1 inclui PDFs. */
  app.get("/v1/arquivos/:ano/:mes", async (c) => {
    const empresa = c.get("empresa");
    const ano = Number(c.req.param("ano"));
    const mes = Number(c.req.param("mes").replace(/\.zip$/, ""));
    if (!(ano >= 2000 && mes >= 1 && mes <= 12))
      falhar(400, "PERIODO_INVALIDO", "Use /v1/arquivos/AAAA/MM.");
    const { zip } = await ctx.arquivoFiscal.exportarMes({
      cnpj: empresa.cnpj,
      ano,
      mes,
      ambiente: c.req.query("ambiente") === "2" ? 2 : 1,
      incluirPdf: c.req.query("pdf") === "1",
    });
    return c.body(new Uint8Array(zip), 200, {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="fiscal-${empresa.cnpj.replace(/\D/g, "")}-${ano}-${String(mes).padStart(2, "0")}.zip"`,
    });
  });

  // ---- Webhook da empresa
  app.get("/v1/webhook", (c) => {
    const w = c.get("empresa").webhook;
    return c.json(w ? { url: w.url, criadoEm: w.criadoEm } : null);
  });

  /** Configura (ou troca) a URL. Gera um segredo novo, mostrado só nesta resposta. */
  app.put("/v1/webhook", async (c) => {
    const empresa = c.get("empresa");
    const { url } = await lerCorpo<{ url?: string }>(c);
    const segredo = gerarSegredoWebhook();
    empresa.webhook = {
      url: validarUrlWebhook(url ?? ""),
      segredo: ctx.webhooks.cifrarSegredo(empresa.id, segredo),
      criadoEm: new Date().toISOString(),
    };
    empresa.atualizadaEm = new Date().toISOString();
    await deps.empresas.salvar(empresa);
    return c.json(
      {
        url: empresa.webhook.url,
        segredo,
        aviso:
          "Guarde o segredo: ele não será mostrado de novo. Use-o para conferir Fiscal-Assinatura.",
      },
      201,
    );
  });

  app.delete("/v1/webhook", async (c) => {
    const { webhook: _, ...semWebhook } = c.get("empresa");
    await deps.empresas.salvar({ ...semWebhook, atualizadaEm: new Date().toISOString() });
    return c.body(null, 204);
  });

  /** Envia um evento "teste" agora e devolve como foi a entrega. */
  app.post("/v1/webhook/teste", async (c) => {
    const empresa = c.get("empresa");
    if (!empresa.webhook) falhar(409, "WEBHOOK_NAO_CONFIGURADO", "Configure o webhook antes.");
    const evento = await ctx.webhooks.publicar(empresa.id, "teste", { mensagem: "Olá!" });
    await ctx.webhooks.aguardar();
    const hoje = new Date().toISOString().slice(0, 10);
    const entrega = (await ctx.webhooks.listar(empresa.id, hoje)).find((e) => e.id === evento?.id);
    return c.json(entrega ?? null);
  });

  /** Entregas de um dia: ?dia=AAAA-MM-DD (padrão hoje, UTC). */
  app.get("/v1/webhook/entregas", async (c) => {
    const dia = c.req.query("dia") ?? new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) falhar(400, "DIA_INVALIDO", "Use ?dia=AAAA-MM-DD.");
    return c.json(await ctx.webhooks.listar(c.get("empresa").id, dia));
  });

  app.route("/v1/nfe", rotasNfe());
  app.route("/v1/nfce", rotasNfce());
  app.route("/v1/nfse", rotasNfse());

  return app;
}
