import {
  type CertificadoA1,
  certificadoServeParaEmitente,
  exigirCertificadoValido,
} from "@fiscal/certificado";
import { ErroFiscal } from "@fiscal/core";
import { type ResultadoAutorizacao, autorizarNota } from "@fiscal/nfe-comum";
import type { ClienteSefaz } from "@fiscal/transporte";
import { assinarXml } from "@fiscal/xml";
import { montarNfe } from "./montar";
import type { DadosNfe, EmitenteNfe, NfeMontada, OperacaoNfe } from "./tipos";

export interface EmissaoNfe {
  nota: NfeMontada;
  /** NFe assinada, como foi enviada. Guarde SEMPRE, mesmo se ficar pendente */
  xmlAssinado: string;
  autorizacao: ResultadoAutorizacao;
  /** Números que a SEFAZ disse já estarem em uso (539): ficam gastos na sua numeração */
  numerosEmUso: number[];
}

/**
 * Emite uma NF-e de ponta a ponta: confere o certificado, monta, assina, envia e trata a resposta.
 *
 * - "autorizada": guarde `autorizacao.xmlProcessado` (nfeProc) e mande ao destinatário.
 * - "pendente": guarde `xmlAssinado` e resolva depois com `consultarNfe`.
 * - "denegada": o número fica gasto.
 * - "rejeitada": nada foi registrado; o número continua livre.
 *
 * `proximoNumero` deve reservar o número de forma atômica. Se a SEFAZ responder 539, tenta o próximo.
 */
export async function emitirNfe(entrada: {
  cliente: ClienteSefaz;
  certificado: CertificadoA1;
  emitente: EmitenteNfe;
  operacao: OperacaoNfe;
  nota: Omit<DadosNfe, "numero" | "codigoNumerico">;
  proximoNumero: () => Promise<number>;
  /** Padrão 3 */
  tentativasNumero?: number;
  agora?: Date;
}): Promise<EmissaoNfe> {
  const { cliente, certificado, emitente, operacao } = entrada;
  exigirCertificadoValido(certificado, entrada.agora);
  if (!certificadoServeParaEmitente(certificado, emitente.cnpj)) {
    throw new ErroFiscal(
      "CERTIFICADO_DE_OUTRA_EMPRESA",
      `O certificado é do CNPJ ${certificado.documento || "(não identificado)"}, que não tem a mesma raiz do emitente ${emitente.cnpj}.`,
      { documentoCertificado: certificado.documento, cnpjEmitente: emitente.cnpj },
    );
  }

  const numerosEmUso: number[] = [];
  const tentativas = entrada.tentativasNumero ?? 3;
  for (let i = 0; i < tentativas; i++) {
    const numero = await entrada.proximoNumero();
    const nota = montarNfe({ emitente, operacao, nota: { ...entrada.nota, numero } });
    const xmlAssinado = assinarXml(nota.xml, { certificado, elemento: "infNFe", perfil: "sefaz" });
    const autorizacao = await autorizarNota(cliente, {
      uf: emitente.endereco.uf,
      modelo: "55",
      ambiente: entrada.nota.ambiente,
      xmlAssinado,
    });
    if (autorizacao.situacao !== "numero-em-uso") {
      return { nota, xmlAssinado, autorizacao, numerosEmUso };
    }
    numerosEmUso.push(numero);
  }
  throw new ErroFiscal(
    "NFE_SEM_NUMERO_LIVRE",
    `A SEFAZ recusou ${tentativas} números seguidos como já usados (539). Confira a numeração da série.`,
    { numerosEmUso },
  );
}
