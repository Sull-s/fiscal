import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PADROES_CODE128, modulosCode128C } from "./code128";
import { lerDanfe } from "./ler";
import { gerarDanfe } from "./pdf";

const xml = readFileSync(
  join(import.meta.dirname, "..", "..", "testes", "fixtures", "nfe-autorizada.xml"),
  "utf8",
);
const CHAVE = "43261048618635000183550010000012341876543218";

/** Textos desenhados no PDF sem compressão (operadores TJ do PDFKit, em hex WinAnsi). */
function textosDoPdf(pdf: Buffer): string {
  return [...pdf.toString("latin1").matchAll(/\[(.*?)\] TJ/g)]
    .map((m) =>
      [...(m[1] ?? "").matchAll(/<([0-9a-fA-F]+)>/g)]
        .map((h) => Buffer.from(h[1] ?? "", "hex").toString("latin1"))
        .join(""),
    )
    .join("\n");
}
const paginas = (pdf: Buffer) => pdf.toString("latin1").match(/\/Type \/Page\b/g)?.length ?? 0;

describe("Code 128C da chave de acesso", () => {
  it("tabela: 107 símbolos distintos de 11 módulos (stop com 13)", () => {
    expect(PADROES_CODE128).toHaveLength(107);
    expect(new Set(PADROES_CODE128).size).toBe(107);
    for (const [i, p] of PADROES_CODE128.entries()) {
      const soma = [...p].reduce((s, c) => s + Number(c), 0);
      expect(soma).toBe(i === 106 ? 13 : 11);
    }
  });

  it("igual ao JsBarcode (biblioteca de referência) para chaves reais", () => {
    const require = createRequire(import.meta.url);
    const Code128C = require("jsbarcode/bin/barcodes/CODE128/CODE128C.js").default;
    for (const chave of [CHAVE, "43261048618635000183650010000001581033577544", "0".repeat(44)]) {
      expect(modulosCode128C(chave)).toBe(new Code128C(chave, {}).encode().data);
    }
  });
});

describe("DANFE A4", () => {
  it("lê a NF-e", () => {
    const d = lerDanfe(xml);
    expect(d).toMatchObject({
      chave: CHAVE,
      numero: "1234",
      tipo: "1",
      crt: "3",
      destinatario: { nome: expect.stringContaining("HOMOLOGACAO"), uf: "SC" },
      protocolo: { numero: "143260000004321" },
      // ICMS: (1000 + 50 de frete + 600 + 30 de frete) × 12% = 201,60
      totais: { vNF: "1732.50", vIPI: "52.50", vICMS: "201.60" },
    });
    expect(d.itens[0]).toMatchObject({ cst: "000", cfop: "6101", bcIcms: "1050.00" });
    expect(d.duplicatas).toHaveLength(2);
  });

  it("gera uma folha com canhoto, chave, protocolo, impostos, duplicatas e tarja", async () => {
    const pdf = await gerarDanfe(xml, { comprimir: false });
    expect(pdf.toString("latin1").startsWith("%PDF-")).toBe(true);
    expect(paginas(pdf)).toBe(1);
    const textos = textosDoPdf(pdf);
    for (const t of [
      "RECEBEMOS DE EMPRESA TESTE MOVEIS LTDA",
      "DANFE",
      "4326 1048 6186 3500 0183 5500 1000 0012 3418 7654 3218",
      "143260000004321 - 12/10/2026 10:00:05",
      "Nº 000.001.234",
      "FOLHA 1/1",
      "1.732,50",
      "52,50",
      "866,25",
      "Cadeira de escritorio",
      "Cor preta",
      "O/CST",
      "0-Remetente (CIF)",
      "Pedido PC-778",
      "SEM VALOR FISCAL",
    ]) {
      expect(textos).toContain(t);
    }
  });

  it("muitos itens: continua nas folhas seguintes com o cabeçalho repetido", async () => {
    const det = /<det nItem="1">[\s\S]*?<\/det>/.exec(xml)?.[0] ?? "";
    const muitos = xml.replace(det, det.repeat(60));
    const pdf = await gerarDanfe(muitos, { comprimir: false });
    const total = paginas(pdf);
    expect(total).toBeGreaterThan(1);
    const textos = textosDoPdf(pdf);
    expect(textos).toContain(`FOLHA ${total}/${total}`);
    expect(textos.match(/Cor preta/g)).toHaveLength(60);
    expect(textos.match(/RECEBEMOS DE/g)).toHaveLength(1);
  });

  it("tarja CANCELADA quando informada", async () => {
    const textos = textosDoPdf(await gerarDanfe(xml, { comprimir: false, cancelada: true }));
    expect(textos).toContain("CANCELADA");
  });
});
