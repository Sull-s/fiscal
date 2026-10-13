// Gera a NF-e de exemplo usada nos testes do DANFE (packages/documentos/testes/fixtures).
// Uso: node --experimental-strip-types packages/nfe/testes/gerar-exemplo.mts
import { writeFileSync } from "node:fs";
import { montarNfe } from "../dist/index.js";

const nota = montarNfe({
  emitente: {
    cnpj: "48618635000183",
    inscricaoEstadual: "0960000000",
    razaoSocial: "Empresa Teste Moveis Ltda",
    crt: 3,
    endereco: {
      logradouro: "Av. Ipiranga",
      numero: "1000",
      bairro: "Azenha",
      codigoMunicipio: "4314902",
      municipio: "Porto Alegre",
      uf: "RS",
      cep: "90160093",
      telefone: "5133334444",
    },
  },
  nota: {
    ambiente: 2,
    serie: 1,
    numero: 1234,
    naturezaOperacao: "Venda de mercadoria",
    dataEmissao: new Date("2026-10-12T13:00:00Z"),
    dataSaida: new Date("2026-10-12T15:30:00Z"),
    codigoNumerico: "87654321",
  },
  operacao: {
    destinatario: {
      documento: "11222333000181",
      nome: "Loja Cliente Ltda",
      indicadorIe: 1,
      inscricaoEstadual: "2550000000",
      endereco: {
        logradouro: "Rua Felipe Schmidt",
        numero: "300",
        bairro: "Centro",
        codigoMunicipio: "4205407",
        municipio: "Florianopolis",
        uf: "SC",
        cep: "88010000",
      },
    },
    itens: [
      {
        codigo: "CAD-01",
        descricao: "Cadeira de escritorio giratoria com bracos reguláveis",
        ncm: "94013000",
        cfop: "6101",
        quantidade: 4,
        valorUnitario: 250,
        tributacao: {
          icms: { cst: "00", aliquota: 12 },
          ipi: { cst: "50", aliquota: 5 },
          pis: { cst: "01", aliquota: 1.65 },
          cofins: { cst: "01", aliquota: 7.6 },
        },
        observacao: "Cor preta",
      },
      {
        codigo: "MES-02",
        descricao: "Mesa 120x60",
        ncm: "94033000",
        cfop: "6101",
        quantidade: 1,
        valorUnitario: 600,
        tributacao: { icms: { cst: "00", aliquota: 12 }, ipi: { cst: "53" } },
      },
    ],
    frete: 80,
    pagamentos: [{ forma: "boleto", valor: 1732.5, aPrazo: true }],
    transporte: {
      modalidade: 0,
      transportadora: { documento: "11222333000181", nome: "Transportes Teste", uf: "RS" },
      volumes: [{ quantidade: 5, especie: "CAIXA", pesoLiquido: 48.5, pesoBruto: 52.25 }],
    },
    cobranca: {
      fatura: { numero: "1234", valorOriginal: 1732.5, valorLiquido: 1732.5 },
      duplicatas: [
        { numero: "001", vencimento: "2026-11-11", valor: 866.25 },
        { numero: "002", vencimento: "2026-12-11", valor: 866.25 },
      ],
    },
    informacoesComplementares: "Pedido PC-778. Entrega em horario comercial.",
  },
});
const prot = `<protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><verAplic>RS20260901</verAplic><chNFe>${nota.chave}</chNFe><dhRecbto>2026-10-12T10:00:05-03:00</dhRecbto><nProt>143260000004321</nProt><digVal>AAAA</digVal><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe>`;
const xml = `<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">${nota.xml}${prot}</nfeProc>`;
writeFileSync(process.argv[2] ?? "nfe-autorizada.xml", xml);
console.log(nota.chave, nota.valorTotal);
