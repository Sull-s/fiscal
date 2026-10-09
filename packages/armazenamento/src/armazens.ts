import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { ErroFiscal } from "@fiscal/core";

/**
 * Onde os arquivos ficam. Implementações: disco, memória, ou `armazemFuncoes` para qualquer
 * storage (Vercel Blob, S3, R2, Google Cloud Storage…).
 * Não há "apagar" de propósito: documento fiscal tem guarda obrigatória de 5 anos.
 */
export interface ArmazemArquivos {
  gravar(caminho: string, conteudo: Uint8Array, tipo: string): Promise<void>;
  /** null se não existir */
  ler(caminho: string): Promise<Uint8Array | null>;
  /** Caminhos que começam com o prefixo, em ordem alfabética */
  listar(prefixo: string): Promise<string[]>;
}

/** Recusa caminhos que tentem sair da pasta (../) ou sejam absolutos. */
export function validarCaminho(caminho: string): string {
  const limpo = caminho.replace(/\\/g, "/");
  if (
    !limpo ||
    limpo.startsWith("/") ||
    /^[a-z]:/i.test(limpo) ||
    limpo.split("/").some((p) => p === ".." || p === "")
  ) {
    throw new ErroFiscal("CAMINHO_INVALIDO", `Caminho de arquivo inválido: ${caminho}`);
  }
  return limpo;
}

export function armazemArquivosEmMemoria(): ArmazemArquivos & {
  arquivos: Map<string, Uint8Array>;
} {
  const arquivos = new Map<string, Uint8Array>();
  return {
    arquivos,
    async gravar(caminho, conteudo) {
      arquivos.set(validarCaminho(caminho), new Uint8Array(conteudo));
    },
    async ler(caminho) {
      return arquivos.get(validarCaminho(caminho)) ?? null;
    },
    async listar(prefixo) {
      return [...arquivos.keys()].filter((c) => c.startsWith(prefixo)).sort();
    },
  };
}

/**
 * Pasta local. A gravação é atômica (arquivo temporário + rename): uma queda de energia no meio
 * nunca deixa um XML pela metade.
 */
export function armazemDisco(pasta: string): ArmazemArquivos {
  const raiz = resolve(pasta);
  const absoluto = (caminho: string) => join(raiz, ...validarCaminho(caminho).split("/"));

  async function percorrer(dir: string): Promise<string[]> {
    let entradas: import("node:fs").Dirent[];
    try {
      entradas = await readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    const filhos = await Promise.all(
      entradas.map((e) =>
        e.isDirectory() ? percorrer(join(dir, e.name)) : Promise.resolve([join(dir, e.name)]),
      ),
    );
    return filhos.flat();
  }

  return {
    async gravar(caminho, conteudo) {
      const destino = absoluto(caminho);
      await mkdir(dirname(destino), { recursive: true });
      const temporario = `${destino}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(temporario, conteudo);
      await rename(temporario, destino);
    },
    async ler(caminho) {
      try {
        return new Uint8Array(await readFile(absoluto(caminho)));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw e;
      }
    },
    async listar(prefixo) {
      const base = prefixo.includes("/") ? prefixo.slice(0, prefixo.lastIndexOf("/")) : "";
      const inicio = base ? absoluto(base) : raiz;
      return (await percorrer(inicio))
        .filter((a) => !a.endsWith(".tmp"))
        .map((a) => relative(raiz, a).split(sep).join("/"))
        .filter((c) => c.startsWith(prefixo))
        .sort();
    },
  };
}

/**
 * Adaptador para qualquer storage a partir de três funções. Exemplo com Vercel Blob:
 *
 *   import { put, list, head } from "@vercel/blob";
 *   armazemFuncoes({
 *     gravar: (c, d, tipo) => put(c, Buffer.from(d), { access: "public", contentType: tipo, addRandomSuffix: false, allowOverwrite: true }),
 *     ler: async (c) => { const b = await head(c).catch(() => null); return b ? new Uint8Array(await (await fetch(b.url)).arrayBuffer()) : null; },
 *     listar: async (p) => (await list({ prefix: p })).blobs.map((b) => b.pathname),
 *   });
 */
export function armazemFuncoes(funcoes: {
  gravar: (caminho: string, conteudo: Uint8Array, tipo: string) => Promise<unknown>;
  ler: (caminho: string) => Promise<Uint8Array | null>;
  listar: (prefixo: string) => Promise<string[]>;
}): ArmazemArquivos {
  return {
    gravar: async (c, d, t) => {
      await funcoes.gravar(validarCaminho(c), d, t);
    },
    ler: async (c) => funcoes.ler(validarCaminho(c)),
    listar: async (p) => (await funcoes.listar(p)).sort(),
  };
}
