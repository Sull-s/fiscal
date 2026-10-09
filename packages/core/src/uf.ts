import { ErroFiscal } from "./erros";

/** Código IBGE de cada UF (campo cUF dos documentos fiscais). */
export const CODIGOS_UF = {
  RO: 11,
  AC: 12,
  AM: 13,
  RR: 14,
  PA: 15,
  AP: 16,
  TO: 17,
  MA: 21,
  PI: 22,
  CE: 23,
  RN: 24,
  PB: 25,
  PE: 26,
  AL: 27,
  SE: 28,
  BA: 29,
  MG: 31,
  ES: 32,
  RJ: 33,
  SP: 35,
  PR: 41,
  SC: 42,
  RS: 43,
  MS: 50,
  MT: 51,
  GO: 52,
  DF: 53,
} as const;

export type Uf = keyof typeof CODIGOS_UF;
export type CodigoUf = (typeof CODIGOS_UF)[Uf];

export function ehUf(valor: string): valor is Uf {
  return Object.hasOwn(CODIGOS_UF, valor);
}

export function codigoUf(uf: Uf): CodigoUf {
  return CODIGOS_UF[uf];
}

export function siglaUf(codigo: number): Uf {
  for (const [sigla, cod] of Object.entries(CODIGOS_UF)) {
    if (cod === codigo) return sigla as Uf;
  }
  throw new ErroFiscal("UF_INVALIDA", `Código de UF desconhecido: ${codigo}`, { codigo });
}
