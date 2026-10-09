import { describe, expect, it } from "vitest";
import { ErroFiscal } from "./erros";
import { codigoUf, ehUf, siglaUf } from "./uf";

describe("UF", () => {
  it("converte sigla ↔ código IBGE", () => {
    expect(codigoUf("RS")).toBe(43);
    expect(codigoUf("SP")).toBe(35);
    expect(siglaUf(53)).toBe("DF");
  });

  it("identifica sigla válida", () => {
    expect(ehUf("RS")).toBe(true);
    expect(ehUf("XX")).toBe(false);
    expect(ehUf("toString")).toBe(false);
  });

  it("recusa código desconhecido", () => {
    expect(() => siglaUf(99)).toThrow(ErroFiscal);
  });
});
