import { montarDanfeNfce, paraEscPos, paraHtml, paraTexto } from "@fiscal/documentos";
import { type Venda, cancelarNfce, consultarNfce, emitirNfce } from "@fiscal/nfce";
import type { Serie } from "@fiscal/numeracao";
import { type Context, Hono } from "hono";
import type { Empresa } from "../empresas";
import { type Ambiente, falhar, lerCorpo } from "../http";
import type { RegistroNota } from "../registros";

const MODELO = "65" as const;

export function rotasNfce() {
  const app = new Hono<Ambiente>();

  const config = (c: Context<Ambiente>) => {
    const empresa = c.get("empresa");
    return (
      empresa.nfce ??
      falhar(409, "NFCE_NAO_CONFIGURADA", "A empresa não tem os dados de NFC-e cadastrados.")
    );
  };

  const documento = (empresa: Empresa, r: RegistroNota) => ({
    cnpj: empresa.cnpj,
    modelo: MODELO,
    ambiente: r.ambiente,
    chave: r.id,
    dataEmissao: r.dataEmissao,
  });

  /** Emite. Header opcional Idempotency-Key: repetir o pedido devolve a mesma resposta. */
  app.post("/", async (c) => {
    const empresa = c.get("empresa");
    const ctx = c.get("ctx");
    const nfce = config(c);
    const chaveIdem = c.req.header("Idempotency-Key");
    if (chaveIdem) {
      const anterior = await ctx.registros.respostaIdempotente(empresa.id, chaveIdem);
      if (anterior) return c.json(anterior.corpo as object, anterior.status as 201);
    }
    const { venda, referencia } = await lerCorpo<{ venda?: Venda; referencia?: string }>(c);
    if (!venda) falhar(400, "VENDA_OBRIGATORIA", "Envie { venda: { itens, pagamentos, … } }.");

    const serie: Serie = {
      empresa: empresa.id,
      modelo: MODELO,
      ambiente: empresa.ambiente,
      serie: nfce.serie,
    };
    const reservados: number[] = [];
    let emissao: Awaited<ReturnType<typeof emitirNfce>>;
    try {
      emissao = await emitirNfce({
        cliente: ctx.sefaz(empresa),
        certificado: ctx.certificado(empresa),
        emitente: nfce.emitente,
        venda,
        nota: {
          ambiente: empresa.ambiente,
          serie: Number(nfce.serie),
          ...(nfce.versaoAplicativo ? { versaoAplicativo: nfce.versaoAplicativo } : {}),
        },
        proximoNumero: async () => {
          const n = await ctx.numeracao.reservar(serie, referencia);
          reservados.push(n);
          return n;
        },
      });
    } catch (erro) {
      // Falhou antes de a SEFAZ registrar algo (validação, conexão): devolve o número
      const ultimo = reservados.at(-1);
      if (ultimo !== undefined) await ctx.numeracao.registrar(serie, ultimo, "liberado");
      throw erro;
    }

    for (const n of emissao.numerosEmUso) await ctx.numeracao.registrar(serie, n, "em-uso");
    const { nota, autorizacao } = emissao;
    const situacaoNumero = {
      autorizada: "autorizado",
      denegada: "denegado",
      pendente: "pendente",
      rejeitada: "liberado",
    } as const;
    await ctx.numeracao.registrar(
      serie,
      nota.numero,
      situacaoNumero[autorizacao.situacao as keyof typeof situacaoNumero],
      nota.chave,
    );

    const corpo = {
      chave: nota.chave,
      numero: nota.numero,
      serie: nfce.serie,
      situacao: autorizacao.situacao,
      cStat: autorizacao.cStat,
      motivo: autorizacao.motivo,
      ...(autorizacao.protocolo ? { protocolo: autorizacao.protocolo } : {}),
      valorTotal: nota.valorTotal,
      troco: nota.troco,
      qrCode: nota.qrCode,
      urlConsulta: nota.urlConsulta,
      dataEmissao: nota.dataEmissao,
    };

    let status: 201 | 202 | 422 = 201;
    if (autorizacao.situacao === "rejeitada") {
      status = 422;
    } else {
      const agora = new Date().toISOString();
      const registro: RegistroNota = {
        id: nota.chave,
        chave: nota.chave,
        modelo: MODELO,
        ambiente: empresa.ambiente,
        numero: nota.numero,
        serie: nfce.serie,
        dataEmissao: nota.dataEmissao,
        situacao:
          autorizacao.situacao === "pendente"
            ? "pendente"
            : autorizacao.situacao === "denegada"
              ? "denegada"
              : "autorizada",
        ...(autorizacao.protocolo ? { protocolo: autorizacao.protocolo } : {}),
        valorTotal: nota.valorTotal,
        troco: nota.troco,
        qrCode: nota.qrCode,
        urlConsulta: nota.urlConsulta,
        motivo: autorizacao.motivo,
        ...(referencia ? { referencia } : {}),
        criadaEm: agora,
        atualizadaEm: agora,
      };
      // Pendente: guarda a NFe assinada; autorizada/denegada: o nfeProc com o protocolo
      await ctx.arquivoFiscal.guardar(
        documento(empresa, registro),
        "nota",
        autorizacao.xmlProcessado ?? emissao.xmlAssinado,
      );
      await ctx.registros.salvar(empresa.id, registro);
      if (autorizacao.situacao === "pendente") status = 202;
    }
    if (chaveIdem)
      await ctx.registros.guardarRespostaIdempotente(empresa.id, chaveIdem, status, corpo);
    return c.json(corpo, status);
  });

  const obterRegistro = async (c: Context<Ambiente>) => {
    const empresa = c.get("empresa");
    const r = await c
      .get("ctx")
      .registros.obter(empresa.id, MODELO, empresa.ambiente, c.req.param("chave") ?? "");
    return r ?? falhar(404, "NOTA_NAO_ENCONTRADA", "NFC-e não encontrada.");
  };

  /** Situação. Se estiver pendente, consulta a SEFAZ e resolve. */
  app.get("/:chave", async (c) => {
    const empresa = c.get("empresa");
    const ctx = c.get("ctx");
    const r = await obterRegistro(c);
    if (r.situacao !== "pendente") return c.json(r);

    const xmlNota = (await ctx.arquivoFiscal.lerTexto(documento(empresa, r), "nota")) ?? "";
    const consulta = await consultarNfce(ctx.sefaz(empresa), {
      uf: config(c).emitente.endereco.uf,
      ambiente: r.ambiente,
      chave: r.id,
      xmlNota,
    });
    const serie: Serie = {
      empresa: empresa.id,
      modelo: MODELO,
      ambiente: r.ambiente,
      serie: r.serie,
    };
    if (consulta.situacao === "autorizada" && consulta.xmlProcessado) {
      await ctx.arquivoFiscal.guardar(documento(empresa, r), "nota", consulta.xmlProcessado);
      await ctx.numeracao.registrar(serie, r.numero, "autorizado", r.id);
      Object.assign(r, {
        situacao: "autorizada",
        ...(consulta.protocolo ? { protocolo: consulta.protocolo } : {}),
      });
    } else if (consulta.situacao === "nao-encontrada") {
      // A SEFAZ nunca recebeu: o número volta para a numeração
      await ctx.numeracao.registrar(serie, r.numero, "liberado");
      r.situacao = "nao-recebida";
    } else if (consulta.situacao === "cancelada" || consulta.situacao === "denegada") {
      r.situacao = consulta.situacao;
    }
    r.motivo = consulta.motivo;
    r.atualizadaEm = new Date().toISOString();
    await ctx.registros.salvar(empresa.id, r);
    return c.json(r);
  });

  app.get("/:chave/xml", async (c) => {
    const r = await obterRegistro(c);
    const xml = await c.get("ctx").arquivoFiscal.lerTexto(documento(c.get("empresa"), r), "nota");
    return xml
      ? c.body(xml, 200, { "Content-Type": "application/xml; charset=utf-8" })
      : falhar(404, "XML_NAO_ENCONTRADO", "XML não encontrado.");
  });

  /** DANFE NFC-e. ?formato=escpos|html|texto (padrão html) &papel=80|58 */
  app.get("/:chave/danfe", async (c) => {
    const r = await obterRegistro(c);
    const xml = await c.get("ctx").arquivoFiscal.lerTexto(documento(c.get("empresa"), r), "nota");
    if (!xml) return falhar(404, "XML_NAO_ENCONTRADO", "XML não encontrado.");
    const papel = c.req.query("papel") === "58" ? 58 : 80;
    const linhas = montarDanfeNfce(xml, { cancelada: r.situacao === "cancelada" });
    switch (c.req.query("formato") ?? "html") {
      case "escpos":
        return c.body(new Uint8Array(paraEscPos(linhas, { papel })), 200, {
          "Content-Type": "application/octet-stream",
        });
      case "texto":
        return c.body(paraTexto(linhas, papel), 200, {
          "Content-Type": "text/plain; charset=utf-8",
        });
      case "html":
        return c.html(await paraHtml(linhas, { papel }));
      default:
        return falhar(400, "FORMATO_INVALIDO", "Formato deve ser escpos, html ou texto.");
    }
  });

  app.post("/:chave/cancelamento", async (c) => {
    const empresa = c.get("empresa");
    const ctx = c.get("ctx");
    const r = await obterRegistro(c);
    if (r.situacao === "cancelada") return c.json(r);
    if (r.situacao !== "autorizada" || !r.protocolo) {
      falhar(
        409,
        "NOTA_NAO_AUTORIZADA",
        `Só nota autorizada pode ser cancelada (esta está "${r.situacao}").`,
      );
    }
    const { justificativa } = await lerCorpo<{ justificativa?: string }>(c);
    const resultado = await cancelarNfce(ctx.sefaz(empresa), {
      uf: config(c).emitente.endereco.uf,
      ambiente: r.ambiente,
      chave: r.id,
      protocolo: r.protocolo,
      justificativa: justificativa ?? "",
      documentoEmitente: empresa.cnpj,
      certificado: ctx.certificado(empresa),
    });
    if (!resultado.registrado) {
      return c.json(
        { erro: { codigo: `SEFAZ_${resultado.cStat}`, mensagem: resultado.motivo } },
        422,
      );
    }
    await ctx.arquivoFiscal.guardar(
      documento(empresa, r),
      "evento",
      resultado.xmlProcessado ?? "",
      "cancelamento",
    );
    Object.assign(r, {
      situacao: "cancelada",
      motivo: resultado.motivo,
      atualizadaEm: new Date().toISOString(),
    });
    await ctx.registros.salvar(empresa.id, r);
    return c.json({ ...r, protocoloCancelamento: resultado.protocolo });
  });

  return app;
}
