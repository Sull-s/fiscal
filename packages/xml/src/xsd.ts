import { readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { validateXML } from "xmllint-wasm";

export interface ErroXsd {
  linha: number | null;
  mensagem: string;
}

export interface ResultadoXsd {
  valido: boolean;
  erros: ErroXsd[];
}

/** Lê o XSD principal e todos os que ele importa/inclui (recursivamente, na mesma pasta). */
function carregarEsquemas(caminhoPrincipal: string) {
  const pasta = dirname(caminhoPrincipal);
  const arquivos = new Map<string, string>();
  const pendentes = [basename(caminhoPrincipal)];

  while (pendentes.length > 0) {
    const nome = pendentes.pop() as string;
    if (arquivos.has(nome)) continue;
    const conteudo = readFileSync(join(pasta, nome), "utf8");
    arquivos.set(nome, conteudo);
    for (const m of conteudo.matchAll(/<xs:(?:include|import)\b[^>]*schemaLocation="([^"]+)"/g)) {
      const local = m[1];
      if (local && !/^https?:/.test(local)) pendentes.push(basename(local));
    }
  }
  return arquivos;
}

/**
 * Valida o XML contra o XSD oficial (libxml2 em WebAssembly: não precisa instalar nada).
 * Rode antes de enviar: a maioria das rejeições de schema da SEFAZ (225, 215…) aparece aqui,
 * com a linha e o campo exatos.
 */
export async function validarContraXsd(xml: string, caminhoXsd: string): Promise<ResultadoXsd> {
  const esquemas = carregarEsquemas(caminhoXsd);
  const principal = basename(caminhoXsd);

  const resultado = await validateXML({
    xml: { fileName: "documento.xml", contents: xml },
    schema: { fileName: principal, contents: esquemas.get(principal) as string },
    preload: [...esquemas]
      .filter(([nome]) => nome !== principal)
      .map(([fileName, contents]) => ({ fileName, contents })),
  });

  return {
    valido: resultado.valid,
    erros: resultado.errors.map((e) => ({
      linha: e.loc?.lineNumber ?? null,
      mensagem: e.message.replace(/^.*?:\d+: /, "").trim(),
    })),
  };
}
