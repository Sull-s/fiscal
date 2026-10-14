import { describe, expect, it } from "vitest";
import { gerarRelatorioNotas, resumirNotas } from "./pdf";

const textos = (pdf: Buffer) =>
  [...pdf.toString("latin1").matchAll(/\[(.*?)\] TJ/g)]
    .map((m) =>
      [...(m[1] ?? "").matchAll(/<([0-9a-fA-F]+)>/g)]
        .map((h) => Buffer.from(h[1] ?? "", "hex").toString("latin1"))
        .join(""),
    )
    .join("\n");

const notas = [
  {
    modelo: "65",
    serie: "1",
    numero: 2,
    dataEmissao: "2026-10-02T12:00:00-03:00",
    chave: "4326",
    situacao: "autorizada",
    valor: 30.1,
  },
  {
    modelo: "65",
    serie: "1",
    numero: 1,
    dataEmissao: "2026-10-01T12:00:00-03:00",
    chave: "4326",
    situacao: "autorizada",
    valor: 20.2,
  },
  {
    modelo: "65",
    serie: "1",
    numero: 3,
    dataEmissao: "2026-10-03T12:00:00-03:00",
    situacao: "cancelada",
    valor: 10,
  },
  {
    modelo: "55",
    serie: "1",
    numero: 7,
    dataEmissao: "2026-10-05T12:00:00-03:00",
    situacao: "autorizada",
    valor: 1500,
  },
];

describe("relatório do contador", () => {
  it("resume por modelo e situação; faturamento só com autorizadas", () => {
    const r = resumirNotas(notas);
    expect(r.faturamento).toBe(1550.3);
    expect(r.grupos).toEqual([
      { modelo: "55", situacao: "autorizada", quantidade: 1, valor: 1500 },
      { modelo: "65", situacao: "autorizada", quantidade: 2, valor: 50.3 },
      { modelo: "65", situacao: "cancelada", quantidade: 1, valor: 10 },
    ]);
  });

  it("gera o PDF com título, resumo e lista; muitas notas viram várias páginas", async () => {
    const pdf = await gerarRelatorioNotas(
      {
        empresa: { nome: "Comida Caseira", cnpj: "48618635000183" },
        periodo: "2026-10",
        ambiente: 1,
        notas,
      },
      { comprimir: false },
    );
    const t = textos(pdf);
    for (const s of [
      "Notas fiscais de outubro de 2026",
      "48.618.635/0001-83",
      "Total autorizado: R$ 1.550,30",
      "Cancelada",
      "NF-e",
      "NFC-e",
    ]) {
      expect(t).toContain(s);
    }
    const muitas = Array.from({ length: 150 }, (_, i) => ({ ...notas[0]!, numero: i + 1 }));
    const grande = await gerarRelatorioNotas(
      {
        empresa: { nome: "X", cnpj: "48618635000183" },
        periodo: "2026-10",
        ambiente: 2,
        notas: muitas,
      },
      { comprimir: false },
    );
    expect(grande.toString("latin1").match(/\/Type \/Page\b/g)?.length).toBeGreaterThan(2);
    expect(textos(grande)).toContain("HOMOLOGAÇÃO");
  });
});
