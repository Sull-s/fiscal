import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ErroFiscal } from "@fiscal/core";
import { validarContraXsd, verificarAssinaturas } from "@fiscal/xml";
import { describe, expect, it } from "vitest";
import { entradaReal } from "../testes/entrada-real";
import { montarCancelamentoNfse, montarDps, montarIdDps } from "./dps";
import { decomporChaveNfse, lerNfse } from "./nfse";

const ANTIGO = join(import.meta.dirname, "..", "testes", "fixtures", "antigo");
/** Esquemas oficiais: produção (09/02/2026) e produção restrita (20/10/2026) */
const XSD = (leiaute: "2026-02" | "2026-10") =>
  join(import.meta.dirname, "..", "testes", "xsd", leiaute, "DPS_v1.01.xsd");
const ler = (nome: string) => readFileSync(join(ANTIGO, nome), "utf8");

describe("montarDps", () => {
  it("idêntica à DPS que o Sistema Nacional aceitou e transformou em NFS-e (leiaute 2026-02)", () => {
    const e = entradaReal();
    const { xml, id, dataEmissao, leiaute } = montarDps({
      ...e,
      dps: { ...e.dps, leiaute: "2026-02" },
    });
    expect(leiaute).toBe("2026-02");
    expect(xml).toBe(ler("dps-aceita.xml").replace(/<Signature[\s\S]*<\/Signature>/, ""));
    expect(id).toBe("DPS431490221044053200010100900000000000000001");
    expect(dataEmissao).toBe("2026-08-28T08:09:11-03:00");

    // E bate com a DPS que o próprio governo embutiu na NFS-e autorizada
    const embutida = /<DPS [\s\S]*<\/DPS>/.exec(ler("nfse-autorizada.xml"))?.[0] ?? "";
    expect(xml.replace(/^<\?xml[^>]*\?>/, "")).toBe(
      embutida.replace(/<Signature[\s\S]*<\/Signature>/, ""),
    );
  });

  it("cada leiaute passa no seu esquema oficial e é recusado pelo outro", async () => {
    for (const leiaute of ["2026-02", "2026-10"] as const) {
      const e = entradaReal();
      const { xml } = montarDps({ ...e, dps: { ...e.dps, leiaute } });
      const proprio = await validarContraXsd(xml, XSD(leiaute));
      expect(proprio.erros).toEqual([]);
      const outro = await validarContraXsd(xml, XSD(leiaute === "2026-02" ? "2026-10" : "2026-02"));
      expect(outro.valido).toBe(false);
    }
  });

  it("2026-10: finNFSe=0 depois de tpEmit, NBS antes da descrição e versao 1.01", () => {
    const e = entradaReal();
    const { xml, leiaute } = montarDps({ ...e, dps: { ...e.dps, leiaute: "2026-10" } });
    expect(leiaute).toBe("2026-10");
    expect(xml).toContain('versao="1.01"');
    expect(xml).toContain("<tpEmit>1</tpEmit><finNFSe>0</finNFSe><cLocEmi>");
    expect(xml).toMatch(/<cNBS>118054000<\/cNBS><xDescServ>/);
  });

  it("IBS/CBS (2026-10): grupo no fim da DPS, passa no esquema; obrigatório a partir de 10/2026", async () => {
    const e = entradaReal();
    const ibsCbs = { cst: "000", cClassTrib: "000001" };
    const outubro = { ...e.dps, leiaute: "2026-10" as const, competencia: "2026-10-22" };
    const { xml } = montarDps({ ...e, servico: { ...e.servico, ibsCbs }, dps: outubro });
    expect(xml).toContain(
      "<IBSCBS><indDest>0</indDest><valores><trib><CST>000</CST><cClassTrib>000001</cClassTrib></trib></valores></IBSCBS></infDPS>",
    );
    expect((await validarContraXsd(xml, XSD("2026-10"))).erros).toEqual([]);

    // Sem os códigos: barrado antes de ir ao gov.br (lá seria E0855)
    expect(() => montarDps({ ...e, dps: outubro })).toThrow(/exige o grupo IBS\/CBS/);
    // Competência antiga não exige; e o leiaute de produção nunca leva o grupo
    expect(() => montarDps({ ...e, dps: { ...outubro, competencia: "2026-09-30" } })).not.toThrow();
    const producao = montarDps({
      ...e,
      servico: { ...e.servico, ibsCbs },
      dps: { ...outubro, leiaute: "2026-02" },
    });
    expect(producao.xml).not.toContain("<IBSCBS>");
    // Incidência no endereço do tomador (100301): sem tomador, barrado (lá seria E0239)
    const { tomador: _t, ...semTomador } = e;
    expect(() =>
      montarDps({
        ...semTomador,
        servico: { ...e.servico, ibsCbs: { ...ibsCbs, cIndOp: "100301" } },
        dps: outubro,
      }),
    ).toThrow(/incide no endereço do tomador/);
    expect(() =>
      montarDps({
        ...e,
        servico: { ...e.servico, ibsCbs: { ...ibsCbs, cIndOp: "100301" } },
        dps: outubro,
      }),
    ).not.toThrow();
    // Códigos no formato errado
    expect(() =>
      montarDps({
        ...e,
        servico: { ...e.servico, ibsCbs: { cst: "0", cClassTrib: "1" } },
        dps: outubro,
      }),
    ).toThrow(/CST deve ter 3 dígitos/);
  });

  it("sem leiaute, cada ambiente usa o seu (produção 2026-02, restrita 2026-10)", () => {
    const e = entradaReal();
    expect(montarDps({ ...e, dps: { ...e.dps, ambiente: 1 } }).leiaute).toBe("2026-02");
    expect(montarDps({ ...e, dps: { ...e.dps, ambiente: 2 } }).leiaute).toBe("2026-10");
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
