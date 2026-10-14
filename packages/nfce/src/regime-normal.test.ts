import { readFileSync } from "node:fs";
import { join } from "node:path";
import { abrirCertificadoA1 } from "@fiscal/certificado";
import type { ErroFiscal } from "@fiscal/core";
import { assinarXml, validarContraXsd } from "@fiscal/xml";
import { describe, expect, it } from "vitest";
import { PASTA_FIXTURES, carregarFixturesAntigas } from "../testes/fixtures-antigas";
import { montarNfce } from "./montar";

const certificado = abrirCertificadoA1(
  readFileSync(join(PASTA_FIXTURES, "certificado-teste.pfx")),
  "senha-teste",
);
const balcao = carregarFixturesAntigas().find((f) => f.nome === "balcao-dinheiro-troco")!.entrada;

describe("NFC-e no regime normal (CRT 3)", () => {
  const entrada = () => {
    const e = structuredClone(balcao);
    e.emitente.crt = 3;
    e.venda.itens = [
      {
        ...e.venda.itens[0]!,
        quantidade: 1,
        valorUnitario: 100,
        tributacao: {
          icms: { cst: "00", aliquota: 17, aliquotaFcp: 2 },
          pis: { cst: "01", aliquota: 0.65 },
          cofins: { cst: "01", aliquota: 3 },
        },
      },
      {
        ...e.venda.itens[0]!,
        quantidade: 1,
        valorUnitario: 10,
        cest: "0300100",
        tributacao: { icms: { cst: "60" }, pis: { cst: "04" }, cofins: { cst: "04" } },
      },
    ];
    e.venda.desconto = 0;
    e.venda.pagamentos = [{ forma: "dinheiro", valor: 110 }];
    return e;
  };

  it("destaca ICMS, FCP, PIS e COFINS e soma no total; passa no XSD", async () => {
    const nota = montarNfce(entrada());
    expect(nota.valorTotal).toBe(110);
    expect(nota.xml).toContain(
      "<ICMS00><orig>0</orig><CST>00</CST><modBC>3</modBC><vBC>100.00</vBC><pICMS>17.0000</pICMS><vICMS>17.00</vICMS><pFCP>2.0000</pFCP><vFCP>2.00</vFCP></ICMS00>",
    );
    expect(nota.xml).toContain("<ICMS60><orig>0</orig><CST>60</CST></ICMS60>");
    // PIS/COFINS sem o ICMS na base: (100 − 17) × 0,65% e × 3%
    expect(nota.xml).toContain(
      "<vBC>100.00</vBC><vICMS>17.00</vICMS><vICMSDeson>0.00</vICMSDeson><vFCP>2.00</vFCP>",
    );
    expect(nota.xml).toContain("<vPIS>0.54</vPIS><vCOFINS>2.49</vCOFINS>");
    const assinado = assinarXml(nota.xml, { certificado, elemento: "infNFe", perfil: "sefaz" });
    expect(
      (await validarContraXsd(assinado, join(PASTA_FIXTURES, "xsd", "nfe_v4.00.xsd"))).erros,
    ).toEqual([]);
  });

  it("regime normal sem tributação do item é recusado", () => {
    const e = entrada();
    e.venda.itens = e.venda.itens.map(({ tributacao: _, ...it }) => it);
    try {
      montarNfce(e);
      throw new Error("deveria recusar");
    } catch (erro) {
      expect((erro as ErroFiscal).message).toContain("CRT 3");
    }
  });

  it("tributos aproximados e IBS/CBS no cupom; passa no XSD", async () => {
    const e = entrada();
    e.venda.itens = e.venda.itens.map((it) => ({
      ...it,
      tributacao: {
        ...it.tributacao!,
        ibsCbs: { cst: "000", classificacao: "000001" },
        tributosAproximados: { federal: 10, estadual: 17 },
      },
    }));
    const nota = montarNfce(e);
    expect(nota.xml).toContain("<IBSCBSTot>");
    expect(nota.xml).toContain("Trib aprox: R$ 11,00 Federal, R$ 18,70 Estadual");
    expect(nota.valorTotal).toBe(110);
    const assinado = assinarXml(nota.xml, { certificado, elemento: "infNFe", perfil: "sefaz" });
    expect(
      (await validarContraXsd(assinado, join(PASTA_FIXTURES, "xsd", "nfe_v4.00.xsd"))).erros,
    ).toEqual([]);
  });

  it("NFC-e não calcula ST na nota nem tem DIFAL", () => {
    const e = entrada();
    e.venda.itens = [
      {
        ...e.venda.itens[0]!,
        tributacao: { icms: { cst: "10", aliquota: 17, st: { mva: 40, aliquota: 17 } } },
      },
    ];
    expect(() => montarNfce(e)).toThrow("NFC-e não calcula ST");
  });
});
