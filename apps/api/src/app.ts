import { situacaoCertificado } from "@fiscal/certificado";
import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { hashToken, hashesIguais } from "./cofre";
import { type DependenciasApi, criarContexto } from "./contexto";
import { autenticarChaveApi, empresaPublica } from "./empresas";
import { type Ambiente, falhar, responderErro } from "./http";
import { rotasAdmin } from "./rotas/admin";
import { rotasNfce } from "./rotas/nfce";
import { rotasNfse } from "./rotas/nfse";

/**
 * API fiscal multi-empresa.
 *   /saude                         aberta
 *   /v1/admin/...                  token do administrador
 *   /v1/...                        chave de API da empresa (Authorization: Bearer fsk_…)
 */
export function criarApp(deps: DependenciasApi) {
  const ctx = criarContexto(deps);
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
      falhar(409, "NFCE_NAO_CONFIGURADA", "Cadastre os dados de NFC-e para saber a UF.");
    const modelo = c.req.query("modelo") === "55" ? "55" : "65";
    return c.json(
      await ctx.sefaz(empresa).consultarStatus({ uf, modelo, ambiente: empresa.ambiente }),
    );
  });

  /** Situação da numeração: próximo, pendentes, liberados, lacunas. */
  app.get("/v1/numeracao/:modelo", async (c) => {
    const empresa = c.get("empresa");
    const modelo = c.req.param("modelo");
    const serie =
      modelo === "65" ? empresa.nfce?.serie : modelo === "nfse" ? empresa.nfse?.serie : undefined;
    if (!serie)
      falhar(404, "SERIE_NAO_CONFIGURADA", "Modelo sem série configurada (use 65 ou nfse).");
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

  app.route("/v1/nfce", rotasNfce());
  app.route("/v1/nfse", rotasNfse());

  return app;
}
