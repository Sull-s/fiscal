import tabela from "./dados/municipios-ibge.json";
import type { Uf } from "./uf";

/**
 * Municípios do IBGE (5.571), código de 7 dígitos → "Nome/UF".
 * Fica num subcaminho separado (`@fiscal/core/municipios`) para quem não precisa não carregar a tabela.
 */
const MUNICIPIOS = tabela as Record<string, string>;

export function municipioExiste(codigo: string): boolean {
  return Object.hasOwn(MUNICIPIOS, codigo);
}

/** "4314902" → { nome: "Porto Alegre", uf: "RS" }; undefined se não existir. */
export function buscarMunicipio(
  codigo: string,
): { codigo: string; nome: string; uf: Uf } | undefined {
  const valor = MUNICIPIOS[codigo];
  if (!valor) return undefined;
  const barra = valor.lastIndexOf("/");
  return { codigo, nome: valor.slice(0, barra), uf: valor.slice(barra + 1) as Uf };
}

/** "Porto Alegre/RS" (ou "IBGE 1234567" se o código não existir; vazio se não houver código). */
export function nomeMunicipio(codigo: string | undefined): string {
  if (!codigo) return "";
  return MUNICIPIOS[codigo] ?? `IBGE ${codigo}`;
}
