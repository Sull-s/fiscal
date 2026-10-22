import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ErroFiscal } from "@fiscal/core";
import { verificarAssinaturas } from "@fiscal/xml";
import { describe, expect, it } from "vitest";
import { entradaReal } from "../testes/entrada-real";
import { montarCancelamentoNfse, montarDps, montarIdDps } from "./dps";
import { decomporChaveNfse, lerNfse } from "./nfse";

const ANTIGO = join(import.meta.dirname, "..", "testes", "fixtures", "antigo");
const ler = (nome: string) => readFileSync(join(ANTIGO, nome), "utf8");

describe("montarDps", () => {
  it("idêntica à DPS que o Sistema Nacional aceitou e transformou em NFS-e", () => {
    const { xml, id, dataEmissao } = montarDps(entradaReal());
    expect(xml).toBe(ler("dps-aceita.xml").replace(/<Signature[\s\S]*<\/Signature>/, ""));
    expect(id).toBe("DPS431490221044053200010100900000000000000001");
    expect(dataEmissao).toBe("2026-08-28T08:09:11-03:00");

    // E bate com a DPS que o próprio governo embutiu na NFS-e autorizada
    const embutida = /<DPS [\s\S]*<\/DPS>/.exec(ler("nfse-autorizada.xml"))?.[0] ?? "";
    expect(xml.replace(/^<\?xml[^>]*\?>/, "")).toBe(
      embutida.replace(/<Signature[\s\S]*<\/Signature>/, ""),
    );
  });

  it("Id tem 45 caracteres, com CPF ou CNPJ", () => {
    const cnpj = montarIdDps({
      codigoMunicipioEmissor: "4314902",
      documentoEmitente: "10.440.532/0001-01",
      serie: "1",
      numero: 7,
    });
    const cpf = montarIdDps({
      codigoMunicipioEmissor: "4314902",
      documentoEmitente: "529.982.247-25",
      serie: "1",
      numero: 7,
    });
    expect(cnpj).toBe("DPS431490221044053200010100001000000000000007");
    expect(cpf).toBe("DPS431490210005299822472500001000000000000007");
    expect(cpf).toHaveLength(45);
  });

  it("descrição aceita quebra de linha e acentos; o ISS com imunidade exige o tipo", () => {
    const e = entradaReal();
    e.servico.descricao = "Linha 1: emissão\nLinha 2: ação";
    expect(montarDps(e).xml).toContain("<xDescServ>Linha 1: emissão\nLinha 2: ação</xDescServ>");

    const imune = { ...entradaReal(), valores: { valorServico: 10, tributacaoIssqn: 4 as const } };
    expect(() => montarDps(imune)).toThrow(/tipo de imunidade/);
  });

  it("Simples ME/EPP informa o regime de apuração e o percentual de tributos", () => {
    const e = entradaReal();
    const xml = montarDps({
      ...e,
      prestador: { ...e.prestador, regime: { opcaoSimples: 3 } },
      valores: { ...e.valores, percentualTributosSimples: 6, aliquotaIss: 2 },
    }).xml;
    expect(xml).toContain(
      "<regTrib><opSimpNac>3</opSimpNac><regApTribSN>1</regApTribSN><regEspTrib>0</regEspTrib></regTrib>",
    );
    expect(xml).toContain("<pAliq>2.00</pAliq>");
    expect(xml).toContain("<totTrib><pTotTribSN>6.00</pTotTribSN></totTrib>");
  });

  it("junta todos os problemas em um único erro", () => {
    const e = entradaReal();
    e.prestador.documento = "10440532000102";
    e.servico.codigoTributacaoNacional = "0106";
    e.valores.valorServico = 0;
    try {
      montarDps({ ...e, dps: { ...e.dps, serie: "123456" } });
      expect.unreachable();
    } catch (erro) {
      expect((erro as ErroFiscal).codigo).toBe("DPS_INVALIDA");
      expect((erro as ErroFiscal).detalhes?.problemas).toHaveLength(4);
    }
  });

  it("endereço do tomador sem rua é barrado antes de ir ao gov.br (E1235)", () => {
    const e = entradaReal();
    if (!e.tomador.endereco) throw new Error("fixture sem endereço");
    e.tomador.endereco.logradouro = "";
    e.tomador.endereco.cep = "";
    expect(() => montarDps(e)).toThrow();
    try {
      montarDps(e);
    } catch (erro) {
      expect((erro as ErroFiscal).detalhes?.problemas).toEqual([
        "Endereço do tomador incompleto: falta rua, CEP. Complete ou não envie o endereço.",
      ]);
    }
    // Sem endereço nenhum continua valendo
    const semEndereco = entradaReal();
    const { endereco: _, ...tomador } = semEndereco.tomador;
    expect(montarDps({ ...semEndereco, tomador }).xml).not.toContain("<end>");
  });
});

describe("montarCancelamentoNfse", () => {
  it("idêntico ao do emissor antigo", () => {
    const xml = montarCancelamentoNfse({
      chave: "43149022210440532000101000000000000126089303229430",
      ambiente: 2,
      versaoAplicativo: "meusistema-1.0.0",
      documentoAutor: "10440532000101",
      motivo: "Valor digitado errado & corrigido",
      codigoMotivo: 1,
      dataEvento: new Date("2026-08-28T12:31:00Z"),
    });
    expect(xml).toBe(ler("cancelamento.xml"));
  });
});

describe("NFS-e autorizada real", () => {
  const xml = ler("nfse-autorizada.xml");

  it("as duas assinaturas conferem (emitente na DPS e Receita na nota)", () => {
    expect(verificarAssinaturas(xml).valida).toBe(true);
  });

  it("lerNfse extrai os dados principais", () => {
    expect(lerNfse(xml)).toMatchObject({
      chave: "43149022210440532000101000000000000126089303229430",
      numero: "1",
      ambiente: "2",
      municipioEmissor: "Porto Alegre",
      emitente: { documento: "10440532000101", nome: "10.440.532 EVERTON ROGERIO DA SILVA" },
      tomador: { documento: "45465512000161", nome: "VISTO PRATICO LTDA" },
      servico: { codigoTributacaoNacional: "090201" },
      valores: { servico: "40.00", liquido: "40.00" },
      dps: { id: "DPS431490221044053200010100900000000000000001", serie: "900", numero: "1" },
    });
  });

  it("decompõe a chave de 50 dígitos", () => {
    expect(decomporChaveNfse("43149022210440532000101000000000000126089303229430")).toEqual({
      codigoMunicipio: "4314902",
      ambienteGerador: 2,
      tipoInscricao: 2,
      documentoEmitente: "10440532000101",
      numero: 1,
      anoMes: "2608",
      codigoNumerico: "930322943",
      digitoVerificador: 0,
    });
  });
});
