import {
  abrirCertificadoA1,
  certificadoServeParaEmitente,
  situacaoCertificado,
} from "@fiscal/certificado";
import { validarCnpj } from "@fiscal/core";
import { Hono } from "hono";
import type { Contexto } from "../contexto";
import { type Empresa, empresaPublica, gerarChaveApi, validarIdEmpresa } from "../empresas";
import { falhar, lerCorpo } from "../http";

/** Cadastro de empresas, certificados e chaves de API. Protegido pelo token de administrador. */
export function rotasAdmin(ctx: Contexto) {
  const app = new Hono();
  const { empresas, cofre } = ctx.deps;

  const exigir = async (id: string) => {
    const empresa = await empresas.obter(validarIdEmpresa(id));
    return empresa ?? falhar(404, "EMPRESA_NAO_ENCONTRADA", `Empresa ${id} não cadastrada.`);
  };

  app.get("/empresas", async (c) => c.json((await empresas.listar()).map(empresaPublica)));

  app.get("/empresas/:id", async (c) => c.json(empresaPublica(await exigir(c.req.param("id")))));

  /** Cria ou atualiza os dados da empresa (mantém certificado e chaves). */
  app.put("/empresas/:id", async (c) => {
    const id = validarIdEmpresa(c.req.param("id"));
    const corpo =
      await lerCorpo<Partial<Pick<Empresa, "nome" | "cnpj" | "ambiente" | "nfce" | "nfse">>>(c);
    const atual = await empresas.obter(id);
    const agora = new Date().toISOString();
    const empresa: Empresa = {
      id,
      nome: corpo.nome ?? atual?.nome ?? "",
      cnpj: corpo.cnpj ?? atual?.cnpj ?? "",
      ambiente: corpo.ambiente ?? atual?.ambiente ?? 2,
      ...((corpo.nfce ?? atual?.nfce) ? { nfce: corpo.nfce ?? atual?.nfce } : {}),
      ...((corpo.nfse ?? atual?.nfse) ? { nfse: corpo.nfse ?? atual?.nfse } : {}),
      ...(atual?.certificado ? { certificado: atual.certificado } : {}),
      chavesApi: atual?.chavesApi ?? [],
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
