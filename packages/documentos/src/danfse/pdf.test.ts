import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { lerDanfse } from "./ler";
import { gerarDanfse } from "./pdf";

const xml = readFileSync(
  join(import.meta.dirname, "..", "..", "testes", "fixtures", "nfse-autorizada.xml"),
  "utf8",
);

/** Junta os textos desenhados no PDF (operadores TJ do PDFKit, em hex WinAnsi), sem compressão. */
function textosDoPdf(pdf: Buffer): string {
  const bruto = pdf.toString("latin1");
  return [...bruto.matchAll(/\[(.*?)\] TJ/g)]
    .map((m) =>
      [...(m[1] ?? "").matchAll(/<([0-9a-fA-F]+)>/g)]
        .map((h) => Buffer.from(h[1] ?? "", "hex").toString("latin1"))
        .join(""),
    )
    .join("\n");
}

describe("DANFSE", () => {
  it("lê a NFS-e real", () => {
    expect(lerDanfse(xml)).toMatchObject({
      chave: "43149022210440532000101000000000000126089303229430",
      nNFSe: "1",
      tpAmb: "2",
      prestador: { doc: "10440532000101", municipio: "Porto Alegre/RS", opSimpNac: "2" },
      tomador: { nome: "VISTO PRATICO LTDA", municipio: "Florianópolis/SC" },
      valores: { vServ: "40.00", vLiq: "40.00" },
    });
  });

  it("gera PDF de uma página com os dados e a tarja de homologação", async () => {
    const pdf = await gerarDanfse(xml, { comprimir: false });
    const bruto = pdf.toString("latin1");
    expect(bruto.startsWith("%PDF-")).toBe(true);
    expect(bruto.match(/\/Type \/Page\b/g)).toHaveLength(1);
    expect(bruto).toContain("DANFSe 1 - 43149022210440532000101000000000000126089303229430");
    const textos = textosDoPdf(pdf);
    for (const t of [
      "VISTO PRATICO LTDA",
      "R$ 40,00",
      "Optante - Microempreendedor Individual (MEI)",
      "SEM VALOR FISCAL",
      "10.440.532/0001-01",
      "Florianópolis/SC",
      "SERVIÇO PRESTADO",
    ]) {
      expect(textos).toContain(t);
    }
  });
});
