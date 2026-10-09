/**
 * Cupom térmico descrito como uma lista de linhas, sem saber onde vai ser impresso.
 * Os renderizadores (ESC/POS, texto, HTML) transformam a mesma lista em cada saída.
 */
export type Alinhamento = "esquerda" | "centro" | "direita";

export type LinhaTermica =
  | { tipo: "texto"; texto: string; alinhar?: Alinhamento; negrito?: boolean; grande?: boolean }
  /** Texto à esquerda e valor à direita na mesma linha ("Valor total R$ ........ 48,20") */
  | { tipo: "colunas"; esquerda: string; direita: string; negrito?: boolean; grande?: boolean }
  | { tipo: "separador" }
  /** Destaque invertido (fundo preto), ex.: NOTA CANCELADA */
  | { tipo: "faixa"; texto: string }
  | { tipo: "qrcode"; conteudo: string }
  | { tipo: "espaco" };

export const texto = (
  t: string,
  opcoes: Omit<Extract<LinhaTermica, { tipo: "texto" }>, "tipo" | "texto"> = {},
): LinhaTermica => ({ tipo: "texto", texto: t, ...opcoes });

export const colunas = (
  esquerda: string,
  direita: string,
  opcoes: { negrito?: boolean; grande?: boolean } = {},
): LinhaTermica => ({ tipo: "colunas", esquerda, direita, ...opcoes });

export const separador: LinhaTermica = { tipo: "separador" };
export const espaco: LinhaTermica = { tipo: "espaco" };

/** Quebra o texto em linhas de até `largura` caracteres, sem cortar palavras quando possível. */
export function quebrarTexto(t: string, largura: number): string[] {
  const linhas: string[] = [];
  for (const paragrafo of t.split("\n")) {
    let atual = "";
    for (let palavra of paragrafo.split(/\s+/).filter(Boolean)) {
      // Palavra maior que a linha (URL, chave): quebra no meio
      while (palavra.length > largura) {
        if (atual) linhas.push(atual);
        atual = "";
        linhas.push(palavra.slice(0, largura));
        palavra = palavra.slice(largura);
      }
      if (!palavra) continue;
      if (!atual) atual = palavra;
      else if (atual.length + 1 + palavra.length <= largura) atual += ` ${palavra}`;
      else {
        linhas.push(atual);
        atual = palavra;
      }
    }
    linhas.push(atual);
  }
  return linhas;
}

/** Monta "esquerda ..... direita" em `largura` colunas (a esquerda quebra se não couber). */
export function alinharColunas(esquerda: string, direita: string, largura: number): string[] {
  const espacoEsquerda = largura - direita.length - 1;
  const partes = quebrarTexto(esquerda, Math.max(espacoEsquerda, 1));
  const ultima = partes.pop() ?? "";
  return [...partes, ultima.padEnd(largura - direita.length, " ") + direita];
}

export function alinhar(t: string, largura: number, como: Alinhamento = "esquerda"): string {
  if (como === "direita") return t.padStart(largura, " ");
  if (como === "centro") {
    const sobra = Math.max(largura - t.length, 0);
    return " ".repeat(Math.floor(sobra / 2)) + t;
  }
  return t;
}
