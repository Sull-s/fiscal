import { lerNfse, resolverPendente } from "@fiscal/nfse-nacional";
import type { Empresa } from "../empresas";
import { falhar } from "../http";
import type { RegistroNota } from "../registros";
import type { Operacao } from "./nfce";

export const MODELO_NFSE = "nfse" as const;

export const configNfse = (empresa: Empresa) =>
  empresa.nfse ??
  falhar(409, "NFSE_NAO_CONFIGURADA", "A empresa não tem os dados de NFS-e cadastrados.");

export const documentoNfse = (empresa: Empresa, r: RegistroNota) => ({
  cnpj: empresa.cnpj,
  modelo: MODELO_NFSE,
  ambiente: r.ambiente,
  chave: r.chave ?? r.id,
  dataEmissao: r.dataEmissao,
});

/** Guarda a NFS-e gerada, marca o número e atualiza o registro. */
export async function guardarNfseAutorizada(
  { ctx, empresa }: Operacao,
  r: RegistroNota,
  chave: string,
  xmlNfse: string,
) {
  const resumo = lerNfse(xmlNfse);
  Object.assign(r, {
    situacao: "autorizada",
    chave,
    numeroNfse: resumo.numero,
    valorTotal: Number(resumo.valores.liquido || resumo.valores.servico),
    atualizadaEm: new Date().toISOString(),
  });
  await ctx.arquivoFiscal.guardar(documentoNfse(empresa, r), "nota", xmlNfse);
  await ctx.numeracao.registrar(
    { empresa: empresa.id, modelo: MODELO_NFSE, ambiente: r.ambiente, serie: r.serie },
    r.numero,
    "autorizado",
    chave,
  );
  await ctx.registros.salvar(empresa.id, r);
}

/** Pergunta ao Sistema Nacional, pelo Id da DPS, se a NFS-e pendente foi gerada. */
export async function resolverPendenteNfse(op: Operacao, r: RegistroNota) {
  const { ctx, empresa } = op;
  if (r.situacao !== "pendente") return r;
  const resolvido = await resolverPendente(ctx.nfse(empresa), r.id);
  if (resolvido.gerada && resolvido.xmlNfse) {
    await guardarNfseAutorizada(op, r, resolvido.chave, resolvido.xmlNfse);
  } else if (!resolvido.gerada && resolvido.erros.some((e) => e.codigo.includes("404"))) {
    await ctx.numeracao.registrar(
      { empresa: empresa.id, modelo: MODELO_NFSE, ambiente: r.ambiente, serie: r.serie },
      r.numero,
      "liberado",
    );
    Object.assign(r, { situacao: "nao-recebida", atualizadaEm: new Date().toISOString() });
    await ctx.registros.salvar(empresa.id, r);
  }
  return r;
}
