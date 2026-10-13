import { montarDanfeNfce, paraEscPos, paraHtml, paraTexto } from "@fiscal/documentos";
import { type Venda, cancelarNfce, emitirNfce } from "@fiscal/nfce";
import type { Serie } from "@fiscal/numeracao";
import { type Context, Hono } from "hono";
import { type Ambiente, falhar, lerCorpo } from "../http";
import type { RegistroNota } from "../registros";
import {
  MODELO_NFCE as MODELO,
  type Operacao,
  configNfce,
  documentoNfce as documento,
  resolverPendenteNfce,
  transmitirOfflineNfce,
} from "../servicos/nfce";

const JUSTIFICATIVA_OFFLINE = "SEFAZ indisponivel no momento da venda";

export function rotasNfce() {
  const app = new Hono<Ambiente>();
  const op = (c: Context<Ambiente>): Operacao => ({ ctx: c.get("ctx"), empresa: c.get("empresa") });

  /**
   * Emite. Header opcional Idempotency-Key: repetir o pedido devolve a mesma resposta.
   * Com `contingenciaOffline` no cadastro, SEFAZ fora do ar vira nota offline (202, situacao "offline").
   */
  app.post("/", async (c) => {
    const empresa = c.get("empresa");
    const ctx = c.get("ctx");
    const nfce = configNfce(empresa);
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
        ...(nfce.contingenciaOffline
          ? { contingencia: { justificativa: JUSTIFICATIVA_OFFLINE } }
          : {}),
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
      offline: "pendente",
      rejeitada: "liberado",
    } as const;
    await ctx.numeracao.registrar(
      serie,
      nota.numero,
      situacaoNumero[autorizacao.situacao as keyof typeof situacaoNumero],
      nota.chave,
    );

    // Tentativa online sem resposta antes da offline: fica pendente. Se a SEFAZ a tiver autorizado,
    // é cancelada por substituição depois que a offline for transmitida.
    const tentativa = emissao.tentativaOnlinePendente;
    if (tentativa) {
      const agora = new Date().toISOString();
      const original: RegistroNota = {
        id: tentativa.nota.chave,
        chave: tentativa.nota.chave,
        modelo: MODELO,
        ambiente: empresa.ambiente,
        numero: tentativa.nota.numero,
        serie: nfce.serie,
        dataEmissao: tentativa.nota.dataEmissao,
        situacao: "pendente",
        valorTotal: tentativa.nota.valorTotal,
        substituidaPor: nota.chave,
        motivo: "Sem resposta da SEFAZ; venda refeita em contingência offline",
        criadaEm: agora,
        atualizadaEm: agora,
      };
      await ctx.arquivoFiscal.guardar(documento(empresa, original), "nota", tentativa.xmlAssinado);
      await ctx.numeracao.registrar(serie, original.numero, "pendente", original.id);
      await ctx.registros.salvar(empresa.id, original);
    }

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
      ...(tentativa ? { substitui: tentativa.nota.chave } : {}),
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
          autorizacao.situacao === "pendente" ||
          autorizacao.situacao === "offline" ||
          autorizacao.situacao === "denegada"
            ? autorizacao.situacao
            : "autorizada",
        ...(autorizacao.protocolo ? { protocolo: autorizacao.protocolo } : {}),
        valorTotal: nota.valorTotal,
        troco: nota.troco,
        qrCode: nota.qrCode,
        urlConsulta: nota.urlConsulta,
        motivo: autorizacao.motivo,
        ...(referencia ? { referencia } : {}),
        ...(tentativa ? { substitui: tentativa.nota.chave } : {}),
        criadaEm: agora,
        atualizadaEm: agora,
      };
      // Pendente/offline: guarda a NFe assinada; autorizada/denegada: o nfeProc com o protocolo
      await ctx.arquivoFiscal.guardar(
        documento(empresa, registro),
        "nota",
        autorizacao.xmlProcessado ?? emissao.xmlAssinado,
      );
      await ctx.registros.salvar(empresa.id, registro);
      if (autorizacao.situacao === "pendente" || autorizacao.situacao === "offline") status = 202;
    }
    if (chaveIdem)
      await ctx.registros.guardarRespostaIdempotente(empresa.id, chaveIdem, status, corpo);
    return c.json(corpo, status);
  });

  /** Chaves das NFC-e offline ainda não transmitidas. */
  app.get("/offline", async (c) => {
    const empresa = c.get("empresa");
    const chaves = await c
      .get("ctx")
      .registros.listarEmAberto(empresa.id, MODELO, empresa.ambiente, "offline");
    return c.json({ chaves });
  });

  /**
   * Transmite as NFC-e offline agora. A API também faz isso sozinha de tempos em tempos (rotinas);
   * esta rota serve para forçar, por exemplo, quando o caixa percebe que a internet voltou.
   */
  app.post("/offline/transmitir", async (c) => c.json(await transmitirOfflineNfce(op(c))));

  const obterRegistro = async (c: Context<Ambiente>) => {
    const empresa = c.get("empresa");
    const r = await c
      .get("ctx")
      .registros.obter(empresa.id, MODELO, empresa.ambiente, c.req.param("chave") ?? "");
    return r ?? falhar(404, "NOTA_NAO_ENCONTRADA", "NFC-e não encontrada.");
  };

  /** Situação. Se estiver pendente, consulta a SEFAZ e resolve. */
  app.get("/:chave", async (c) =>
    c.json(await resolverPendenteNfce(op(c), await obterRegistro(c))),
  );

  app.get("/:chave/xml", async (c) => {
    const r = await obterRegistro(c);
    const xml = await c.get("ctx").arquivoFiscal.lerTexto(documento(c.get("empresa"), r), "nota");
    return xml
      ? c.body(xml, 200, { "Content-Type": "application/xml; charset=utf-8" })
      : falhar(404, "XML_NAO_ENCONTRADO", "XML não encontrado.");
  });

  /** DANFE NFC-e. ?formato=escpos|html|texto (padrão html) &papel=80|58 &via=consumidor|estabelecimento */
  app.get("/:chave/danfe", async (c) => {
    const r = await obterRegistro(c);
    const xml = await c.get("ctx").arquivoFiscal.lerTexto(documento(c.get("empresa"), r), "nota");
    if (!xml) return falhar(404, "XML_NAO_ENCONTRADO", "XML não encontrado.");
    const papel = c.req.query("papel") === "58" ? 58 : 80;
    const via = c.req.query("via");
    const linhas = montarDanfeNfce(xml, {
      cancelada: r.situacao === "cancelada",
      ...(via === "estabelecimento" || via === "consumidor" ? { via } : {}),
    });
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
      uf: configNfce(empresa).emitente.endereco.uf,
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
