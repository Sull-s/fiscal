import { readFileSync } from "node:fs";
import { join } from "node:path";
import { abrirCertificadoA1 } from "@fiscal/certificado";
import { type ErroFiscal, decomporChaveAcesso, montarChaveAcesso } from "@fiscal/core";
import { assinarXml, validarContraXsd, verificarAssinaturas } from "@fiscal/xml";
import { describe, expect, it } from "vitest";
import { chaveDe, clienteFalso, protNFe, retEnviNFe } from "../../nfe-comum/testes/sefaz-falsa";
import { emitirNfe } from "./emitir";
import { montarNfe } from "./montar";
import type { DadosNfe, EmitenteNfe, OperacaoNfe } from "./tipos";

const FIXTURES = join(import.meta.dirname, "..", "testes", "fixtures");
const xsd = (nome: string) => join(FIXTURES, "xsd", nome);
const certificado = abrirCertificadoA1(
  readFileSync(join(FIXTURES, "certificado-teste.pfx")),
  "senha-teste",
);

const emitenteSimples: EmitenteNfe = {
  cnpj: "48618635000183",
  inscricaoEstadual: "0960000000",
  razaoSocial: "Empresa Teste Ltda",
  nomeFantasia: "Teste",
  crt: 1,
  endereco: {
    logradouro: "Av. Ipiranga",
    numero: "1000",
    bairro: "Azenha",
    codigoMunicipio: "4314902",
    municipio: "Porto Alegre",
    uf: "RS",
    cep: "90160-093",
    telefone: "(51) 3333-4444",
  },
};
const emitenteNormal: EmitenteNfe = { ...emitenteSimples, crt: 3 };

const lojaRs = {
  documento: "11.222.333/0001-81",
  nome: "Loja Cliente Ltda",
  indicadorIe: 1 as const,
  inscricaoEstadual: "0240000000",
  email: "compras@cliente.com.br",
  endereco: {
    logradouro: "Rua dos Andradas",
    numero: "500",
    bairro: "Centro Historico",
    codigoMunicipio: "4314902",
    municipio: "Porto Alegre",
    uf: "RS" as const,
    cep: "90020-000",
  },
};
const lojaSc = {
  ...lojaRs,
  endereco: {
    ...lojaRs.endereco,
    codigoMunicipio: "4205407",
    municipio: "Florianopolis",
    uf: "SC" as const,
    cep: "88010-000",
  },
};

const nota: DadosNfe = {
  ambiente: 2,
  serie: 1,
  numero: 1001,
  naturezaOperacao: "Venda de mercadoria",
  dataEmissao: new Date("2026-10-12T13:00:00Z"),
  codigoNumerico: "12345678",
};

const vendaSimples: OperacaoNfe = {
  destinatario: lojaRs,
  itens: [
    {
      codigo: "CAD-01",
      descricao: "Cadeira de escritorio",
      ncm: "94013000",
      cfop: "5102",
      gtin: "7891234567895",
      quantidade: 4,
      valorUnitario: 250,
      tributacao: {
        icms: { csosn: "101", aliquotaCredito: 2.56 },
        pis: { cst: "99" },
        cofins: { cst: "99" },
      },
      pedido: { numero: "PC-778", item: 1 },
    },
    {
      codigo: "MES-02",
      descricao: "Mesa 120x60",
      ncm: "94033000",
      cfop: "5102",
      quantidade: 1,
      valorUnitario: 600,
      tributacao: { icms: { csosn: "102" }, pis: { cst: "99" }, cofins: { cst: "99" } },
    },
  ],
  frete: 80,
  desconto: 100,
  pagamentos: [{ forma: "boleto", valor: 1580, aPrazo: true }],
  transporte: {
    modalidade: 0,
    transportadora: {
      documento: "11222333000181",
      nome: "Transportes Teste",
      inscricaoEstadual: "0240000000",
      endereco: "Rua A, 1",
      municipio: "Porto Alegre",
      uf: "RS",
    },
    volumes: [{ quantidade: 5, especie: "CAIXA", pesoLiquido: 48.5, pesoBruto: 52.25 }],
  },
  cobranca: {
    fatura: { numero: "1001", valorOriginal: 1580, valorLiquido: 1580 },
    duplicatas: [
      { numero: "001", vencimento: "2026-11-11", valor: 790 },
      { numero: "002", vencimento: "2026-12-11", valor: 790 },
    ],
  },
  informacoesComplementares: "Pedido PC-778",
};

const chaveOriginal = montarChaveAcesso({
  uf: "RS",
  anoMes: "2609",
  documentoEmitente: "11222333000181",
  modelo: "55",
  serie: 1,
  numero: 456,
  tipoEmissao: 1,
  codigoNumerico: "12345678",
});

async function passaNoXsd(xml: string) {
  const assinado = assinarXml(xml, { certificado, elemento: "infNFe", perfil: "sefaz" });
  expect(verificarAssinaturas(assinado).valida).toBe(true);
  expect((await validarContraXsd(assinado, xsd("nfe_v4.00.xsd"))).erros).toEqual([]);
  return assinado;
}

describe("montarNfe", () => {
  it("Simples, venda interna a prazo com frete, desconto, transporte e duplicatas", async () => {
    const n = montarNfe({ emitente: emitenteSimples, operacao: vendaSimples, nota });
    await passaNoXsd(n.xml);
    expect(decomporChaveAcesso(n.chave)).toMatchObject({ modelo: "55", numero: 1001, serie: 1 });
    // 4×250 + 600 = 1600; − 100 de desconto + 80 de frete
    expect(n.valorTotal).toBe(1580);
    expect(n.xml).toContain("<idDest>1</idDest>");
    expect(n.xml).toContain(
      "<indFinal>0</indFinal><indPres>9</indPres><indIntermed>0</indIntermed>",
    );
    expect(n.xml).toContain("<cEAN>7891234567895</cEAN>");
    expect(n.xml).toContain("<xPed>PC-778</xPed><nItemPed>1</nItemPed>");
    // Frete e desconto repartidos: 1000/1600 e 600/1600
    expect(n.xml).toContain("<vFrete>50.00</vFrete><vDesc>62.50</vDesc>");
    expect(n.xml).toContain("<vFrete>30.00</vFrete><vDesc>37.50</vDesc>");
    // Crédito do Simples: (1000 − 62,50 + 50) × 2,56% = 25,28 e texto obrigatório
    expect(n.xml).toContain("<vCredICMSSN>25.28</vCredICMSSN>");
    expect(n.xml).toContain("PERMITE O APROVEITAMENTO DO CREDITO DE ICMS NO VALOR DE R$ 25,28");
    expect(n.xml).toContain("<indPag>1</indPag><tPag>15</tPag>");
    expect(n.xml).toContain(
      "<dup><nDup>001</nDup><dVenc>2026-11-11</dVenc><vDup>790.00</vDup></dup>",
    );
    expect(n.xml).toContain("<pesoL>48.500</pesoL><pesoB>52.250</pesoB>");
    expect(n.xml).toContain(
      "<xNome>NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL</xNome>",
    );
  });

  it("regime normal, interestadual com IPI: impostos e total (IPI por fora)", async () => {
    const n = montarNfe({
      emitente: emitenteNormal,
      nota,
      operacao: {
        destinatario: lojaSc,
        itens: [
          {
            codigo: "P1",
            descricao: "Peca usinada",
            ncm: "84879000",
            cfop: "6101",
            quantidade: 10,
            valorUnitario: 100,
            tributacao: {
              icms: { cst: "00", aliquota: 12 },
              ipi: { cst: "50", aliquota: 5 },
              pis: { cst: "01", aliquota: 1.65 },
              cofins: { cst: "01", aliquota: 7.6 },
            },
          },
        ],
        pagamentos: [{ forma: "pix", valor: 1050, integrado: false }],
      },
    });
    await passaNoXsd(n.xml);
    expect(n.xml).toContain("<idDest>2</idDest>");
    // Revenda para contribuinte: IPI fora da base do ICMS
    expect(n.impostos).toEqual({ icms: 120, fcp: 0, ipi: 50, pis: 14.52, cofins: 66.88 });
    expect(n.valorTotal).toBe(1050);
    expect(n.xml).toContain("<vIPI>50.00</vIPI><vIPIDevol>0.00</vIPIDevol><vPIS>14.52</vPIS>");
  });

  it("devolução de compra referenciando a nota original, sem pagamento", async () => {
    const n = montarNfe({
      emitente: emitenteSimples,
      nota: {
        ...nota,
        naturezaOperacao: "Devolucao de compra",
        finalidade: 4,
        referencias: [chaveOriginal],
      },
      operacao: {
        destinatario: lojaRs,
        itens: [
          {
            codigo: "X",
            descricao: "Mercadoria devolvida",
            ncm: "94013000",
            cfop: "5202",
            quantidade: 1,
            valorUnitario: 300,
            tributacao: { icms: { csosn: "102" } },
          },
        ],
        pagamentos: [{ forma: "sem-pagamento", valor: 0 }],
      },
    });
    await passaNoXsd(n.xml);
    expect(n.xml).toContain(
      "<finNFe>4</finNFe><indFinal>0</indFinal><indPres>0</indPres><procEmi>0</procEmi>",
    );
    expect(n.xml).toContain(`<NFref><refNFe>${chaveOriginal}</refNFe></NFref>`);
    expect(n.xml).toContain("<tPag>90</tPag><vPag>0.00</vPag>");
  });

  it("exportação com destinatário estrangeiro", async () => {
    const n = montarNfe({
      emitente: emitenteSimples,
      nota: { ...nota, naturezaOperacao: "Exportacao" },
      operacao: {
        destinatario: {
          idEstrangeiro: "AB123456",
          nome: "Importadora del Sur",
          indicadorIe: 9,
          endereco: {
            logradouro: "Av. Corrientes",
            numero: "1234",
            bairro: "Centro",
            codigoMunicipio: "9999999",
            municipio: "Buenos Aires",
            uf: "EX",
            codigoPais: "0639",
            pais: "ARGENTINA",
          },
        },
        itens: [
          {
            codigo: "C1",
            descricao: "Cadeira",
            ncm: "94013000",
            cfop: "7102",
            quantidade: 2,
            valorUnitario: 300,
            tributacao: { icms: { csosn: "300" } },
          },
        ],
        pagamentos: [{ forma: "transferencia", valor: 600 }],
      },
    });
    await passaNoXsd(n.xml);
    expect(n.xml).toContain("<idDest>3</idDest>");
    expect(n.xml).toContain("<idEstrangeiro>AB123456</idEstrangeiro>");
    expect(n.xml).toContain("<cMun>9999999</cMun><xMun>EXTERIOR</xMun><UF>EX</UF>");
  });

  it("lista todos os problemas de uma vez, explicados", () => {
    try {
      montarNfe({
        emitente: emitenteNormal,
        nota: { ...nota, finalidade: 4 },
        operacao: {
          destinatario: {
            ...lojaSc,
            indicadorIe: 9,
            inscricaoEstadual: undefined as never,
            endereco: { ...lojaSc.endereco, bairro: "C" },
          },
          itens: [
            {
              ...vendaSimples.itens[0]!,
              cfop: "5102",
              tributacao: { icms: { csosn: "102" } },
            },
          ],
          pagamentos: [{ forma: "dinheiro", valor: 10 }],
        },
      });
      throw new Error("deveria recusar");
    } catch (e) {
      const problemas = (e as ErroFiscal).detalhes?.problemas as string[];
      expect(problemas).toEqual(
        expect.arrayContaining([
          "Devolução e nota complementar precisam da chave da NF-e referenciada.",
          "Item 1 (Cadeira de escritorio): CFOP 5102 não combina com saída para outro estado (use 6xxx).",
          "Item 1 (Cadeira de escritorio): CSOSN é só para o Simples; no regime normal use CST.",
          expect.stringContaining("DIFAL"),
          'Devolução e nota de ajuste usam pagamento "sem-pagamento".',
          "Destinatário: bairro precisa de pelo menos 2 caracteres.",
        ]),
      );
    }
  });
});

describe("emitirNfe", () => {
  it("autoriza (com uma tentativa 539) e devolve o nfeProc válido no XSD", async () => {
    const { cliente, chamadas } = clienteFalso((c, i) =>
      retEnviNFe(
        "104",
        "Lote processado",
        protNFe(
          i === 0
            ? { chave: chaveDe(c.mensagem), cStat: "539", xMotivo: "Duplicidade" }
            : {
                chave: chaveDe(c.mensagem),
                cStat: "100",
                xMotivo: "Autorizado o uso da NF-e",
                nProt: "143260000001234",
              },
        ),
      ),
    );
    let n = 1000;
    const { numero: _, codigoNumerico: __, ...semNumero } = nota;
    const r = await emitirNfe({
      cliente,
      certificado,
      agora: new Date("2026-10-12T13:00:00Z"),
      emitente: emitenteSimples,
      operacao: vendaSimples,
      nota: semNumero,
      proximoNumero: async () => n++,
    });
    expect(chamadas.map((c) => c.modelo)).toEqual(["55", "55"]);
    expect(r.numerosEmUso).toEqual([1000]);
    expect(r.autorizacao).toMatchObject({ situacao: "autorizada", protocolo: "143260000001234" });
    expect(
      (await validarContraXsd(r.autorizacao.xmlProcessado!, xsd("procNFe_v4.00.xsd"))).erros,
    ).toEqual([]);
  });
});
