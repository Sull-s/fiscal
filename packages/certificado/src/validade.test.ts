import { ErroFiscal } from "@fiscal/core";
import { describe, expect, it } from "vitest";
import {
  certificadoServeParaEmitente,
  exigirCertificadoValido,
  situacaoCertificado,
} from "./validade";

const cert = {
  validoDe: new Date("2026-01-01T00:00:00Z"),
  validoAte: new Date("2027-01-01T00:00:00Z"),
};
const em = (iso: string) => new Date(iso);

describe("situacaoCertificado", () => {
  it("classifica pelo tempo restante", () => {
    expect(situacaoCertificado(cert, em("2026-06-01T00:00:00Z")).situacao).toBe("valido");
    expect(situacaoCertificado(cert, em("2026-12-10T00:00:00Z"))).toEqual({
      situacao: "vencendo",
      diasRestantes: 22,
    });
    expect(situacaoCertificado(cert, em("2026-12-28T00:00:00Z")).situacao).toBe("critico");
    expect(situacaoCertificado(cert, em("2027-01-02T00:00:00Z")).situacao).toBe("expirado");
    expect(situacaoCertificado(cert, em("2025-12-31T00:00:00Z")).situacao).toBe("ainda-nao-valido");
  });

  it("aceita limites personalizados", () => {
    const r = situacaoCertificado(cert, em("2026-11-20T00:00:00Z"), { vencendo: 60, critico: 15 });
    expect(r.situacao).toBe("vencendo");
  });
});

describe("exigirCertificadoValido", () => {
  it("passa quando está na validade", () => {
    expect(() => exigirCertificadoValido(cert, em("2026-06-01T00:00:00Z"))).not.toThrow();
  });

  it("recusa vencido e ainda não válido (relógio errado)", () => {
    expect(() => exigirCertificadoValido(cert, em("2027-02-01T00:00:00Z"))).toThrow(ErroFiscal);
    expect(() => exigirCertificadoValido(cert, em("2025-06-01T00:00:00Z"))).toThrow(/relógio/);
  });
});

describe("certificadoServeParaEmitente", () => {
  const matriz = { documento: "48618635000183" };

  it("aceita o mesmo CNPJ e filiais (mesma raiz)", () => {
    expect(certificadoServeParaEmitente(matriz, "48.618.635/0001-83")).toBe(true);
    expect(certificadoServeParaEmitente(matriz, "48618635000264")).toBe(true);
  });

  it("recusa outra empresa e certificado sem documento", () => {
    expect(certificadoServeParaEmitente(matriz, "11222333000181")).toBe(false);
    expect(certificadoServeParaEmitente({ documento: "" }, "48618635000183")).toBe(false);
  });

  it("e-CPF só serve para o mesmo CPF", () => {
    expect(certificadoServeParaEmitente({ documento: "52998224725" }, "529.982.247-25")).toBe(true);
    expect(certificadoServeParaEmitente({ documento: "52998224725" }, "48618635000183")).toBe(
      false,
    );
  });
});
