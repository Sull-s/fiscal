import {
  type ResultadoAutorizacao,
  cancelarNfce,
  consultarNfce,
  transmitirNfceOffline,
} from "@fiscal/nfce";
import type { Serie } from "@fiscal/numeracao";
import type { Contexto } from "../contexto";
import type { Empresa } from "../empresas";
import { falhar } from "../http";
import type { RegistroNota } from "../registros";

export const MODELO_NFCE = "65" as const;

/** Uma operação sempre acontece em nome de uma empresa. */
export interface Operacao {
  ctx: Contexto;
  empresa: Empresa;
}

export const configNfce = (empresa: Empresa) =>
  empresa.nfce ??
  falhar(409, "NFCE_NAO_CONFIGURADA", "A empresa não tem os dados de NFC-e cadastrados.");

export const documentoNfce = (empresa: Empresa, r: RegistroNota) => ({
  cnpj: empresa.cnpj,
  modelo: MODELO_NFCE,
  ambiente: r.ambiente,
  chave: r.id,
  dataEmissao: r.dataEmissao,
});

export const serieNfce = (
  empresa: Empresa,
  r: Pick<RegistroNota, "ambiente" | "serie">,
): Serie => ({
  empresa: empresa.id,
  modelo: MODELO_NFCE,
  ambiente: r.ambiente,
  serie: r.serie,
});

/** Guarda o nfeProc, marca o número e atualiza o registro de uma nota autorizada. */
async function guardarAutorizada(
  { ctx, empresa }: Operacao,
  r: RegistroNota,
  autorizacao: Pick<ResultadoAutorizacao, "protocolo" | "xmlProcessado" | "motivo">,
) {
  if (autorizacao.xmlProcessado) {
    await ctx.arquivoFiscal.guardar(documentoNfce(empresa, r), "nota", autorizacao.xmlProcessado);
  }
  await ctx.numeracao.registrar(serieNfce(empresa, r), r.numero, "autorizado", r.id);
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
export async function cancelarSubstituida(op: Operacao, original: RegistroNota) {
  const { ctx, empresa } = op;
  if (original.situacao !== "autorizada" || !original.substituidaPor || !original.protocolo) {
    return;
  }
  const substituta = await ctx.registros.obter(
    empresa.id,
    MODELO_NFCE,
    original.ambiente,
    original.substituidaPor,
  );
  if (substituta?.situacao !== "autorizada") return;
  const config = configNfce(empresa);
  const resultado = await cancelarNfce(ctx.sefaz(empresa), {
    uf: config.emitente.endereco.uf,
    ambiente: original.ambiente,
    chave: original.id,
    protocolo: original.protocolo,
    justificativa: "Venda emitida em contingencia offline com outra chave",
    documentoEmitente: empresa.cnpj,
    certificado: ctx.certificado(empresa),
    chaveSubstituta: substituta.id,
    versaoAplicativo: config.versaoAplicativo ?? "@fiscal/api",
  });
  if (!resultado.registrado) {
    original.motivo = `Cancelamento por substituição recusado: ${resultado.cStat} ${resultado.motivo}`;
    await ctx.registros.salvar(empresa.id, original);
    return;
  }
  await ctx.arquivoFiscal.guardar(
    documentoNfce(empresa, original),
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

/** Pergunta à SEFAZ o destino de uma NFC-e pendente e atualiza o registro. */
export async function resolverPendenteNfce(op: Operacao, r: RegistroNota) {
  const { ctx, empresa } = op;
  if (r.situacao === "autorizada" && r.substituidaPor) await cancelarSubstituida(op, r);
  if (r.situacao !== "pendente") return r;

  const xmlNota = (await ctx.arquivoFiscal.lerTexto(documentoNfce(empresa, r), "nota")) ?? "";
  const consulta = await consultarNfce(ctx.sefaz(empresa), {
    uf: configNfce(empresa).emitente.endereco.uf,
    ambiente: r.ambiente,
    chave: r.id,
    xmlNota,
  });
  if (consulta.situacao === "autorizada" && consulta.xmlProcessado) {
    await guardarAutorizada(op, r, consulta);
    if (r.substituidaPor) await cancelarSubstituida(op, r);
    return r;
  }
  if (consulta.situacao === "nao-encontrada") {
    // A SEFAZ nunca recebeu: o número volta para a numeração
    await ctx.numeracao.registrar(serieNfce(empresa, r), r.numero, "liberado");
    r.situacao = "nao-recebida";
  } else if (consulta.situacao === "cancelada" || consulta.situacao === "denegada") {
    r.situacao = consulta.situacao;
  }
  r.motivo = consulta.motivo;
  r.atualizadaEm = new Date().toISOString();
  await ctx.registros.salvar(empresa.id, r);
  return r;
}

/** Transmite uma NFC-e offline e atualiza o registro. Erro de comunicação sobe para quem chamou. */
async function transmitir(op: Operacao, r: RegistroNota) {
  const { ctx, empresa } = op;
  const xmlAssinado = await ctx.arquivoFiscal.lerTexto(documentoNfce(empresa, r), "nota");
  if (!xmlAssinado) {
    return falhar(404, "XML_NAO_ENCONTRADO", "XML da nota offline não encontrado.");
  }
  const resultado = await transmitirNfceOffline(ctx.sefaz(empresa), {
    uf: configNfce(empresa).emitente.endereco.uf,
    ambiente: r.ambiente,
    xmlAssinado,
  });
  switch (resultado.situacao) {
    case "autorizada": {
      await guardarAutorizada(op, r, resultado);
      const original = r.substitui
        ? await ctx.registros.obter(empresa.id, MODELO_NFCE, r.ambiente, r.substitui)
        : null;
      if (original) await cancelarSubstituida(op, original);
      return r;
    }
    case "denegada":
      if (resultado.xmlProcessado) {
        await ctx.arquivoFiscal.guardar(documentoNfce(empresa, r), "nota", resultado.xmlProcessado);
      }
      await ctx.numeracao.registrar(serieNfce(empresa, r), r.numero, "denegado", r.id);
      Object.assign(r, { situacao: "denegada", motivo: resultado.motivo });
      break;
    case "rejeitada":
    case "numero-em-uso":
      // A venda aconteceu e o cupom foi impresso: alguém precisa corrigir e emitir de novo
      Object.assign(r, {
        situacao: "offline-rejeitada",
        motivo: `${resultado.cStat} ${resultado.motivo}`,
      });
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
 * Transmite as NFC-e offline, das mais antigas para as mais novas.
 * Se a SEFAZ ainda estiver fora, para na primeira falha (as outras ficam para a próxima vez).
 */
export async function transmitirOfflineNfce(op: Operacao) {
  const { ctx, empresa } = op;
  configNfce(empresa);
  const listar = () =>
    ctx.registros.listarEmAberto(empresa.id, MODELO_NFCE, empresa.ambiente, "offline");
  const transmitidas: { chave: string; situacao: string; motivo?: string }[] = [];
  for (const chave of await listar()) {
    const r = await ctx.registros.obter(empresa.id, MODELO_NFCE, empresa.ambiente, chave);
    if (r?.situacao !== "offline") continue;
    try {
      const t = await transmitir(op, r);
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
  return { transmitidas, restantes: (await listar()).length };
}
