/**
 * CNPJ numérico e alfanumérico (IN RFB 2.229/2024, a partir de julho/2026).
 * Os 12 primeiros caracteres podem ser 0-9 ou A-Z; os 2 dígitos verificadores são sempre numéricos.
 * No cálculo do DV, cada caractere vale (código ASCII − 48): "0"=0 … "9"=9, "A"=17 … "Z"=42.
 */

const PESOS_DV1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const PESOS_DV2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

/** Remove pontuação e coloca em maiúsculas: "12.abc.345/01de-35" → "12ABC34501DE35". */
export function limparCnpj(cnpj: string): string {
  return cnpj.replace(/[^0-9a-zA-Z]/g, "").toUpperCase();
}

function digito(base: string, pesos: number[]): number {
  let soma = 0;
  for (let i = 0; i < base.length; i++) {
    soma += (base.charCodeAt(i) - 48) * (pesos[i] ?? 0);
  }
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

/** Calcula os 2 dígitos verificadores a partir da base de 12 caracteres. */
export function calcularDvCnpj(base12: string): string {
  const base = limparCnpj(base12);
  const dv1 = digito(base, PESOS_DV1);
  const dv2 = digito(base + dv1, PESOS_DV2);
  return `${dv1}${dv2}`;
}

export function validarCnpj(cnpj: string): boolean {
  const limpo = limparCnpj(cnpj);
  if (!/^[0-9A-Z]{12}\d{2}$/.test(limpo)) return false;
  if (/^(.)\1{13}$/.test(limpo)) return false;
  return limpo.slice(12) === calcularDvCnpj(limpo.slice(0, 12));
}

/** "12ABC34501DE35" → "12.ABC.345/01DE-35" */
export function formatarCnpj(cnpj: string): string {
  const limpo = limparCnpj(cnpj);
  return limpo.replace(
    /^([0-9A-Z]{2})([0-9A-Z]{3})([0-9A-Z]{3})([0-9A-Z]{4})(\d{2})$/,
    "$1.$2.$3/$4-$5",
  );
}

export function cnpjAlfanumerico(cnpj: string): boolean {
  return /[A-Z]/.test(limparCnpj(cnpj));
}
