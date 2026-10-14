import { readFileSync } from "node:fs";
import { join } from "node:path";
import { abrirCertificadoA1 } from "@fiscal/certificado";
import { montarChaveAcesso } from "@fiscal/core";
import { assinarXml, validarContraXsd } from "@fiscal/xml";
import { describe, expect, it } from "vitest";
import { chaveDe, clienteFalso } from "../testes/sefaz-falsa";
import { CONDICAO_USO_CCE, montarCartaCorrecao } from "./eventos";
import {
  aplicarAliquota,
  calcularImpostos,
  problemasTributacao,
  textoCreditoSimples,
} from "./impostos";
import { enviarCartaCorrecao } from "./sefaz";

const FIXTURES = join(import.meta.dirname, "..", "testes", "fixtures");
const xsd = (nome: string) => join(FIXTURES, "xsd", nome);
const certificado = abrirCertificadoA1(
  readFileSync(join(FIXTURES, "certificado-teste.pfx")),
  "senha-teste",
);

describe("aplicarAliquota", () => {
  it("arredonda metade para cima, sem erro de ponto flutuante", () => {
    expect(aplicarAliquota(10_000, 18)).toBe(1_800);
    expect(aplicarAliquota(50, 1)).toBe(1); // 0,005 → 0,01
    expect(aplicarAliquota(49, 1)).toBe(0); // 0,0049 → 0,00
    expect(aplicarAliquota(8_200, 1.65)).toBe(135); // 1,353
    expect(aplicarAliquota(100_000, 66.67)).toBe(66_670);
  });
});

describe("calcularImpostos", () => {
  const cem = { produto: 10_000 };

  it("CST 00: ICMS sobre o valor da operação, com FCP", () => {
    const r = calcularImpostos(
      { icms: { cst: "00", aliquota: 18, aliquotaFcp: 2 } },
      { produto: 12_000, desconto: 2_000 },
      { consumidorFinal: false },
    );
    expect(r).toMatchObject({ vBC: 10_000, vICMS: 1_800, vFCP: 200 });
    expect(r.xml).toBe(
      "<ICMS><ICMS00><orig>0</orig><CST>00</CST><modBC>3</modBC><vBC>100.00</vBC><pICMS>18.0000</pICMS><vICMS>18.00</vICMS><pFCP>2.0000</pFCP><vFCP>2.00</vFCP></ICMS00></ICMS>",
    );
  });

  it("CST 20: base reduzida", () => {
    const r = calcularImpostos(
      { icms: { cst: "20", aliquota: 12, reducaoBase: 33.33 } },
      { produto: 100_000 },
      { consumidorFinal: false },
    );
    expect(r).toMatchObject({ vBC: 66_670, vICMS: 8_000 });
    expect(r.xml).toContain("<pRedBC>33.3300</pRedBC><vBC>666.70</vBC>");
  });

  it("IPI entra na base do ICMS só para consumidor final", () => {
    const trib = {
      icms: { cst: "00" as const, aliquota: 18 },
      ipi: { cst: "50" as const, aliquota: 10 },
    };
    expect(calcularImpostos(trib, cem, { consumidorFinal: true })).toMatchObject({
      vIPI: 1_000,
      vBC: 11_000,
      vICMS: 1_980,
    });
    const revenda = calcularImpostos(trib, cem, { consumidorFinal: false });
    expect(revenda).toMatchObject({ vIPI: 1_000, vBC: 10_000, vICMS: 1_800 });
    expect(revenda.xml).toContain(
      "<IPI><cEnq>999</cEnq><IPITrib><CST>50</CST><vBC>100.00</vBC><pIPI>10.0000</pIPI><vIPI>10.00</vIPI></IPITrib></IPI>",
    );
  });

  it("PIS/COFINS sem o ICMS na base (Lei 14.592/2023), salvo pedido em contrário", () => {
    const trib = {
      icms: { cst: "00" as const, aliquota: 18 },
      pis: { cst: "01" as const, aliquota: 1.65 },
      cofins: { cst: "01" as const, aliquota: 7.6 },
    };
    expect(calcularImpostos(trib, cem, { consumidorFinal: false })).toMatchObject({
      vPIS: 135,
      vCOFINS: 623,
    });
    expect(
      calcularImpostos(trib, cem, { consumidorFinal: false, icmsNaBasePisCofins: true }),
    ).toMatchObject({ vPIS: 165, vCOFINS: 760 });
  });

  it("Simples: CSOSN 101 calcula o crédito e o texto obrigatório", () => {
    const r = calcularImpostos(
      { origem: 2, icms: { csosn: "101", aliquotaCredito: 2.56 } },
      { produto: 20_000 },
      { consumidorFinal: false },
    );
    expect(r.vCredICMSSN).toBe(512);
    expect(r.xml).toBe(
      "<ICMS><ICMSSN101><orig>2</orig><CSOSN>101</CSOSN><pCredSN>2.5600</pCredSN><vCredICMSSN>5.12</vCredICMSSN></ICMSSN101></ICMS>",
    );
    expect(textoCreditoSimples(512, 2.56)).toContain("R$ 5,12; CORRESPONDENTE A ALIQUOTA DE 2,56%");
  });

  it("aponta regime e tributação incompatíveis", () => {
    expect(problemasTributacao({ icms: { csosn: "102" } }, 3)).toEqual([
      "CSOSN é só para o Simples; no regime normal use CST.",
    ]);
    expect(problemasTributacao({ icms: { cst: "00", aliquota: 18 } }, 1)).toEqual([
      "Empresa do Simples usa CSOSN, não CST de ICMS.",
    ]);
    expect(
      problemasTributacao({ icms: { csosn: "102" }, pis: { cst: "01", aliquota: 1.65 } }, 1),
    ).toEqual(["PIS: no Simples o imposto vai no DAS; use CST 04 a 09, 49 ou 99."]);
    expect(problemasTributacao({ icms: { cst: "90" } } as never, 3)[0]).toContain("CST de ICMS 90");
  });
});

describe("carta de correção", () => {
  const chave = montarChaveAcesso({
    uf: "RS",
    anoMes: "2610",
    documentoEmitente: "48618635000183",
    modelo: "55",
    serie: 1,
    numero: 42,
    tipoEmissao: 1,
    codigoNumerico: "12345678",
  });
  const base = {
    chave,
    correcao: "Endereco de entrega: Rua das Flores, 100, fundos",
    documentoEmitente: "48618635000183",
    ambiente: 2 as const,
    sequencia: 1,
    dataEvento: new Date("2026-10-12T15:00:00Z"),
  };

  it("monta, assina e passa no XSD oficial", async () => {
    const { xml, id } = montarCartaCorrecao(base);
    expect(id).toBe(`ID110110${chave}01`);
    expect(xml).toContain(`<xCondUso>${CONDICAO_USO_CCE}</xCondUso>`);
    const assinado = assinarXml(xml, { certificado, elemento: "infEvento", perfil: "sefaz" });
    expect((await validarContraXsd(assinado, xsd("CCe_v1.00.xsd"))).erros).toEqual([]);
  });

  it("recusa NFC-e, texto curto e sequência fora de 1 a 20", () => {
    const nfce = `${chave.slice(0, 20)}65${chave.slice(22)}`;
    expect(() => montarCartaCorrecao({ ...base, chave: nfce })).toThrow();
    expect(() => montarCartaCorrecao({ ...base, correcao: "curto" })).toThrow("15 caracteres");
    expect(() => montarCartaCorrecao({ ...base, sequencia: 21 })).toThrow("1 a 20");
  });

  it("envia para a SEFAZ como evento da NF-e (modelo 55)", async () => {
    const { cliente, chamadas } = clienteFalso(
      (c) =>
        `<retEnvEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00"><cStat>128</cStat><xMotivo>Lote processado</xMotivo><retEvento versao="1.00"><infEvento><tpAmb>2</tpAmb><verAplic>RS</verAplic><cOrgao>43</cOrgao><cStat>135</cStat><xMotivo>Evento registrado e vinculado a NF-e</xMotivo><chNFe>${chaveDe(c.mensagem) || chave}</chNFe><tpEvento>110110</tpEvento><nSeqEvento>1</nSeqEvento><dhRegEvento>2026-10-12T12:00:01-03:00</dhRegEvento><nProt>143260000000555</nProt></infEvento></retEvento></retEnvEvento>`,
    );
    const r = await enviarCartaCorrecao(cliente, { ...base, uf: "RS", certificado });
    expect(chamadas[0]).toMatchObject({ modelo: "55", servico: "evento" });
    expect(r).toMatchObject({ registrado: true, protocolo: "143260000000555" });
    expect(r.xmlProcessado).toMatch(/^<procEventoNFe /);
  });
});
