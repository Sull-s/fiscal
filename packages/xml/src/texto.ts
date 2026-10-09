/**
 * Os campos de texto da SEFAZ (TString) só aceitam caracteres até U+00FF, sem espaço no início/fim
 * nem espaços repetidos. Aspas e travessões "bonitos" (Word, celular) viram os simples.
 * Se `maximo` for informado, corta no tamanho máximo do campo.
 */
export function limparTexto(valor: unknown, maximo?: number): string {
  let s = String(valor ?? "")
    .normalize("NFC")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/[^ -ÿ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (maximo !== undefined && s.length > maximo) s = s.slice(0, maximo).trim();
  return s;
}

/** Escapa conteúdo de elemento: só &, < e > (forma canônica C14N). */
export function escaparTexto(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Escapa valor de atributo entre aspas duplas (forma canônica C14N). */
export function escaparAtributo(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;")
    .replace(/\t/g, "&#x9;")
    .replace(/\n/g, "&#xA;")
    .replace(/\r/g, "&#xD;");
}

export function somenteDigitos(valor: unknown): string {
  return String(valor ?? "").replace(/\D/g, "");
}

/**
 * Formata número com casas decimais fixas, arredondando metade para cima (padrão da SEFAZ),
 * sem os erros de ponto flutuante: 1.005 → "1.01" (o `toFixed` nativo dá "1.00").
 */
export function formatarDecimal(valor: number | string, casas = 2): string {
  const n = typeof valor === "string" ? Number(valor.replace(",", ".")) : valor;
  if (!Number.isFinite(n)) throw new RangeError(`Valor numérico inválido: ${valor}`);

  // 10 casas extras absorvem o ruído binário (1.005 é guardado como 1.00499999999999989…)
  const precisao = 10;
  const negativo = n < 0;
  const inteiro = BigInt(Math.abs(n).toFixed(precisao).replace(".", ""));
  const divisor = 10n ** BigInt(precisao - casas);
  let arredondado = inteiro / divisor;
  if ((inteiro % divisor) * 2n >= divisor) arredondado += 1n;

  const digitos = arredondado.toString().padStart(casas + 1, "0");
  const parteInteira = digitos.slice(0, digitos.length - casas);
  const parteDecimal = digitos.slice(digitos.length - casas);
  const texto = casas > 0 ? `${parteInteira}.${parteDecimal}` : parteInteira;
  return negativo && arredondado !== 0n ? `-${texto}` : texto;
}
