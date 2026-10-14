import {
  abrirCertificadoA1,
  certificadoServeParaEmitente,
  situacaoCertificado,
} from "@fiscal/certificado";
import { validarCnpj } from "@fiscal/core";
import type { Serie } from "@fiscal/numeracao";
import { Hono } from "hono";
import type { Contexto } from "../contexto";
import { type Empresa, empresaPublica, gerarChaveApi, validarIdEmpresa } from "../empresas";
import { falhar, lerCorpo } from "../http";
import { avaliarMonitor } from "../monitor";

/** Cadastro de empresas, certificados e chaves de API. Protegido pelo token de administrador. */
export function rotasAdmin(ctx: Contexto) {
  const app = new Hono();
  const { empresas, cofre } = ctx.deps;

  const exigir = async (id: string) => {
    const empresa = await empresas.obter(validarIdEmpresa(id));
    return empresa ?? falhar(404, "EMPRESA_NAO_ENCONTRADA", `Empresa ${id} não cadastrada.`);
  };

  /** Alertas e situação de todas as empresas (?sefaz=1 também consulta a SEFAZ agora). */
  app.get("/monitor", async (c) =>
    c.json(await avaliarMonitor(ctx, { consultarSefaz: c.req.query("sefaz") === "1" })),
  );

  app.get("/empresas", async (c) => c.json((await empresas.listar()).map(empresaPublica)));

  app.get("/empresas/:id", async (c) => c.json(empresaPublica(await exigir(c.req.param("id")))));

  /** Cria ou atualiza os dados da empresa (mantém certificado e chaves). */
  app.put("/empresas/:id", async (c) => {
    const id = validarIdEmpresa(c.req.param("id"));
    const corpo =
      await lerCorpo<
        Partial<Pick<Empresa, "nome" | "cnpj" | "ambiente" | "nfce" | "nfse" | "nfe" | "dfe">>
      >(c);
    const atual = await empresas.obter(id);
    const agora = new Date().toISOString();
    const empresa: Empresa = {
      id,
      nome: corpo.nome ?? atual?.nome ?? "",
      cnpj: corpo.cnpj ?? atual?.cnpj ?? "",
      ambiente: corpo.ambiente ?? atual?.ambiente ?? 2,
      ...((corpo.nfce ?? atual?.nfce) ? { nfce: corpo.nfce ?? atual?.nfce } : {}),
      ...((corpo.nfse ?? atual?.nfse) ? { nfse: corpo.nfse ?? atual?.nfse } : {}),
      ...((corpo.nfe ?? atual?.nfe) ? { nfe: corpo.nfe ?? atual?.nfe } : {}),
      ...((corpo.dfe ?? atual?.dfe) ? { dfe: corpo.dfe ?? atual?.dfe } : {}),
      ...(atual?.certificado ? { certificado: atual.certificado } : {}),
      chavesApi: atual?.chavesApi ?? [],
      ...(atual?.webhook ? { webhook: atual.webhook } : {}),
      criadaEm: atual?.criadaEm ?? agora,
      atualizadaEm: agora,
    } as Empresa;
    if (!empresa.nome.trim()) falhar(400, "NOME_OBRIGATORIO", "Informe o nome da empresa.");
    if (!validarCnpj(empresa.cnpj)) falhar(400, "CNPJ_INVALIDO", "CNPJ da empresa inválido.");
    if (empresa.ambiente !== 1 && empresa.ambiente !== 2)
      falhar(400, "AMBIENTE_INVALIDO", "Ambiente deve ser 1 (produção) ou 2 (homologação).");
    await empresas.salvar(empresa);
    return c.json(empresaPublica(empresa), atual ? 200 : 201);
  });

  /** Recebe o .pfx em base64 e a senha; confere se abre e se é da empresa; guarda cifrado. */
  app.put("/empresas/:id/certificado", async (c) => {
    const empresa = await exigir(c.req.param("id"));
    const { pfxBase64, senha } = await lerCorpo<{ pfxBase64?: string; senha?: string }>(c);
    if (!pfxBase64 || senha === undefined)
      falhar(400, "CERTIFICADO_INCOMPLETO", "Envie pfxBase64 e senha.");
    const pfx = Buffer.from(pfxBase64, "base64");
    const certificado = abrirCertificadoA1(pfx, senha);
    if (!certificadoServeParaEmitente(certificado, empresa.cnpj)) {
      falhar(
        409,
        "CERTIFICADO_DE_OUTRA_EMPRESA",
        `O certificado é de ${certificado.documento || "outro titular"}, não da empresa ${empresa.cnpj}.`,
      );
    }
    empresa.certificado = {
      pfx: cofre.cifrar(pfx, empresa.id),
      senha: cofre.cifrar(senha, empresa.id),
      titular: certificado.titular,
      documento: certificado.documento,
      validoAte: certificado.validoAte.toISOString(),
    };
    empresa.atualizadaEm = new Date().toISOString();
    await empresas.salvar(empresa);
    ctx.esquecer(empresa.id);
    return c.json({
      titular: certificado.titular,
      documento: certificado.documento,
      validoAte: certificado.validoAte.toISOString(),
      ...situacaoCertificado(certificado),
    });
  });

  /** Gera uma chave de API. Ela aparece só nesta resposta: guarde. */
  app.post("/empresas/:id/chaves", async (c) => {
    const empresa = await exigir(c.req.param("id"));
    const { chave, registro } = gerarChaveApi(empresa.id);
    empresa.chavesApi.push(registro);
    await empresas.salvar(empresa);
    return c.json(
      { id: registro.id, chave, aviso: "Guarde esta chave: ela não será mostrada de novo." },
      201,
    );
  });

  /** Situação da série (próximo número, pendentes, lacunas). ?modelo=65&ambiente=1&serie=1 */
  app.get("/empresas/:id/numeracao", async (c) => {
    const empresa = await exigir(c.req.param("id"));
    return c.json(await ctx.numeracao.situacao(lerSerie(empresa.id, c.req.query())));
  });

  /**
   * Começa a série num número (migração de outro sistema que parou no 220 → primeiroNumero 221).
   * Só vale para série ainda sem números.
   */
  app.post("/empresas/:id/numeracao/iniciar", async (c) => {
    const empresa = await exigir(c.req.param("id"));
    const corpo = await lerCorpo<Record<string, unknown>>(c);
    const serie = lerSerie(empresa.id, corpo);
    const primeiro = Number(corpo.primeiroNumero);
    if (!Number.isInteger(primeiro) || primeiro < 1 || primeiro > 999_999_999)
      falhar(400, "NUMERO_INVALIDO", "primeiroNumero deve ser um inteiro entre 1 e 999999999.");
    await ctx.numeracao.iniciarEm(serie, primeiro);
    return c.json(await ctx.numeracao.situacao(serie));
  });

  app.delete("/empresas/:id/chaves/:chaveId", async (c) => {
    const empresa = await exigir(c.req.param("id"));
    const antes = empresa.chavesApi.length;
    empresa.chavesApi = empresa.chavesApi.filter((k) => k.id !== c.req.param("chaveId"));
    if (empresa.chavesApi.length === antes)
      falhar(404, "CHAVE_NAO_ENCONTRADA", "Chave não encontrada.");
    await empresas.salvar(empresa);
    return c.body(null, 204);
  });

  return app;
}

function lerSerie(empresa: string, dados: Record<string, unknown>): Serie {
  const modelo = String(dados.modelo ?? "65");
  const ambiente = Number(dados.ambiente ?? 1);
  const serie = String(dados.serie ?? "1");
  if (modelo !== "65" && modelo !== "55" && modelo !== "nfse")
    falhar(400, "MODELO_INVALIDO", "modelo deve ser 65, 55 ou nfse.");
  if (ambiente !== 1 && ambiente !== 2)
    falhar(400, "AMBIENTE_INVALIDO", "ambiente deve ser 1 ou 2.");
  // Série da DPS (NFS-e) tem até 5 dígitos; NF-e e NFC-e, até 3
  if (!(modelo === "nfse" ? /^\d{1,5}$/ : /^\d{1,3}$/).test(serie))
    falhar(400, "SERIE_INVALIDA", "serie inválida (1 a 3 dígitos; NFS-e até 5).");
  return { empresa, modelo, ambiente: ambiente as 1 | 2, serie };
}
