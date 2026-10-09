import { ErroFiscal, limparCnpj } from "@fiscal/core";
import type { CertificadoA1 } from "./abrir";

export type SituacaoCertificado =
  | "valido"
  | "vencendo"
  | "critico"
  | "expirado"
  | "ainda-nao-valido";

export interface LimitesAlerta {
  /** Faltando até N dias: "vencendo" (padrão 30) */
  vencendo: number;
  /** Faltando até N dias: "critico" (padrão 7) */
  critico: number;
}

const DIA_MS = 86_400_000;

export function situacaoCertificado(
  cert: Pick<CertificadoA1, "validoDe" | "validoAte">,
  agora: Date = new Date(),
  limites: LimitesAlerta = { vencendo: 30, critico: 7 },
): { situacao: SituacaoCertificado; diasRestantes: number } {
  const diasRestantes = Math.floor((cert.validoAte.getTime() - agora.getTime()) / DIA_MS);
  if (agora < cert.validoDe) return { situacao: "ainda-nao-valido", diasRestantes };
  if (agora > cert.validoAte) return { situacao: "expirado", diasRestantes };
  if (diasRestantes <= limites.critico) return { situacao: "critico", diasRestantes };
  if (diasRestantes <= limites.vencendo) return { situacao: "vencendo", diasRestantes };
  return { situacao: "valido", diasRestantes };
}

/** Lança erro se o certificado não puder ser usado agora. Chame antes de assinar. */
export function exigirCertificadoValido(
  cert: Pick<CertificadoA1, "validoDe" | "validoAte">,
  agora: Date = new Date(),
): void {
  const { situacao } = situacaoCertificado(cert, agora);
  if (situacao === "expirado") {
    throw new ErroFiscal(
      "CERTIFICADO_EXPIRADO",
      `Certificado vencido em ${cert.validoAte.toLocaleDateString("pt-BR")}.`,
      { validoAte: cert.validoAte.toISOString() },
    );
  }
  if (situacao === "ainda-nao-valido") {
    throw new ErroFiscal(
      "CERTIFICADO_AINDA_NAO_VALIDO",
      `Certificado só vale a partir de ${cert.validoDe.toLocaleDateString("pt-BR")}. Confira o relógio do computador.`,
      { validoDe: cert.validoDe.toISOString() },
    );
  }
}

/**
 * A SEFAZ rejeita (213) quando a raiz do CNPJ do emitente (8 primeiros caracteres) difere da raiz
 * do CNPJ do certificado. Filiais podem usar o certificado da matriz; outra empresa não.
 */
export function certificadoServeParaEmitente(
  cert: Pick<CertificadoA1, "documento">,
  documentoEmitente: string,
): boolean {
  const doCert = limparCnpj(cert.documento);
  const emitente = limparCnpj(documentoEmitente);
  if (!doCert || !emitente) return false;
  if (doCert.length === 14 && emitente.length === 14) {
    return doCert.slice(0, 8) === emitente.slice(0, 8);
  }
  return doCert === emitente;
}
