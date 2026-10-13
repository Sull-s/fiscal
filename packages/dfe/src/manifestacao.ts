import { ErroFiscal, formatarDataHoraSefaz, limparCnpj, validarChaveAcesso } from "@fiscal/core";
import { NS_NFE, type ResultadoEvento, enviarEvento } from "@fiscal/nfe-comum";
import type { ClienteSefaz } from "@fiscal/transporte";
import { type MaterialAssinatura, limparTexto, tag, texto } from "@fiscal/xml";
import { AMBIENTE_NACIONAL } from "./enderecos";

/**
 * Manifestação do destinatário: a empresa que recebeu a NF-e diz à Receita o que aconteceu.
 *  - ciencia: "vi que existe" (libera baixar o XML completo pela distribuição; não é a resposta final)
 *  - confirmacao: a operação aconteceu (mercadoria recebida)
 *  - desconhecimento: a empresa não reconhece essa nota
 *  - nao-realizada: a nota é dela, mas a operação não aconteceu (exige justificativa)
 */
export type TipoManifestacao = "ciencia" | "confirmacao" | "desconhecimento" | "nao-realizada";

const EVENTOS: Record<TipoManifestacao, { codigo: string; descricao: string }> = {
  confirmacao: { codigo: "210200", descricao: "Confirmacao da Operacao" },
  ciencia: { codigo: "210210", descricao: "Ciencia da Operacao" },
  desconhecimento: { codigo: "210220", descricao: "Desconhecimento da Operacao" },
  "nao-realizada": { codigo: "210240", descricao: "Operacao nao Realizada" },
};

export interface DadosManifestacao {
  chave: string;
  tipo: TipoManifestacao;
  /** CNPJ ou CPF de quem recebeu a nota (o destinatário, dono do certificado) */
  documento: string;
  ambiente: 1 | 2;
  /** Obrigatória em "nao-realizada" (15 a 255 caracteres) */
  justificativa?: string;
  /** Padrão 1 */
  sequencia?: number;
  dataEvento?: Date;
  fuso?: string;
}

/** Evento de manifestação pronto para assinar (elemento "infEvento"). Vai para o Ambiente Nacional. */
export function montarManifestacao(d: DadosManifestacao): { xml: string; id: string } {
  if (!validarChaveAcesso(d.chave)) {
    throw new ErroFiscal("CHAVE_INVALIDA", "Chave de acesso inválida.", { chave: d.chave });
  }
  if (d.chave.slice(20, 22) !== "55") {
    throw new ErroFiscal(
      "MANIFESTACAO_SO_NFE",
      "Manifestação do destinatário só existe para NF-e (55).",
    );
  }
  const evento = EVENTOS[d.tipo];
  if (!evento)
    throw new ErroFiscal("MANIFESTACAO_INVALIDA", `Tipo de manifestação desconhecido: ${d.tipo}.`);
  const xJust = limparTexto(d.justificativa, 255);
  if (d.tipo === "nao-realizada" && xJust.length < 15) {
    throw new ErroFiscal(
      "JUSTIFICATIVA_CURTA",
      "Operação não realizada exige justificativa de pelo menos 15 caracteres.",
    );
  }
  const doc = limparCnpj(d.documento);
  const sequencia = d.sequencia ?? 1;
  const id = `ID${evento.codigo}${d.chave}${String(sequencia).padStart(2, "0")}`;
  const corpo =
    // 91 = Ambiente Nacional
    tag("cOrgao", "91") +
    tag("tpAmb", d.ambiente) +
    tag(doc.length === 11 ? "CPF" : "CNPJ", doc) +
    tag("chNFe", d.chave) +
    tag("dhEvento", formatarDataHoraSefaz(d.dataEvento ?? new Date(), d.fuso)) +
    tag("tpEvento", evento.codigo) +
    tag("nSeqEvento", sequencia) +
    tag("verEvento", "1.00") +
    `<detEvento versao="1.00">${tag("descEvento", evento.descricao)}${d.tipo === "nao-realizada" ? texto("xJust", xJust) : ""}</detEvento>`;
  return {
    xml: `<evento xmlns="${NS_NFE}" versao="1.00"><infEvento Id="${id}">${corpo}</infEvento></evento>`,
    id,
  };
}

/** Assina e envia a manifestação ao Ambiente Nacional. 135/136 = registrada; 573 = já registrada. */
export function manifestar(
  cliente: ClienteSefaz,
  pedido: DadosManifestacao & { certificado: MaterialAssinatura },
): Promise<ResultadoEvento> {
  return enviarEvento(cliente, {
    // uf/modelo não são usados com url fixa; o evento vai para o Ambiente Nacional
    uf: "RS",
    modelo: "55",
    ambiente: pedido.ambiente,
    xmlEvento: montarManifestacao(pedido).xml,
    certificado: pedido.certificado,
    url: AMBIENTE_NACIONAL[pedido.ambiente].evento,
  });
}
