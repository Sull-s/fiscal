import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ErroFiscal } from "@fiscal/core";
import { montarCancelamento, montarInutilizacao } from "@fiscal/nfe-comum";
import { describe, expect, it } from "vitest";
import { PASTA_FIXTURES } from "../testes/fixtures-antigas";

const antigo = (nome: string) => readFileSync(join(PASTA_FIXTURES, "antigo", nome), "utf8");

describe("montarCancelamento", () => {
  it("idêntico ao emissor em produção", () => {
    const { xml, id } = montarCancelamento({
      chave: "43261048618635000183650010000001581033577544",
      protocolo: "143260000000001",
      justificativa: "Pedido cancelado pelo cliente antes da entrega",
      documentoEmitente: "48.618.635/0001-83",
      ambiente: 2,
      dataEvento: new Date("2026-10-09T16:13:50Z"),
    });
    expect(xml).toBe(antigo("evento-cancelamento.xml"));
    expect(id).toBe("ID1101114326104861863500018365001000000158103357754401");
  });

  it("justificativa curta, chave inválida e nota sem protocolo são recusadas", () => {
    const base = {
      chave: "43261048618635000183650010000001581033577544",
      protocolo: "143260000000001",
      justificativa: "Pedido cancelado pelo cliente",
      documentoEmitente: "48618635000183",
      ambiente: 2 as const,
    };
    expect(() => montarCancelamento({ ...base, justificativa: "  erro   " })).toThrow(
      /15 caracteres/,
    );
    expect(() => montarCancelamento({ ...base, chave: base.chave.replace(/4$/, "5") })).toThrow(
      ErroFiscal,
    );
    expect(() => montarCancelamento({ ...base, protocolo: "" })).toThrow(/protocolo/);
  });

  it("emitente pessoa física usa a tag CPF", () => {
    const { xml } = montarCancelamento({
      chave: "43261048618635000183650010000001581033577544",
      protocolo: "143260000000001",
      justificativa: "Pedido cancelado pelo cliente",
      documentoEmitente: "529.982.247-25",
      ambiente: 2,
    });
    expect(xml).toContain("<CPF>52998224725</CPF>");
  });
});

describe("montarInutilizacao", () => {
  it("idêntica ao emissor em produção", () => {
    const { xml, id } = montarInutilizacao({
      uf: "RS",
      cnpj: "48618635000183",
      ambiente: 1,
      serie: 1,
      inicio: 1,
      fim: 1,
      ano: 2026,
      justificativa: "Numero nao utilizado por falha na transmissao da nota",
    });
    expect(xml).toBe(antigo("inutilizacao.xml"));
    expect(id).toHaveLength(43);
  });

  it("faixa invertida é recusada", () => {
    expect(() =>
      montarInutilizacao({
        uf: "RS",
        cnpj: "48618635000183",
        ambiente: 2,
        serie: 1,
        inicio: 5,
        fim: 4,
        justificativa: "Numeros pulados por falha",
      }),
    ).toThrow(/Faixa/);
  });
});
