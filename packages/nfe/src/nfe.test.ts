import { readFileSync } from "node:fs";
import { join } from "node:path";
import { abrirCertificadoA1 } from "@fiscal/certificado";
import { ErroFiscal, decomporChaveAcesso, montarChaveAcesso } from "@fiscal/core";
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
    expect(n.impostos).toMatchObject({
      icms: 120,
      fcp: 0,
      ipi: 50,
      pis: 14.52,
      cofins: 66.88,
      st: 0,
    });
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

describe("contingência SVC", () => {
  const contingencia = {
    inicio: new Date("2026-10-12T12:50:00Z"),
    justificativa: "SEFAZ do estado fora do ar no momento da emissao",
  };

  it("RS vai para a SVC-AN (tpEmis 6) com dhCont e xJust; passa no XSD", async () => {
    const n = montarNfe({
      emitente: emitenteSimples,
      operacao: vendaSimples,
      nota: { ...nota, contingencia },
    });
    expect(n.contingencia).toBe("SVC-AN");
    expect(decomporChaveAcesso(n.chave).tipoEmissao).toBe(6);
    expect(n.xml).toContain("<tpEmis>6</tpEmis>");
    expect(n.xml).toContain(
      "<dhCont>2026-10-12T09:50:00-03:00</dhCont><xJust>SEFAZ do estado fora do ar no momento da emissao</xJust>",
    );
    await passaNoXsd(n.xml);
    const rs = montarNfe({
      emitente: emitenteSimples,
      operacao: vendaSimples,
      nota: { ...nota, contingencia: { ...contingencia, svc: "SVC-RS" } },
    });
    expect(rs.xml).toContain("<tpEmis>7</tpEmis>");
  });

  const autorizada = (c: { mensagem: string }) =>
    retEnviNFe(
      "104",
      "Lote processado",
      protNFe({
        chave: chaveDe(c.mensagem),
        cStat: "100",
        xMotivo: "Autorizado o uso da NF-e",
        nProt: "143260000009999",
      }),
    );
  const { numero: _, codigoNumerico: __, ...semNumero } = nota;
  const base = {
    certificado,
    agora: new Date("2026-10-12T13:00:00Z"),
    emitente: emitenteSimples,
    operacao: vendaSimples,
    nota: semNumero,
    contingencia: { justificativa: "SEFAZ RS indisponivel" },
  };

  it("SEFAZ do estado sem conexão: mesmo número autorizado na SVC", async () => {
    const { cliente, chamadas } = clienteFalso((c) =>
      c.contingencia
        ? autorizada(c)
        : new ErroFiscal("SEFAZ_SEM_CONEXAO", "sem conexão", { podeTerSidoProcessado: false }),
    );
    let n = 50;
    const r = await emitirNfe({ ...base, cliente, proximoNumero: async () => n++ });
    expect(chamadas.map((c) => c.contingencia ?? "UF")).toEqual(["UF", "SVC-AN"]);
    expect(r.nota).toMatchObject({ numero: 50, contingencia: "SVC-AN" });
    expect(r.autorizacao.situacao).toBe("autorizada");
    expect(r.xmlAssinado).toContain("(SEFAZ_SEM_CONEXAO)</xJust>");
    expect(r.tentativaPendente).toBeUndefined();
  });

  it("sem resposta: SVC com outro número e devolve a tentativa para conferir", async () => {
    const { cliente } = clienteFalso((c) =>
      c.contingencia
        ? autorizada(c)
        : new ErroFiscal("SEFAZ_SEM_RESPOSTA", "sem resposta", { podeTerSidoProcessado: true }),
    );
    let n = 70;
    const r = await emitirNfe({ ...base, cliente, proximoNumero: async () => n++ });
    expect(r.nota.numero).toBe(71);
    expect(r.tentativaPendente?.nota).toMatchObject({ numero: 70 });
    expect(r.tentativaPendente?.nota.contingencia).toBeUndefined();
  });

  it("sem a opção, o erro de conexão sobe como antes", async () => {
    const { cliente } = clienteFalso(
      () => new ErroFiscal("SEFAZ_SEM_CONEXAO", "sem conexão", { podeTerSidoProcessado: false }),
    );
    const { contingencia: _c, ...semOpcao } = base;
    await expect(
      emitirNfe({ ...semOpcao, cliente, proximoNumero: async () => 1 }),
    ).rejects.toMatchObject({ codigo: "SEFAZ_SEM_CONEXAO" });
  });
});

describe("ST, DIFAL, IBS/CBS e tributos aproximados", () => {
  const item = (tributacao: object, cfop = "5102") => ({
    codigo: "P1",
    descricao: "Produto com ST",
    ncm: "22021000",
    cest: "0300700",
    cfop,
    quantidade: 10,
    valorUnitario: 10,
    tributacao: tributacao as never,
  });
  const montar = (emitente: EmitenteNfe, op: Partial<OperacaoNfe>, pago: number) =>
    montarNfe({
      emitente,
      nota,
      operacao: {
        destinatario: lojaRs,
        itens: [],
        pagamentos: [{ forma: "pix", valor: pago, integrado: false }],
        ...op,
      } as OperacaoNfe,
    });

  it("CST 10: ICMS próprio + ST com MVA somada ao total; passa no XSD", async () => {
    const n = montar(
      emitenteNormal,
      {
        itens: [
          item({
            icms: { cst: "10", aliquota: 17, st: { mva: 40, aliquota: 17, aliquotaFcp: 2 } },
          }),
        ],
      },
      125.8,
    );
    // Base ST = 100 × 1,40 = 140; ST = 140 × 17% − 17 = 6,80; FCP-ST = 2,80
    expect(n.xml).toContain(
      "<modBCST>4</modBCST><pMVAST>40.0000</pMVAST><vBCST>140.00</vBCST><pICMSST>17.0000</pICMSST><vICMSST>6.80</vICMSST><vBCFCPST>140.00</vBCFCPST><pFCPST>2.0000</pFCPST><vFCPST>2.80</vFCPST>",
    );
    expect(n.xml).toContain("<vBCST>140.00</vBCST><vST>6.80</vST><vFCPST>2.80</vFCPST>");
    expect(n.valorTotal).toBe(109.6);
    expect(n.impostos.st).toBe(9.6);
    await passaNoXsd(n.xml);
  });

  it("CST 70 e CST 30 passam no XSD", async () => {
    const n = montar(
      emitenteNormal,
      {
        itens: [
          item({
            icms: {
              cst: "70",
              aliquota: 17,
              reducaoBase: 20,
              st: { mva: 30, aliquota: 17, reducaoBase: 20 },
            },
          }),
          item({ icms: { cst: "30", aliquotaPropria: 17, st: { mva: 30, aliquota: 17 } } }),
        ],
      },
      300,
    );
    await passaNoXsd(n.xml);
    expect(n.xml).toContain("<ICMS70>");
    expect(n.xml).toContain("<ICMS30>");
  });

  it("Simples: CSOSN 201 (com crédito) e 202 deduzem o ICMS próprio da ST", async () => {
    const n = montar(
      emitenteSimples,
      {
        itens: [
          item({
            icms: {
              csosn: "201",
              aliquotaCredito: 2.56,
              aliquotaPropria: 17,
              st: { mva: 40, aliquota: 17 },
            },
          }),
          item({ icms: { csosn: "202", aliquotaPropria: 17, st: { mva: 40, aliquota: 17 } } }),
        ],
      },
      300,
    );
    await passaNoXsd(n.xml);
    expect(n.xml).toContain(
      "<ICMSSN201><orig>0</orig><CSOSN>201</CSOSN><modBCST>4</modBCST><pMVAST>40.0000</pMVAST><vBCST>140.00</vBCST><pICMSST>17.0000</pICMSST><vICMSST>6.80</vICMSST><pCredSN>2.5600</pCredSN><vCredICMSSN>2.56</vCredICMSSN></ICMSSN201>",
    );
    expect(n.valorTotal).toBe(213.6);
  });

  const consumidorSc = {
    documento: "12345678909",
    nome: "Consumidor SC",
    indicadorIe: 9 as const,
    endereco: lojaSc.endereco,
  };
  it("DIFAL base única e base dupla: grupo ICMSUFDest e totais; passa no XSD", async () => {
    const difal = (baseDupla: boolean) =>
      montar(
        emitenteNormal,
        {
          destinatario: consumidorSc,
          itens: [
            item(
              {
                icms: { cst: "00", aliquota: 12 },
                difal: {
                  aliquotaInterna: 17,
                  aliquotaInterestadual: 12,
                  aliquotaFcp: 2,
                  baseDupla,
                },
              },
              "6108",
            ),
          ],
        },
        100,
      );
    const unica = difal(false);
    // (17% − 12%) × 100 = 5,00; FCP 2% × 100 = 2,00
    expect(unica.xml).toContain(
      "<ICMSUFDest><vBCUFDest>100.00</vBCUFDest><vBCFCPUFDest>100.00</vBCFCPUFDest><pFCPUFDest>2.0000</pFCPUFDest><pICMSUFDest>17.0000</pICMSUFDest><pICMSInter>12.00</pICMSInter><pICMSInterPart>100.0000</pICMSInterPart><vFCPUFDest>2.00</vFCPUFDest><vICMSUFDest>5.00</vICMSUFDest><vICMSUFRemet>0.00</vICMSUFRemet></ICMSUFDest>",
    );
    expect(unica.xml).toContain(
      "<vICMSDeson>0.00</vICMSDeson><vFCPUFDest>2.00</vFCPUFDest><vICMSUFDest>5.00</vICMSUFDest><vICMSUFRemet>0.00</vICMSUFRemet>",
    );
    expect(unica.valorTotal).toBe(100);
    await passaNoXsd(unica.xml);
    // Base dupla: (100 − 12) / (1 − 0,17) = 106,02; 106,02 × 17% − 12 = 6,02
    const dupla = difal(true);
    expect(dupla.xml).toContain("<vBCUFDest>106.02</vBCUFDest>");
    expect(dupla.xml).toContain("<vICMSUFDest>6.02</vICMSUFDest>");
    await passaNoXsd(dupla.xml);
  });

  it("regime normal: venda a consumidor de outro estado sem DIFAL é recusada", () => {
    expect(() =>
      montar(
        emitenteNormal,
        {
          destinatario: consumidorSc,
          itens: [item({ icms: { cst: "00", aliquota: 12 } }, "6108")],
        },
        100,
      ),
    ).toThrow("precisa do DIFAL");
  });

  it("Pix/cartão sem os dados da maquininha precisa de integrado: false (senão a SEFAZ dá 392)", () => {
    const op = {
      itens: [item({ icms: { cst: "00", aliquota: 17 } })],
      pagamentos: [{ forma: "pix" as const, valor: 100 }],
    };
    expect(() => montar(emitenteNormal, op, 100)).toThrow(
      "pagamento integrado precisa do CNPJ da credenciadora",
    );
    const integrado = montar(
      emitenteNormal,
      { ...op, pagamentos: [{ forma: "pix", valor: 100, cnpjCredenciadora: "10573521000191" }] },
      100,
    );
    expect(integrado.xml).toContain("<tpIntegra>1</tpIntegra><CNPJ>10573521000191</CNPJ>");
  });

  it("IBS/CBS de 2026 e tributos aproximados: grupos, totais e texto; passa no XSD", async () => {
    const n = montar(
      emitenteNormal,
      {
        itens: [
          item({
            icms: { cst: "00", aliquota: 17 },
            pis: { cst: "01", aliquota: 1.65 },
            cofins: { cst: "01", aliquota: 7.6 },
            ibsCbs: { cst: "000", classificacao: "000001" },
            tributosAproximados: { federal: 13.45, estadual: 17 },
          }),
        ],
      },
      100,
    );
    // Base IBS/CBS = 100 − 17 (ICMS) − 1,37 (PIS) − 6,31 (COFINS) = 75,32
    expect(n.xml).toContain(
      "<IBSCBS><CST>000</CST><cClassTrib>000001</cClassTrib><gIBSCBS><vBC>75.32</vBC><gIBSUF><pIBSUF>0.1000</pIBSUF><vIBSUF>0.08</vIBSUF></gIBSUF><gIBSMun><pIBSMun>0.0000</pIBSMun><vIBSMun>0.00</vIBSMun></gIBSMun><vIBS>0.08</vIBS><gCBS><pCBS>0.9000</pCBS><vCBS>0.68</vCBS></gCBS></gIBSCBS></IBSCBS>",
    );
    expect(n.xml).toContain("<imposto><vTotTrib>30.45</vTotTrib><ICMS>");
    expect(n.xml).toContain("<vNF>100.00</vNF><vTotTrib>30.45</vTotTrib></ICMSTot><IBSCBSTot>");
    expect(n.xml).toContain("Trib aprox: R$ 13,45 Federal, R$ 17,00 Estadual e R$ 0,00 Municipal");
    expect(n.impostos).toMatchObject({ ibsCbs: 0.76, tributosAproximados: 30.45 });
    // Em 2026 o IBS/CBS não soma no total
    expect(n.valorTotal).toBe(100);
    await passaNoXsd(n.xml);
  });
});
