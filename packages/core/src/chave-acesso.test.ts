import { describe, expect, it } from "vitest";
import {
  anoMesDaEmissao,
  calcularDvChaveAcesso,
  decomporChaveAcesso,
  gerarCodigoNumerico,
  montarChaveAcesso,
  validarChaveAcesso,
} from "./chave-acesso";
import { ErroFiscal } from "./erros";

// Chave gerada pelo emissor antigo (apis/mp-marketplace-oauth/scripts/nfce-teste/nfce-amb1.xml),
// que já emite em produção na SEFAZ-RS. TODO: trocar por chave de nota autorizada de verdade.
const CHAVE_REAL = "43261048618635000183650010000001581103289798";

describe("chave de acesso", () => {
  it("valida a chave do emissor antigo", () => {
    expect(validarChaveAcesso(CHAVE_REAL)).toBe(true);
    expect(validarChaveAcesso(`NFe${CHAVE_REAL}`)).toBe(true);
  });

  it("recusa chave com um dígito alterado", () => {
    expect(validarChaveAcesso(CHAVE_REAL.replace(/8$/, "7"))).toBe(false);
    expect(validarChaveAcesso(CHAVE_REAL.slice(0, 43))).toBe(false);
  });

  it("decompõe a chave real", () => {
    expect(decomporChaveAcesso(CHAVE_REAL)).toEqual({
      chave: CHAVE_REAL,
      uf: "RS",
      anoMes: "2610",
      documentoEmitente: "48618635000183",
      modelo: "65",
      serie: 1,
      numero: 158,
      tipoEmissao: 1,
      codigoNumerico: "10328979",
      digitoVerificador: 8,
    });
  });

  it("monta exatamente a mesma chave que o emissor antigo", () => {
    const chave = montarChaveAcesso({
      uf: "RS",
      anoMes: "2610",
      documentoEmitente: "48.618.635/0001-83",
      modelo: "65",
      serie: 1,
      numero: 158,
      tipoEmissao: 1,
      codigoNumerico: "10328979",
    });
    expect(chave).toBe(CHAVE_REAL);
  });

  it("monta chave com CPF de emitente (completa com zeros à esquerda)", () => {
    const chave = montarChaveAcesso({
      uf: "SP",
      anoMes: "2610",
      documentoEmitente: "529.982.247-25",
      modelo: "55",
      serie: 1,
      numero: 1,
      tipoEmissao: 1,
      codigoNumerico: "12345678",
    });
    expect(chave.slice(6, 20)).toBe("00052998224725");
    expect(validarChaveAcesso(chave)).toBe(true);
  });

  it("monta e valida chave com CNPJ alfanumérico", () => {
    const chave = montarChaveAcesso({
      uf: "RS",
      anoMes: "2610",
      documentoEmitente: "12.ABC.345/01DE-35",
      modelo: "55",
      serie: 1,
      numero: 1,
      tipoEmissao: 1,
      codigoNumerico: "12345678",
    });
    expect(chave.slice(6, 20)).toBe("12ABC34501DE35");
    expect(validarChaveAcesso(chave)).toBe(true);
    expect(decomporChaveAcesso(chave).documentoEmitente).toBe("12ABC34501DE35");
  });

  it("recusa campos fora da faixa", () => {
    const base = {
      uf: "RS",
      anoMes: "2610",
      documentoEmitente: "48618635000183",
      modelo: "65",
      serie: 1,
      numero: 1,
      tipoEmissao: 1,
      codigoNumerico: "12345678",
    } as const;
    expect(() => montarChaveAcesso({ ...base, serie: 1000 })).toThrow(ErroFiscal);
    expect(() => montarChaveAcesso({ ...base, numero: -1 })).toThrow(ErroFiscal);
    expect(() => montarChaveAcesso({ ...base, codigoNumerico: "123" })).toThrow(ErroFiscal);
    expect(() => montarChaveAcesso({ ...base, documentoEmitente: "123" })).toThrow(ErroFiscal);
  });

  it("DV vira 0 quando o resto é 0 ou 1", () => {
    expect(calcularDvChaveAcesso("0".repeat(43))).toBe(0);
  });

  it("extrai AAMM da data/hora de emissão", () => {
    expect(anoMesDaEmissao("2026-10-06T12:30:00-03:00")).toBe("2610");
    expect(() => anoMesDaEmissao("06/10/2026")).toThrow(ErroFiscal);
  });

  it("código numérico tem 8 dígitos e nunca é igual ao número da nota", () => {
    for (let i = 0; i < 200; i++) {
      const codigo = gerarCodigoNumerico(158);
      expect(codigo).toMatch(/^\d{8}$/);
      expect(Number(codigo)).not.toBe(158);
    }
  });
});
