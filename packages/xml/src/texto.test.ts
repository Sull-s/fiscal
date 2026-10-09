import { describe, expect, it } from "vitest";
import { grupo, tag, texto } from "./construtor";
import {
  escaparAtributo,
  escaparTexto,
  formatarDecimal,
  limparTexto,
  somenteDigitos,
} from "./texto";

describe("limparTexto", () => {
  it("troca aspas e travessões tipográficos e junta espaços", () => {
    expect(limparTexto("  Pudim   “caseiro” – ‘top’  ")).toBe(`Pudim "caseiro" - 'top'`);
  });

  it("remove caracteres fora do aceito pela SEFAZ (emoji etc.)", () => {
    expect(limparTexto("Pudim 🍮 de leite")).toBe("Pudim de leite");
    expect(limparTexto("Açaí com maçã")).toBe("Açaí com maçã");
  });

  it("corta no tamanho máximo sem deixar espaço no fim", () => {
    expect(limparTexto("abc def", 4)).toBe("abc");
  });

  it("nulo e indefinido viram vazio", () => {
    expect(limparTexto(null)).toBe("");
    expect(limparTexto(undefined)).toBe("");
  });
});

describe("escapes e dígitos", () => {
  it("escapa texto e atributo", () => {
    expect(escaparTexto(`a & b < c > "d"`)).toBe('a &amp; b &lt; c &gt; "d"');
    expect(escaparAtributo('a & "b" <c>')).toBe("a &amp; &quot;b&quot; &lt;c>");
  });

  it("extrai só dígitos", () => {
    expect(somenteDigitos("91450-510")).toBe("91450510");
    expect(somenteDigitos(undefined)).toBe("");
  });
});

describe("formatarDecimal", () => {
  it("arredonda metade para cima sem erro de ponto flutuante", () => {
    expect(formatarDecimal(1.005)).toBe("1.01");
    expect(formatarDecimal(1.004)).toBe("1.00");
    expect(formatarDecimal(0.1 + 0.2)).toBe("0.30");
    expect(formatarDecimal(2.675)).toBe("2.68");
  });

  it("respeita as casas pedidas (quantidade e valor unitário usam 4 a 10)", () => {
    expect(formatarDecimal(28, 2)).toBe("28.00");
    expect(formatarDecimal(1.5, 4)).toBe("1.5000");
    expect(formatarDecimal(12.3456789, 10)).toBe("12.3456789000");
    expect(formatarDecimal(7.6, 0)).toBe("8");
  });

  it("aceita string com vírgula e valores negativos", () => {
    expect(formatarDecimal("10,5")).toBe("10.50");
    expect(formatarDecimal(-4.805)).toBe("-4.81");
    expect(formatarDecimal(-0.001)).toBe("0.00");
  });

  it("recusa valor não numérico", () => {
    expect(() => formatarDecimal("abc")).toThrow(RangeError);
  });
});

describe("construtor de XML", () => {
  it("tag: valor vazio faz o elemento sumir", () => {
    expect(tag("nNF", 158)).toBe("<nNF>158</nNF>");
    expect(tag("xCpl", "")).toBe("");
    expect(tag("xCpl", undefined)).toBe("");
    expect(tag("qrCode", "a&b")).toBe("<qrCode>a&amp;b</qrCode>");
  });

  it("texto: limpa, escapa e corta", () => {
    expect(texto("xProd", "Pudim  de leite & calda", 15)).toBe("<xProd>Pudim de leite</xProd>");
    expect(texto("xProd", "   ")).toBe("");
  });

  it("grupo: só aparece com conteúdo e aceita atributos", () => {
    expect(grupo("enderDest", tag("xLgr", "Rua A"), tag("nro", ""))).toBe(
      "<enderDest><xLgr>Rua A</xLgr></enderDest>",
    );
    expect(grupo("enderDest", tag("xLgr", ""), false, null)).toBe("");
    expect(grupo("detEvento", { versao: "1.00" }, tag("descEvento", "Cancelamento"))).toBe(
      '<detEvento versao="1.00"><descEvento>Cancelamento</descEvento></detEvento>',
    );
  });
});
