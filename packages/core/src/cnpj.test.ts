import { describe, expect, it } from "vitest";
import { calcularDvCnpj, cnpjAlfanumerico, formatarCnpj, limparCnpj, validarCnpj } from "./cnpj";

describe("CNPJ numérico", () => {
  it("aceita CNPJ válido", () => {
    expect(validarCnpj("11.222.333/0001-81")).toBe(true);
    // Emitente da NFC-e real usada nos testes de chave de acesso
    expect(validarCnpj("48618635000183")).toBe(true);
  });

  it("recusa DV errado, repetidos e tamanho errado", () => {
    expect(validarCnpj("11.222.333/0001-82")).toBe(false);
    expect(validarCnpj("00000000000000")).toBe(false);
    expect(validarCnpj("1122233300018")).toBe(false);
  });
});

describe("CNPJ alfanumérico", () => {
  // Exemplo publicado pela Receita Federal
  it("aceita o exemplo oficial 12.ABC.345/01DE-35", () => {
    expect(calcularDvCnpj("12ABC34501DE")).toBe("35");
    expect(validarCnpj("12.ABC.345/01DE-35")).toBe(true);
    expect(validarCnpj("12.abc.345/01de-35")).toBe(true);
  });

  it("recusa letras nos dígitos verificadores", () => {
    expect(validarCnpj("12ABC34501DE3A")).toBe(false);
  });

  it("identifica, limpa e formata", () => {
    expect(cnpjAlfanumerico("12.ABC.345/01DE-35")).toBe(true);
    expect(cnpjAlfanumerico("11.222.333/0001-81")).toBe(false);
    expect(limparCnpj("12.abc.345/01de-35")).toBe("12ABC34501DE35");
    expect(formatarCnpj("12ABC34501DE35")).toBe("12.ABC.345/01DE-35");
  });
});
