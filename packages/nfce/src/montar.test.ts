import { readFileSync } from "node:fs";
import { join } from "node:path";
import { abrirCertificadoA1 } from "@fiscal/certificado";
import type { ErroFiscal } from "@fiscal/core";
import { assinarXml, validarContraXsd, verificarAssinaturas } from "@fiscal/xml";
import { describe, expect, it } from "vitest";
import { PASTA_FIXTURES, carregarFixturesAntigas } from "../testes/fixtures-antigas";
import { montarNfce } from "./montar";
import type { Venda } from "./tipos";

const FIXTURES = carregarFixturesAntigas();
const certificado = abrirCertificadoA1(
  readFileSync(join(PASTA_FIXTURES, "certificado-teste.pfx")),
  "senha-teste",
);
const XSD_NFE = join(PASTA_FIXTURES, "xsd", "nfe_v4.00.xsd");

describe("montarNfce: igual ao emissor em produção", () => {
  it("há fixtures para comparar", () => {
    expect(FIXTURES.length).toBeGreaterThanOrEqual(4);
  });

  it.each(FIXTURES)("$nome: XML idêntico ao do emissor antigo", ({ entrada, esperado }) => {
    const nota = montarNfce(entrada);
    expect(nota.xml).toBe(esperado.xml);
    expect(nota.chave).toBe(esperado.chave);
    expect(nota.valorTotal).toBe(esperado.vNF);
    expect(nota.troco).toBe(esperado.troco);
    expect(nota.qrCode).toBe(esperado.qrCode);
  });

  it.each(FIXTURES)("$nome: assinada passa no XSD oficial", async ({ entrada }) => {
    const nota = montarNfce(entrada);
    const assinado = assinarXml(nota.xml, { certificado, elemento: "infNFe", perfil: "sefaz" });
    expect(verificarAssinaturas(assinado).valida).toBe(true);
    const r = await validarContraXsd(assinado, XSD_NFE);
    expect(r.erros).toEqual([]);
  });
});

const base = () =>
  structuredClone(FIXTURES.find((f) => f.nome === "balcao-dinheiro-troco")?.entrada)!;

describe("montarNfce: regras", () => {
  it("homologação marca o 1º item e o destinatário; produção não", () => {
    const homolog = FIXTURES.find((f) => f.nome === "entrega-homologacao")!;
    const producao = FIXTURES.find((f) => f.nome === "entrega-producao")!;
    expect(montarNfce(homolog.entrada).xml).toContain(
      "<xProd>NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL</xProd>",
    );
    expect(montarNfce(producao.entrada).xml).not.toContain("HOMOLOGACAO");
  });

  it("valor do item sem erro de ponto flutuante e preço com frações de centavo", () => {
    const e = base();
    e.venda.itens = [
      { ...e.venda.itens[0]!, quantidade: 3, valorUnitario: 0.335, cest: "0300300" },
    ];
    e.venda.pagamentos = [{ forma: "dinheiro", valor: 1.01 }];
    const nota = montarNfce(e);
    // 3 × 0,335 = 1,005 → 1,01 (o JavaScript puro daria 1,00)
    expect(nota.xml).toContain("<vUnCom>0.335</vUnCom>");
    expect(nota.xml).toContain("<vProd>1.01</vProd>");
    expect(nota.valorTotal).toBe(1.01);
  });

  it("desconto repartido: a soma dos itens bate exatamente com o total", () => {
    const e = base();
    e.venda.desconto = 1;
    const xml = montarNfce(e).xml;
    const descontosItens = [...xml.matchAll(/<det [\s\S]*?<vDesc>([\d.]+)<\/vDesc>/g)].map((m) =>
      Number(m[1]),
    );
    expect(descontosItens.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 10);
    expect(xml).toContain("<ICMSTot>");
    expect(xml).toMatch(/<vDesc>1\.00<\/vDesc><vII>/);
  });

  it("junta todos os problemas da venda em um único erro", () => {
    const e = base();
    e.venda.itens = [
      {
        descricao: "",
        ncm: "123",
        cfop: "51",
        quantidade: 0,
        valorUnitario: 1,
        csosn: "500",
      } as Venda["itens"][number],
    ];
    e.venda.pagamentos = [{ forma: "credito", valor: 10 }];
    try {
      montarNfce(e);
      expect.unreachable();
    } catch (erro) {
      const { codigo, detalhes } = erro as ErroFiscal;
      expect(codigo).toBe("NFCE_VENDA_INVALIDA");
      expect(detalhes?.problemas).toEqual([
        "Item 1: sem descrição.",
        "Item 1: NCM deve ter 8 dígitos.",
        "Item 1: CFOP deve ter 4 dígitos.",
        "Item 1: quantidade deve ser maior que zero.",
        "Item 1: produto com ST (CSOSN 500) precisa do CEST.",
        "Pagamento 1 (credito): pagamento integrado precisa do CNPJ da credenciadora (ou informe integrado: false).",
      ]);
    }
  });

  it("entrega sem dados do destinatário é recusada antes da SEFAZ (787/788)", () => {
    const e = base();
    e.venda.entrega = true;
    e.venda.destinatario = {};
    expect(() => montarNfce(e)).toThrow(/CPF \(ou CNPJ\) de quem recebe/);
  });

  it("pagamento insuficiente e troco fora do dinheiro", () => {
    const e = base();
    e.venda.pagamentos = [{ forma: "dinheiro", valor: 1 }];
    expect(() => montarNfce(e)).toThrow(/menores que o total/);
    e.venda.pagamentos = [{ forma: "debito", valor: 100, integrado: false }];
    expect(() => montarNfce(e)).toThrow(/só é aceito em dinheiro/);
  });

  it("emitente sem IE ou com CNPJ inválido", () => {
    const e = base();
    e.emitente.inscricaoEstadual = "000";
    e.emitente.cnpj = "11222333000182";
    try {
      montarNfce(e);
      expect.unreachable();
    } catch (erro) {
      expect((erro as ErroFiscal).codigo).toBe("NFCE_EMITENTE_INVALIDO");
      expect((erro as ErroFiscal).detalhes?.problemas).toHaveLength(2);
    }
  });

  it("QR Code e urlChave de outra UF vêm do catálogo", () => {
    const e = base();
    e.emitente.endereco.uf = "SP";
    e.emitente.endereco.codigoMunicipio = "3550308";
    const nota = montarNfce(e);
    expect(nota.chave.slice(0, 2)).toBe("35");
    expect(nota.qrCode).toMatch(/^https?:\/\/.+\?p=35\d{42}\|3\|2$/);
    expect(nota.urlConsulta).not.toBe("");
  });
});
