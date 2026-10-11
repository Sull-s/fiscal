import { montarDanfeNfce, paraEscPos, paraHtml, paraTexto } from "@fiscal/documentos";
import {
  type ResultadoAutorizacao,
  type Venda,
  cancelarNfce,
  consultarNfce,
  emitirNfce,
  transmitirNfceOffline,
} from "@fiscal/nfce";
import type { Serie } from "@fiscal/numeracao";
import { type Context, Hono } from "hono";
import type { Empresa } from "../empresas";
import { type Ambiente, falhar, lerCorpo } from "../http";
import type { RegistroNota } from "../registros";

const MODELO = "65" as const;
const JUSTIFICATIVA_OFFLINE = "SEFAZ indisponivel no momento da venda";

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
  const serieDe = (empresa: Empresa, r: Pick<RegistroNota, "ambiente" | "serie">): Serie => ({
    empresa: empresa.id,
    modelo: MODELO,
    ambiente: r.ambiente,
    serie: r.serie,
  });

  /** Guarda o nfeProc, marca o número e atualiza o registro de uma nota autorizada. */
  async function guardarAutorizada(
    c: Context<Ambiente>,
    r: RegistroNota,
    autorizacao: Pick<ResultadoAutorizacao, "protocolo" | "xmlProcessado" | "motivo">,
  ) {
    const empresa = c.get("empresa");
    const ctx = c.get("ctx");
    if (autorizacao.xmlProcessado) {
      await ctx.arquivoFiscal.guardar(documento(empresa, r), "nota", autorizacao.xmlProcessado);
    }
    await ctx.numeracao.registrar(serieDe(empresa, r), r.numero, "autorizado", r.id);
    Object.assign(r, {
      situacao: "autorizada",
      motivo: autorizacao.motivo,
      ...(autorizacao.protocolo ? { protocolo: autorizacao.protocolo } : {}),
      atualizadaEm: new Date().toISOString(),
    });
    await ctx.registros.salvar(empresa.id, r);
  }

  /**
   * Tentativa online sem resposta que acabou autorizada, mas a venda já tinha saído offline com
   * outra chave: cancela a online por substituição (110112). A SEFAZ só aceita depois que a
   * offline foi autorizada; até lá não faz nada.
   */
  async function cancelarSubstituida(c: Context<Ambiente>, original: RegistroNota) {
    const empresa = c.get("empresa");
    const ctx = c.get("ctx");
    if (original.situacao !== "autorizada" || !original.substituidaPor || !original.protocolo) {
      return;
    }
    const substituta = await ctx.registros.obter(
      empresa.id,
      MODELO,
      original.ambiente,
      original.substituidaPor,
    );
    if (substituta?.situacao !== "autorizada") return;
    const resultado = await cancelarNfce(ctx.sefaz(empresa), {
      uf: config(c).emitente.endereco.uf,
      ambiente: original.ambiente,
      chave: original.id,
      protocolo: original.protocolo,
      justificativa: "Venda emitida em contingencia offline com outra chave",
      documentoEmitente: empresa.cnpj,
      certificado: ctx.certificado(empresa),
      chaveSubstituta: substituta.id,
      versaoAplicativo: config(c).versaoAplicativo ?? "@fiscal/api",
    });
    if (!resultado.registrado) {
      original.motivo = `Cancelamento por substituição recusado: ${resultado.cStat} ${resultado.motivo}`;
      await ctx.registros.salvar(empresa.id, original);
      return;
    }
    await ctx.arquivoFiscal.guardar(
      documento(empresa, original),
      "evento",
      resultado.xmlProcessado ?? "",
      "cancelamento",
    );
    Object.assign(original, {
      situacao: "cancelada",
      motivo: resultado.motivo,
      atualizadaEm: new Date().toISOString(),
    });
    await ctx.registros.salvar(empresa.id, original);
  }

  /** Transmite uma NFC-e offline e atualiza o registro. Erro de comunicação sobe para quem chamou. */
  async function transmitir(c: Context<Ambiente>, r: RegistroNota) {
    const empresa = c.get("empresa");
    const ctx = c.get("ctx");
    const xmlAssinado = await ctx.arquivoFiscal.lerTexto(documento(empresa, r), "nota");
    if (!xmlAssinado) {
      return falhar(404, "XML_NAO_ENCONTRADO", "XML da nota offline não encontrado.");
    }
    const resultado = await transmitirNfceOffline(ctx.sefaz(empresa), {
      uf: config(c).emitente.endereco.uf,
      ambiente: r.ambiente,
      xmlAssinado,
    });
    switch (resultado.situacao) {
      case "autorizada": {
        await guardarAutorizada(c, r, resultado);
        await ctx.registros.marcarOffline(empresa.id, r.ambiente, r.id, false);
        const original = r.substitui
          ? await ctx.registros.obter(empresa.id, MODELO, r.ambiente, r.substitui)
          : null;
        if (original) await cancelarSubstituida(c, original);
        return r;
      }
      case "denegada":
        if (resultado.xmlProcessado) {
          await ctx.arquivoFiscal.guardar(documento(empresa, r), "nota", resultado.xmlProcessado);
        }
        await ctx.numeracao.registrar(serieDe(empresa, r), r.numero, "denegado", r.id);
        Object.assign(r, { situacao: "denegada", motivo: resultado.motivo });
        await ctx.registros.marcarOffline(empresa.id, r.ambiente, r.id, false);
        break;
      case "rejeitada":
      case "numero-em-uso":
        // A venda aconteceu e o cupom foi impresso: alguém precisa corrigir e emitir de novo
        Object.assign(r, {
          situacao: "offline-rejeitada",
          motivo: `${resultado.cStat} ${resultado.motivo}`,
        });
        await ctx.registros.marcarOffline(empresa.id, r.ambiente, r.id, false);
        break;
      default:
        // Sem resposta: continua offline e vai de novo na próxima transmissão
        r.motivo = resultado.motivo;
    }
    r.atualizadaEm = new Date().toISOString();
    await ctx.registros.salvar(empresa.id, r);
    return r;
  }

  /**
   * Emite. Header opcional Idempotency-Key: repetir o pedido devolve a mesma resposta.
   * Com `contingenciaOffline` no cadastro, SEFAZ fora do ar vira nota offline (202, situacao "offline").
   */
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
      if (autorizacao.situacao === "offline") {
        await ctx.registros.marcarOffline(empresa.id, empresa.ambiente, nota.chave, true);
      }
      if (autorizacao.situacao === "pendente" || autorizacao.situacao === "offline") status = 202;
    }
    if (chaveIdem)
      await ctx.registros.guardarRespostaIdempotente(empresa.id, chaveIdem, status, corpo);
    return c.json(corpo, status);
  });

  /** Chaves das NFC-e offline ainda não transmitidas. */
  app.get("/offline", async (c) => {
    const empresa = c.get("empresa");
    return c.json({
      chaves: await c.get("ctx").registros.listarOffline(empresa.id, empresa.ambiente),
    });
  });

  /**
   * Transmite as NFC-e offline, das mais antigas para as mais novas. Chame quando a SEFAZ voltar
   * (ou de tempos em tempos). Se a SEFAZ ainda estiver fora, para na primeira falha.
   */
  app.post("/offline/transmitir", async (c) => {
    const empresa = c.get("empresa");
    const ctx = c.get("ctx");
    config(c);
    const transmitidas: { chave: string; situacao: string; motivo?: string }[] = [];
    for (const chave of await ctx.registros.listarOffline(empresa.id, empresa.ambiente)) {
      const r = await ctx.registros.obter(empresa.id, MODELO, empresa.ambiente, chave);
      if (r?.situacao !== "offline") {
        await ctx.registros.marcarOffline(empresa.id, empresa.ambiente, chave, false);
        continue;
      }
      try {
        const t = await transmitir(c, r);
        transmitidas.push({
          chave,
          situacao: t.situacao,
          ...(t.motivo ? { motivo: t.motivo } : {}),
        });
      } catch (erro) {
        transmitidas.push({
          chave,
          situacao: "offline",
          motivo: erro instanceof Error ? erro.message : String(erro),
        });
        break;
      }
    }
    const restantes = (await ctx.registros.listarOffline(empresa.id, empresa.ambiente)).length;
    return c.json({ transmitidas, restantes });
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
    if (r.situacao === "autorizada" && r.substituidaPor) await cancelarSubstituida(c, r);
    if (r.situacao !== "pendente") return c.json(r);

    const xmlNota = (await ctx.arquivoFiscal.lerTexto(documento(empresa, r), "nota")) ?? "";
    const consulta = await consultarNfce(ctx.sefaz(empresa), {
      uf: config(c).emitente.endereco.uf,
      ambiente: r.ambiente,
      chave: r.id,
      xmlNota,
    });
    if (consulta.situacao === "autorizada" && consulta.xmlProcessado) {
      await guardarAutorizada(c, r, consulta);
      if (r.substituidaPor) await cancelarSubstituida(c, r);
      return c.json(r);
    }
    if (consulta.situacao === "nao-encontrada") {
      // A SEFAZ nunca recebeu: o número volta para a numeração
      await ctx.numeracao.registrar(serieDe(empresa, r), r.numero, "liberado");
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
