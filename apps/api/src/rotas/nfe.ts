import { gerarDanfe } from "@fiscal/documentos";
import {
  type DadosNfe,
  type OperacaoNfe,
  cancelarNfe,
  emitirNfe,
  enviarCartaCorrecao,
} from "@fiscal/nfe";
import { type Context, Hono } from "hono";
import { type Ambiente, falhar, lerCorpo } from "../http";
import type { RegistroNota } from "../registros";
import type { Operacao } from "../servicos/nfce";
import {
  MODELO_NFE as MODELO,
  configNfe,
  documentoNfe as documento,
  resolverPendenteNfe,
  serieNfe,
} from "../servicos/nfe";

/** O que o sistema do cliente manda em cada nota (o resto vem do cadastro da empresa). */
type DadosPedido = Omit<
  DadosNfe,
  "ambiente" | "serie" | "numero" | "codigoNumerico" | "versaoAplicativo"
>;

export function rotasNfe() {
  const app = new Hono<Ambiente>();
  const op = (c: Context<Ambiente>): Operacao => ({ ctx: c.get("ctx"), empresa: c.get("empresa") });

  /**
   * Emite. `{ operacao: { destinatario, itens, pagamentos, … }, nota: { naturezaOperacao, … },
   * referencia? }`. Header Idempotency-Key evita emissão dupla.
   */
  app.post("/", async (c) => {
    const empresa = c.get("empresa");
    const ctx = c.get("ctx");
    const nfe = configNfe(empresa);
    const chaveIdem = c.req.header("Idempotency-Key");
    if (chaveIdem) {
      const anterior = await ctx.registros.respostaIdempotente(empresa.id, chaveIdem);
      if (anterior) return c.json(anterior.corpo as object, anterior.status as 201);
    }
    const corpo = await lerCorpo<{
      operacao?: OperacaoNfe;
      nota?: DadosPedido;
      referencia?: string;
    }>(c);
    if (!corpo.operacao || !corpo.nota?.naturezaOperacao) {
      falhar(400, "DADOS_OBRIGATORIOS", "Envie operacao e nota.naturezaOperacao.");
    }
    const serie = serieNfe(empresa, { ambiente: empresa.ambiente, serie: nfe.serie });
    const reservados: number[] = [];
    let emissao: Awaited<ReturnType<typeof emitirNfe>>;
    try {
      emissao = await emitirNfe({
        cliente: ctx.sefaz(empresa),
        certificado: ctx.certificado(empresa),
        emitente: nfe.emitente,
        operacao: corpo.operacao,
        nota: {
          ...corpo.nota,
          // Datas chegam como texto no JSON
          ...(corpo.nota.dataSaida ? { dataSaida: new Date(corpo.nota.dataSaida) } : {}),
          ...(corpo.nota.dataEmissao ? { dataEmissao: new Date(corpo.nota.dataEmissao) } : {}),
          ambiente: empresa.ambiente,
          serie: Number(nfe.serie),
          versaoAplicativo: nfe.versaoAplicativo ?? "@fiscal/api",
        },
        ...(nfe.contingenciaSvc
          ? {
              contingencia: { justificativa: "SEFAZ do estado indisponivel no momento da emissao" },
            }
          : {}),
        proximoNumero: async () => {
          const n = await ctx.numeracao.reservar(serie, corpo.referencia);
          reservados.push(n);
          return n;
        },
      });
    } catch (erro) {
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
      situacaoNumero[autorizacao.situacao as keyof typeof situacaoNumero] ?? "pendente",
      nota.chave,
    );

    // Tentativa na SEFAZ do estado sem resposta antes da SVC: fica pendente e, se tiver sido
    // autorizada, a rotina a cancela (a venda saiu pela SVC com outro número)
    const tentativa = emissao.tentativaPendente;
    if (tentativa) {
      const agora = new Date().toISOString();
      const original: RegistroNota = {
        id: tentativa.nota.chave,
        chave: tentativa.nota.chave,
        modelo: MODELO,
        ambiente: empresa.ambiente,
        numero: tentativa.nota.numero,
        serie: nfe.serie,
        dataEmissao: tentativa.nota.dataEmissao,
        situacao: "pendente",
        valorTotal: tentativa.nota.valorTotal,
        substituidaPor: nota.chave,
        motivo: "Sem resposta da SEFAZ; nota refeita em contingência SVC",
        criadaEm: agora,
        atualizadaEm: agora,
      };
      await ctx.arquivoFiscal.guardar(documento(empresa, original), "nota", tentativa.xmlAssinado);
      await ctx.numeracao.registrar(serie, original.numero, "pendente", original.id);
      await ctx.registros.salvar(empresa.id, original);
    }

    const resposta = {
      chave: nota.chave,
      ...(nota.contingencia ? { contingencia: nota.contingencia } : {}),
      ...(tentativa ? { substitui: tentativa.nota.chave } : {}),
      numero: nota.numero,
      serie: nfe.serie,
      situacao: autorizacao.situacao,
      cStat: autorizacao.cStat,
      motivo: autorizacao.motivo,
      ...(autorizacao.protocolo ? { protocolo: autorizacao.protocolo } : {}),
      valorTotal: nota.valorTotal,
      impostos: nota.impostos,
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
        serie: nfe.serie,
        dataEmissao: nota.dataEmissao,
        situacao:
          autorizacao.situacao === "pendente" || autorizacao.situacao === "denegada"
            ? autorizacao.situacao
            : "autorizada",
        ...(autorizacao.protocolo ? { protocolo: autorizacao.protocolo } : {}),
        valorTotal: nota.valorTotal,
        motivo: autorizacao.motivo,
        ...(nota.contingencia ? { svc: nota.contingencia } : {}),
        ...(tentativa ? { substitui: tentativa.nota.chave } : {}),
        ...(corpo.referencia ? { referencia: corpo.referencia } : {}),
        criadaEm: agora,
        atualizadaEm: agora,
      };
      await ctx.arquivoFiscal.guardar(
        documento(empresa, registro),
        "nota",
        autorizacao.xmlProcessado ?? emissao.xmlAssinado,
      );
      await ctx.registros.salvar(empresa.id, registro);
      if (autorizacao.situacao === "pendente") status = 202;
    }
    if (chaveIdem)
      await ctx.registros.guardarRespostaIdempotente(empresa.id, chaveIdem, status, resposta);
    return c.json(resposta, status);
  });

  const obterRegistro = async (c: Context<Ambiente>) => {
    const empresa = c.get("empresa");
    const r = await c
      .get("ctx")
      .registros.obter(empresa.id, MODELO, empresa.ambiente, c.req.param("chave") ?? "");
    return r ?? falhar(404, "NOTA_NAO_ENCONTRADA", "NF-e não encontrada.");
  };

  /** Situação. Se estiver pendente, consulta a SEFAZ e resolve. */
  app.get("/:chave", async (c) => c.json(await resolverPendenteNfe(op(c), await obterRegistro(c))));

  app.get("/:chave/xml", async (c) => {
    const r = await obterRegistro(c);
    const xml = await c.get("ctx").arquivoFiscal.lerTexto(documento(c.get("empresa"), r), "nota");
    return xml
      ? c.body(xml, 200, { "Content-Type": "application/xml; charset=utf-8" })
      : falhar(404, "XML_NAO_ENCONTRADO", "XML não encontrado.");
  });

  /** DANFE em PDF (A4). */
  app.get("/:chave/danfe", async (c) => {
    const r = await obterRegistro(c);
    const xml = await c.get("ctx").arquivoFiscal.lerTexto(documento(c.get("empresa"), r), "nota");
    if (!xml) return falhar(404, "XML_NAO_ENCONTRADO", "XML não encontrado.");
    const pdf = await gerarDanfe(xml, { cancelada: r.situacao === "cancelada" });
    return c.body(new Uint8Array(pdf), 200, {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="danfe-${r.id}.pdf"`,
    });
  });

  const exigirAutorizada = (r: RegistroNota, acao: string) => {
    if (r.situacao !== "autorizada" || !r.protocolo) {
      falhar(
        409,
        "NOTA_NAO_AUTORIZADA",
        `Só NF-e autorizada pode ${acao} (esta está "${r.situacao}").`,
      );
    }
  };

  app.post("/:chave/cancelamento", async (c) => {
    const empresa = c.get("empresa");
    const ctx = c.get("ctx");
    const r = await obterRegistro(c);
    if (r.situacao === "cancelada") return c.json(r);
    exigirAutorizada(r, "ser cancelada");
    const { justificativa } = await lerCorpo<{ justificativa?: string }>(c);
    const resultado = await cancelarNfe(ctx.sefaz(empresa), {
      uf: configNfe(empresa).emitente.endereco.uf,
      ambiente: r.ambiente,
      chave: r.id,
      protocolo: r.protocolo ?? "",
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

  /**
   * Carta de correção: `{ correcao }`. Cada carta nova substitui a anterior (a API numera sozinha):
   * mande sempre o texto completo de tudo o que precisa ser corrigido.
   */
  app.post("/:chave/carta-correcao", async (c) => {
    const empresa = c.get("empresa");
    const ctx = c.get("ctx");
    const r = await obterRegistro(c);
    exigirAutorizada(r, "receber carta de correção");
    const { correcao } = await lerCorpo<{ correcao?: string }>(c);
    const sequencia = (r.cartasCorrecao ?? 0) + 1;
    const resultado = await enviarCartaCorrecao(ctx.sefaz(empresa), {
      uf: configNfe(empresa).emitente.endereco.uf,
      ambiente: r.ambiente,
      chave: r.id,
      correcao: correcao ?? "",
      sequencia,
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
      `cce-${String(sequencia).padStart(2, "0")}`,
    );
    Object.assign(r, { cartasCorrecao: sequencia, atualizadaEm: new Date().toISOString() });
    await ctx.registros.salvar(empresa.id, r);
    return c.json({ sequencia, protocolo: resultado.protocolo, motivo: resultado.motivo });
  });

  return app;
}
