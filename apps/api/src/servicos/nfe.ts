import { consultarNfe } from "@fiscal/nfe";
import type { Empresa } from "../empresas";
import { falhar } from "../http";
import type { RegistroNota } from "../registros";
import type { Operacao } from "./nfce";

export const MODELO_NFE = "55" as const;

export const configNfe = (empresa: Empresa) =>
  empresa.nfe ??
  falhar(409, "NFE_NAO_CONFIGURADA", "A empresa não tem os dados de NF-e cadastrados.");

export const documentoNfe = (empresa: Empresa, r: RegistroNota) => ({
  cnpj: empresa.cnpj,
  modelo: MODELO_NFE,
  ambiente: r.ambiente,
  chave: r.id,
  dataEmissao: r.dataEmissao,
});

export const serieNfe = (empresa: Empresa, r: Pick<RegistroNota, "ambiente" | "serie">) => ({
  empresa: empresa.id,
  modelo: MODELO_NFE,
  ambiente: r.ambiente,
  serie: r.serie,
});

/** Pergunta à SEFAZ o destino de uma NF-e pendente e atualiza o registro. */
export async function resolverPendenteNfe(op: Operacao, r: RegistroNota) {
  const { ctx, empresa } = op;
  if (r.situacao !== "pendente") return r;
  const xmlNota = (await ctx.arquivoFiscal.lerTexto(documentoNfe(empresa, r), "nota")) ?? "";
  const consulta = await consultarNfe(ctx.sefaz(empresa), {
    uf: configNfe(empresa).emitente.endereco.uf,
    ambiente: r.ambiente,
    chave: r.id,
    xmlNota,
  });
  if (consulta.situacao === "autorizada" && consulta.xmlProcessado) {
    await ctx.arquivoFiscal.guardar(documentoNfe(empresa, r), "nota", consulta.xmlProcessado);
    await ctx.numeracao.registrar(serieNfe(empresa, r), r.numero, "autorizado", r.id);
    Object.assign(r, {
      situacao: "autorizada",
      ...(consulta.protocolo ? { protocolo: consulta.protocolo } : {}),
    });
  } else if (consulta.situacao === "nao-encontrada") {
    await ctx.numeracao.registrar(serieNfe(empresa, r), r.numero, "liberado");
    r.situacao = "nao-recebida";
  } else if (consulta.situacao === "cancelada" || consulta.situacao === "denegada") {
    r.situacao = consulta.situacao;
  }
  r.motivo = consulta.motivo;
  r.atualizadaEm = new Date().toISOString();
  await ctx.registros.salvar(empresa.id, r);
  return r;
}
