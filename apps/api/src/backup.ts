import { copyFile, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface ResultadoBackup {
  copiados: number;
  verificados: number;
  hora: string;
}

/**
 * Copia para `destino` os arquivos de `origem` que são novos ou mudaram (tamanho ou data).
 * Nunca apaga nada no destino: nota guardada fica guardada mesmo se sumir do PC.
 * Pensado para uma pasta sincronizada com a nuvem (OneDrive, Google Drive).
 */
export async function espelharPasta(origem: string, destino: string): Promise<ResultadoBackup> {
  let copiados = 0;
  let verificados = 0;
  const percorrer = async (relativo: string): Promise<void> => {
    let entradas: import("node:fs").Dirent[];
    try {
      entradas = await readdir(join(origem, relativo), { withFileTypes: true });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
      throw e;
    }
    for (const entrada of entradas) {
      const caminho = join(relativo, entrada.name);
      if (entrada.isDirectory()) {
        await percorrer(caminho);
        continue;
      }
      if (!entrada.isFile() || entrada.name.endsWith(".tmp")) continue;
      verificados++;
      const de = join(origem, caminho);
      const para = join(destino, caminho);
      const [a, b] = await Promise.all([stat(de), stat(para).catch(() => null)]);
      if (b && b.size === a.size && b.mtimeMs >= a.mtimeMs) continue;
      await mkdir(dirname(para), { recursive: true });
      await copyFile(de, para);
      copiados++;
    }
  };
  await percorrer("");
  return { copiados, verificados, hora: new Date().toISOString() };
}

/**
 * Grava uma cópia datada (ex.: numeracao-2026-10-14.tar.gz) e mantém só as `manter` mais novas.
 * Os nomes ordenam por data, então as antigas são as primeiras.
 */
export async function gravarCopiaDiaria(
  pasta: string,
  prefixo: string,
  extensao: string,
  conteudo: Uint8Array,
  manter = 14,
  hoje = new Date(),
): Promise<string> {
  await mkdir(pasta, { recursive: true });
  const nome = `${prefixo}-${hoje.toISOString().slice(0, 10)}${extensao}`;
  await writeFile(join(pasta, nome), conteudo);
  const copias = (await readdir(pasta))
    .filter((n) => n.startsWith(`${prefixo}-`) && n.endsWith(extensao))
    .sort();
  for (const antiga of copias.slice(0, Math.max(0, copias.length - manter)))
    await rm(join(pasta, antiga), { force: true });
  return nome;
}
