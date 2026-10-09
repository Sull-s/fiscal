import { describe, expect, it } from "vitest";
import { buscarMunicipio, municipioExiste, nomeMunicipio } from "./municipios";

describe("municípios do IBGE", () => {
  it("busca pelo código", () => {
    expect(buscarMunicipio("4314902")).toEqual({
      codigo: "4314902",
      nome: "Porto Alegre",
      uf: "RS",
    });
    expect(buscarMunicipio("1100015")?.nome).toBe("Alta Floresta D'Oeste");
    expect(buscarMunicipio("9999999")).toBeUndefined();
  });

  it("existe e nome com fallback", () => {
    expect(municipioExiste("3550308")).toBe(true);
    expect(municipioExiste("toString")).toBe(false);
    expect(nomeMunicipio("3550308")).toBe("São Paulo/SP");
    expect(nomeMunicipio("1234567")).toBe("IBGE 1234567");
    expect(nomeMunicipio(undefined)).toBe("");
  });
});
