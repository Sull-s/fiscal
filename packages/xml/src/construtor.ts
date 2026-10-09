import { escaparAtributo, escaparTexto, limparTexto } from "./texto";

type Atributos = Record<string, string | number | undefined>;

function atributos(attrs?: Atributos): string {
  if (!attrs) return "";
  return Object.entries(attrs)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => ` ${k}="${escaparAtributo(String(v))}"`)
    .join("");
}

const vazio = (v: unknown) => v === undefined || v === null || v === "";

/**
 * Elemento com valor já formatado (número, código, data). Valor vazio/nulo → o elemento some,
 * que é o que os schemas pedem para campos opcionais (tag vazia costuma ser rejeitada).
 *
 *   tag("nNF", 158) → <nNF>158</nNF>
 */
export function tag(
  nome: string,
  valor: string | number | undefined | null,
  attrs?: Atributos,
): string {
  if (vazio(valor)) return "";
  return `<${nome}${atributos(attrs)}>${escaparTexto(String(valor))}</${nome}>`;
}

/**
 * Elemento de texto livre: limpa (caracteres aceitos, espaços) e corta no tamanho máximo.
 *
 *   texto("xProd", "Pudim  “caseiro”", 120) → <xProd>Pudim "caseiro"</xProd>
 */
export function texto(nome: string, valor: unknown, maximo?: number): string {
  const s = limparTexto(valor, maximo);
  return s ? `<${nome}>${escaparTexto(s)}</${nome}>` : "";
}

/**
 * Grupo que só aparece se tiver conteúdo. As partes já são XML (resultado de tag/texto/grupo).
 *
 *   grupo("enderDest", tag("xLgr", rua), tag("nro", numero))
 */
export function grupo(nome: string, ...partes: (string | false | null | undefined)[]): string;
export function grupo(
  nome: string,
  attrs: Atributos,
  ...partes: (string | false | null | undefined)[]
): string;
export function grupo(nome: string, ...resto: unknown[]): string {
  const attrs =
    typeof resto[0] === "object" && resto[0] !== null ? (resto.shift() as Atributos) : undefined;
  const dentro = resto.filter((p): p is string => typeof p === "string" && p !== "").join("");
  return dentro ? `<${nome}${atributos(attrs)}>${dentro}</${nome}>` : "";
}
