import { describe, expect, it } from "vitest";
import { formatarCpf, limparCpf, validarCpf } from "./cpf";

describe("CPF", () => {
  it("aceita CPF válido com ou sem pontuação", () => {
    expect(validarCpf("529.982.247-25")).toBe(true);
    expect(validarCpf("52998224725")).toBe(true);
  });

  it("recusa dígito verificador errado", () => {
    expect(validarCpf("529.982.247-26")).toBe(false);
  });

  it("recusa sequências repetidas e tamanho errado", () => {
    expect(validarCpf("111.111.111-11")).toBe(false);
    expect(validarCpf("5299822472")).toBe(false);
    expect(validarCpf("")).toBe(false);
  });

  it("limpa e formata", () => {
    expect(limparCpf("529.982.247-25")).toBe("52998224725");
    expect(formatarCpf("52998224725")).toBe("529.982.247-25");
  });
});
