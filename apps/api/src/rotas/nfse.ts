import { gerarDanfse } from "@fiscal/documentos";
import {
  type ErroNfse,
  type Servico,
  type Tomador,
  type Valores,
  cancelarNfse,
  decomporChaveNfse,
  emitirNfse,
  lerNfse,
} from "@fiscal/nfse-nacional";
import type { Serie } from "@fiscal/numeracao";
import { type Context, Hono } from "hono";
import type { Empresa } from "../empresas";
import { type Ambiente, falhar, lerCorpo } from "../http";
import type { RegistroNota } from "../registros";
import type { Operacao } from "../servicos/nfce";
import {
  MODELO_NFSE as MODELO,
  configNfse,
  documentoNfse as documento,
  guardarNfseAutorizada,
  resolverPendenteNfse,
} from "../servicos/nfse";

/**
 * Rejeição que indica que a DPS/número já foi usado: o número NÃO pode voltar para a numeração
 * (senão a próxima emissão bate de novo no mesmo erro).
 */
const numeroJaUsado = (erros: ErroNfse[]) =>
  erros.some((e) => /duplic|j[áa] (foi )?utilizad/i.test(`${e.descricao} ${e.complemento ?? ""}`));

export function rotasNfse() {
  const app = new Hono<Ambiente>();

  const op = (c: Context<Ambiente>): Operacao => ({ ctx: c.get("ctx"), empresa: c.get("empresa") });
  const config = (c: Context<Ambiente>) => configNfse(c.get("empresa"));
  const caminhoDps = (empresa: Empresa, id: string) => `_dps/${empresa.id}/${id}.xml`;

  app.post("/", async (c) => {
    const empresa = c.get("empresa");
    const ctx = c.get("ctx");
    const nfse = config(c);
    const chaveIdem = c.req.header("Idempotency-Key");
    if (chaveIdem) {
      const anterior = await ctx.registros.respostaIdempotente(empresa.id, chaveIdem);
      if (anterior) return c.json(anterior.corpo as object, anterior.status as 201);
    }
    const corpo = await lerCorpo<{
      tomador?: Tomador;
      servico?: Servico;
      valores?: Valores;
      competencia?: string;
      referencia?: string;
    }>(c);
    if (!corpo.servico || !corpo.valores)
      falhar(400, "DADOS_OBRIGATORIOS", "Envie servico e valores.");
    const servico = { ...nfse.servicoPadrao, ...corpo.servico } as Servico;

    const serie: Serie = {
      empresa: empresa.id,
      modelo: MODELO,
      ambiente: empresa.ambiente,
      serie: nfse.serie,
    };
    const numero = await ctx.numeracao.reservar(serie, corpo.referencia);
    let emissao: Awaited<ReturnType<typeof emitirNfse>>;
    try {
      emissao = await emitirNfse({
        cliente: ctx.nfse(empresa),
        certificado: ctx.certificado(empresa),
        prestador: nfse.prestador,
        ...(corpo.tomador ? { tomador: corpo.tomador } : {}),
        servico,
        valores: corpo.valores,
        dps: {
          ambiente: empresa.ambiente,
          serie: nfse.serie,
          numero,
          versaoAplicativo: nfse.versaoAplicativo ?? "@fiscal/api",
          ...(corpo.competencia ? { competencia: corpo.competencia } : {}),
        },
      });
    } catch (erro) {
      await ctx.numeracao.registrar(serie, numero, "liberado");
      throw erro;
    }

    const agora = new Date().toISOString();
    const registro: RegistroNota = {
      id: emissao.dps.id,
      modelo: MODELO,
      ambiente: empresa.ambiente,
      numero,
      serie: nfse.serie,
      dataEmissao: emissao.dps.dataEmissao,
      situacao: "pendente",
      valorTotal: corpo.valores.valorServico,
      ...(corpo.referencia ? { referencia: corpo.referencia } : {}),
      criadaEm: agora,
      atualizadaEm: agora,
    };

    let status: 201 | 202 | 422;
    if (emissao.situacao === "autorizada" && emissao.chave && emissao.xmlNfse) {
      await guardarNfseAutorizada(op(c), registro, emissao.chave, emissao.xmlNfse);
      status = 201;
    } else if (emissao.situacao === "pendente") {
      // Guarda a DPS enviada: se o governo tiver gerado a nota, é com ela que se prova o envio
      await ctx.deps.arquivos.gravar(
        caminhoDps(empresa, registro.id),
        new TextEncoder().encode(emissao.xmlDpsAssinado),
        "application/xml",
      );
      await ctx.numeracao.registrar(serie, numero, "pendente", registro.id);
      await ctx.registros.salvar(empresa.id, registro);
      status = 202;
    } else {
      await ctx.numeracao.registrar(
        serie,
        numero,
        numeroJaUsado(emissao.erros) ? "em-uso" : "liberado",
      );
      status = 422;
    }

    const resposta = {
      id: registro.id,
      ...(registro.chave ? { chave: registro.chave } : {}),
      numeroDps: numero,
      serie: nfse.serie,
      situacao: status === 422 ? "rejeitada" : registro.situacao,
      erros: emissao.erros,
      alertas: emissao.alertas,
      ...(registro.valorTotal !== undefined ? { valorTotal: registro.valorTotal } : {}),
    };
    if (chaveIdem)
      await ctx.registros.guardarRespostaIdempotente(empresa.id, chaveIdem, status, resposta);
    return c.json(resposta, status);
  });

  /**
   * NFS-e da empresa emitida por OUTRO sistema (ex.: antes da migração): pela chave, busca no
   * Sistema Nacional e passa a tratar como nossa (consulta, PDF, cancelamento). Não mexe na
   * numeração: o número foi dado pelo outro sistema.
   */
  const importarDeOutroSistema = async (c: Context<Ambiente>, chave: string) => {
    if (!/^\d{50}$/.test(chave)) return null;
    const empresa = c.get("empresa");
    const ctx = c.get("ctx");
    const documentoEmpresa = config(c).prestador.documento.replace(/\D/g, "");
    if (decomporChaveNfse(chave).documentoEmitente !== documentoEmpresa.padStart(14, "0"))
      return null;
    const consulta = await ctx.nfse(empresa).consultarNfse(chave);
    if (!consulta.xmlNfse) return null;
    const resumo = lerNfse(consulta.xmlNfse);
    const agora = new Date().toISOString();
    const r: RegistroNota = {
      id: resumo.dps.id || chave,
      modelo: MODELO,
      ambiente: empresa.ambiente,
      numero: Number(resumo.dps.numero) || 0,
      serie: resumo.dps.serie,
      dataEmissao: resumo.dps.dataEmissao || resumo.dataProcessamento,
      situacao: "autorizada",
      chave,
      valorTotal: Number(resumo.valores.liquido || resumo.valores.servico),
      referencia: "importada de outro sistema",
      criadaEm: agora,
      atualizadaEm: agora,
    };
    Object.assign(r, { numeroNfse: resumo.numero });
    await ctx.arquivoFiscal.guardar(documento(empresa, r), "nota", consulta.xmlNfse);
    await ctx.registros.salvar(empresa.id, r);
    return r;
  };

  const obterRegistro = async (c: Context<Ambiente>) => {
    const empresa = c.get("empresa");
    const id = c.req.param("id") ?? "";
    const r =
      (await c.get("ctx").registros.obter(empresa.id, MODELO, empresa.ambiente, id)) ??
      (await importarDeOutroSistema(c, id));
    return (
      r ??
      falhar(
        404,
        "NOTA_NAO_ENCONTRADA",
        "NFS-e não encontrada (use o Id da DPS ou a chave de 50 dígitos).",
      )
    );
  };

  /** Situação. Se estiver pendente, pergunta ao Sistema Nacional pelo Id da DPS. */
  app.get("/:id", async (c) => c.json(await resolverPendenteNfse(op(c), await obterRegistro(c))));

  app.get("/:id/xml", async (c) => {
    const r = await obterRegistro(c);
    const xml = await c.get("ctx").arquivoFiscal.lerTexto(documento(c.get("empresa"), r), "nota");
    return xml
      ? c.body(xml, 200, { "Content-Type": "application/xml; charset=utf-8" })
      : falhar(404, "XML_NAO_ENCONTRADO", "NFS-e ainda não gerada.");
  });

  app.get("/:id/danfse", async (c) => {
    const r = await obterRegistro(c);
    const xml = await c.get("ctx").arquivoFiscal.lerTexto(documento(c.get("empresa"), r), "nota");
    if (!xml) return falhar(404, "XML_NAO_ENCONTRADO", "NFS-e ainda não gerada.");
    const pdf = await gerarDanfse(xml);
    return c.body(new Uint8Array(pdf), 200, {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="danfse-${r.chave}.pdf"`,
    });
  });

  app.post("/:id/cancelamento", async (c) => {
    const empresa = c.get("empresa");
    const ctx = c.get("ctx");
    const r = await obterRegistro(c);
    if (r.situacao === "cancelada") return c.json(r);
    if (r.situacao !== "autorizada" || !r.chave) {
      falhar(
        409,
        "NOTA_NAO_AUTORIZADA",
        `Só NFS-e gerada pode ser cancelada (esta está "${r.situacao}").`,
      );
    }
    const { motivo, codigoMotivo } = await lerCorpo<{ motivo?: string; codigoMotivo?: 1 | 2 | 9 }>(
      c,
    );
    const resultado = await cancelarNfse({
      cliente: ctx.nfse(empresa),
      certificado: ctx.certificado(empresa),
      chave: r.chave,
      ambiente: r.ambiente,
      versaoAplicativo: config(c).versaoAplicativo ?? "@fiscal/api",
      documentoAutor: config(c).prestador.documento,
      motivo: motivo ?? "",
      ...(codigoMotivo ? { codigoMotivo } : {}),
    });
    if (!resultado.registrado) {
      return c.json(
        {
          erro: {
            codigo: "NFSE_CANCELAMENTO_RECUSADO",
            mensagem: resultado.erros[0]?.descricao ?? "Recusado.",
            detalhes: { erros: resultado.erros },
          },
        },
        422,
      );
    }
    await ctx.arquivoFiscal.guardar(
      documento(empresa, r),
      "evento",
      resultado.xmlEvento ?? resultado.xmlPedidoAssinado,
      "cancelamento",
    );
    Object.assign(r, { situacao: "cancelada", atualizadaEm: new Date().toISOString() });
    await ctx.registros.salvar(empresa.id, r);
    return c.json(r);
  });

  return app;
}
