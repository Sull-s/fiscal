import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { espelharPasta, gravarCopiaDiaria } from "./backup";

const raiz = mkdtempSync(join(tmpdir(), "fiscal-backup-"));
afterAll(() => rmSync(raiz, { recursive: true, force: true }));

describe("backup do agente local", () => {
  it("copia só o que é novo ou mudou e nunca apaga no destino", async () => {
    const origem = join(raiz, "origem");
    const destino = join(raiz, "destino");
    mkdirSync(join(origem, "nfce", "2026-10"), { recursive: true });
    writeFileSync(join(origem, "nfce", "2026-10", "a.xml"), "<a/>");
    writeFileSync(join(origem, "nfce", "2026-10", "b.xml"), "<b/>");
    writeFileSync(join(origem, "nfce", "2026-10", "c.xml.123.tmp"), "pela metade");

    expect(await espelharPasta(origem, destino)).toMatchObject({ copiados: 2, verificados: 2 });
    expect(await espelharPasta(origem, destino)).toMatchObject({ copiados: 0, verificados: 2 });

    writeFileSync(join(origem, "nfce", "2026-10", "b.xml"), "<b>mudou</b>");
    rmSync(join(origem, "nfce", "2026-10", "a.xml"));
    expect(await espelharPasta(origem, destino)).toMatchObject({ copiados: 1, verificados: 1 });
    expect(readFileSync(join(destino, "nfce", "2026-10", "b.xml"), "utf8")).toBe("<b>mudou</b>");
    // Apagado no PC continua guardado no backup
    expect(readFileSync(join(destino, "nfce", "2026-10", "a.xml"), "utf8")).toBe("<a/>");
    expect(readdirSync(join(destino, "nfce", "2026-10"))).not.toContain("c.xml.123.tmp");
  });

  it("pasta de origem que ainda não existe não é erro", async () => {
    expect(await espelharPasta(join(raiz, "nao-existe"), join(raiz, "x"))).toMatchObject({
      copiados: 0,
    });
  });

  it("guarda uma cópia por dia e mantém só as mais novas", async () => {
    const pasta = join(raiz, "numeracao");
    for (let dia = 1; dia <= 5; dia++) {
      await gravarCopiaDiaria(
        pasta,
        "numeracao",
        ".tar.gz",
        new Uint8Array([dia]),
        3,
        new Date(`2026-10-0${dia}T12:00:00Z`),
      );
    }
    expect(readdirSync(pasta)).toEqual([
      "numeracao-2026-10-03.tar.gz",
      "numeracao-2026-10-04.tar.gz",
      "numeracao-2026-10-05.tar.gz",
    ]);
  });
});
