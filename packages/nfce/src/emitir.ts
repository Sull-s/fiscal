import {
  type CertificadoA1,
  certificadoServeParaEmitente,
  exigirCertificadoValido,
} from "@fiscal/certificado";
import { ErroFiscal } from "@fiscal/core";
import type { ClienteSefaz } from "@fiscal/transporte";
import { assinarXml } from "@fiscal/xml";
import { montarNfce } from "./montar";
import { type ResultadoAutorizacao, autorizarNfce } from "./sefaz";
import type { DadosNota, EmitenteNfce, NfceMontada, Venda } from "./tipos";

export interface EmissaoNfce {
  nota: NfceMontada;
  /** NFe assinada, como foi enviada. Guarde SEMPRE, mesmo se ficar pendente */
  xmlAssinado: string;
  autorizacao: ResultadoAutorizacao;
  /**
   * Números que a SEFAZ disse já estarem em uso por outra nota (539). Ficam gastos: marque como
   * usados na sua numeração para nunca serem dados como "pulados".
   */
  numerosEmUso: number[];
}

/**
 * Emite uma NFC-e de ponta a ponta: confere o certificado, monta, assina, envia e trata a resposta.
 *
 * - "autorizada": guarde `autorizacao.xmlProcessado` (nfeProc).
 * - "pendente": guarde `xmlAssinado` e resolva depois com `consultarNfce` (a SEFAZ pode ter autorizado).
 * - "denegada": o número fica gasto.
 * - "rejeitada": nada foi registrado; o número continua livre. Veja `autorizacao.cStat/motivo`.
 *
 * `proximoNumero` deve reservar o número de forma atômica (duas vendas ao mesmo tempo não podem
 * receber o mesmo número). Se a SEFAZ responder 539, pede outro número e tenta de novo.
 */
export async function emitirNfce(entrada: {
  cliente: ClienteSefaz;
  certificado: CertificadoA1;
  emitente: EmitenteNfce;
  venda: Venda;
  nota: Omit<DadosNota, "numero" | "codigoNumerico">;
  proximoNumero: () => Promise<number>;
  /** Padrão 3 */
  tentativasNumero?: number;
  /** Momento de referência para validar o certificado (padrão: agora) */
  agora?: Date;
}): Promise<EmissaoNfce> {
  const { cliente, certificado, emitente, venda } = entrada;
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
    const nota = montarNfce({ emitente, venda, nota: { ...entrada.nota, numero } });
    const xmlAssinado = assinarXml(nota.xml, { certificado, elemento: "infNFe", perfil: "sefaz" });
    const autorizacao = await autorizarNfce(cliente, {
      uf: emitente.endereco.uf,
      ambiente: entrada.nota.ambiente,
      xmlAssinado,
    });
    if (autorizacao.situacao !== "numero-em-uso") {
      return { nota, xmlAssinado, autorizacao, numerosEmUso };
    }
    numerosEmUso.push(numero);
  }
  throw new ErroFiscal(
    "NFCE_SEM_NUMERO_LIVRE",
    `A SEFAZ recusou ${tentativas} números seguidos como já usados (539). Confira a numeração da série.`,
    { numerosEmUso },
  );
}
