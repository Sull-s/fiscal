import { formatarDecimal } from "@fiscal/xml";

/** Valor em reais → centavos inteiros, arredondando metade para cima sem erro de ponto flutuante. */
export function centavos(valor: number): number {
  return Number(formatarDecimal(valor, 2).replace(".", ""));
}

export const reais = (c: number) => c / 100;

/** quantidade × valor unitário, em centavos, com aritmética exata (até 4 e 10 casas). */
export function totalDoItemEmCentavos(quantidade: number, valorUnitario: number): number {
  const q = BigInt(formatarDecimal(quantidade, 4).replace(".", "")); // × 10^4
  const v = BigInt(formatarDecimal(valorUnitario, 10).replace(".", "")); // × 10^10
  const produto = q * v; // × 10^14
  const divisor = 10n ** 12n; // → × 10^2 (centavos)
  let resultado = produto / divisor;
  if ((produto % divisor) * 2n >= divisor) resultado += 1n;
  return Number(resultado);
}

/**
 * Reparte um valor (desconto, taxa de entrega) entre os itens proporcionalmente ao valor de cada um.
 * O último item fica com a sobra, para a soma bater exatamente.
 */
export function repartir(totalCentavos: number, pesosCentavos: number[]): number[] {
  if (!totalCentavos) return pesosCentavos.map(() => 0);
  const soma = pesosCentavos.reduce((s, p) => s + p, 0);
  let usados = 0;
  return pesosCentavos.map((peso, i) => {
    if (i === pesosCentavos.length - 1) return totalCentavos - usados;
    const parte = soma > 0 ? Math.floor((totalCentavos * peso) / soma) : 0;
    usados += parte;
    return parte;
  });
}

/** Valor unitário com 2 a 10 casas: só usa casas extras quando o preço tem frações de centavo. */
export function formatarValorUnitario(valor: number): string {
  const completo = formatarDecimal(valor, 10);
  const [inteiro, fracao = ""] = completo.split(".");
  const significativa = fracao.replace(/0+$/, "").padEnd(2, "0");
  return `${inteiro}.${significativa}`;
}
