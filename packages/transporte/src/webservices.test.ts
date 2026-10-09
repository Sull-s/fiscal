import { CODIGOS_UF, ErroFiscal, type Uf } from "@fiscal/core";
import { describe, expect, it } from "vitest";
import { lerRespostaSoap, montarEnvelope, podeTerSidoProcessado } from "./soap";
import {
  CATALOGO_PADRAO,
  CONTINGENCIA_DA_UF,
  type ServicoSefaz,
  estenderCatalogo,
  localizarWebservice,
} from "./webservices";

// Endereços que o emissor antigo usa em produção (apis/mp-marketplace-oauth/lib/nfce/sefaz.js)
const RS_PRODUCAO_EMISSOR_ANTIGO = {
  1: {
    autorizacao: "https://nfce.sefazrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx",
    status: "https://nfce.sefazrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx",
    evento: "https://nfce.sefazrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx",
    consulta: "https://nfce.sefazrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx",
    inutilizacao: "https://nfce.sefazrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx",
  },
  2: {
    autorizacao:
      "https://nfce-homologacao.sefazrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx",
    status: "https://nfce-homologacao.sefazrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx",
    evento: "https://nfce-homologacao.sefazrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx",
    consulta: "https://nfce-homologacao.sefazrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx",
    inutilizacao:
      "https://nfce-homologacao.sefazrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx",
  },
} as const;

describe("localizarWebservice", () => {
  it("NFC-e RS: catálogo gerado bate com os endereços do emissor em produção", () => {
    for (const ambiente of [1, 2] as const) {
      for (const [servico, url] of Object.entries(RS_PRODUCAO_EMISSOR_ANTIGO[ambiente])) {
        const ws = localizarWebservice({
          uf: "RS",
          modelo: "65",
          ambiente,
          servico: servico as ServicoSefaz,
        });
        expect(ws.url.toLowerCase()).toBe(url.toLowerCase());
      }
    }
    expect(
      localizarWebservice({ uf: "RS", modelo: "65", ambiente: 1, servico: "autorizacao" }),
    ).toEqual({
      autorizador: "RS",
      url: expect.stringMatching(/NFeAutorizacao4\.asmx$/i),
      wsdl: "NFeAutorizacao4",
      metodo: "nfeAutorizacaoLote",
      namespace: "http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4",
      acao: "http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4/nfeAutorizacaoLote",
    });
  });

  it("todas as 27 UFs têm autorização e status nos dois modelos e ambientes", () => {
    for (const uf of Object.keys(CODIGOS_UF) as Uf[]) {
      for (const modelo of ["55", "65"] as const) {
        for (const ambiente of [1, 2] as const) {
          for (const servico of ["autorizacao", "status", "consulta", "evento"] as const) {
            expect(localizarWebservice({ uf, modelo, ambiente, servico }).url).toMatch(
              /^https:\/\//,
            );
          }
        }
      }
    }
  });

  it("UFs atendidas por SEFAZ virtual", () => {
    expect(
      localizarWebservice({ uf: "SC", modelo: "65", ambiente: 2, servico: "status" }).autorizador,
    ).toBe("SVRS");
    expect(
      localizarWebservice({ uf: "MA", modelo: "55", ambiente: 2, servico: "status" }).autorizador,
    ).toBe("SVAN");
    expect(
      localizarWebservice({ uf: "SP", modelo: "55", ambiente: 2, servico: "status" }).autorizador,
    ).toBe("SP");
  });

  it("UF com operação fora do padrão usa o namespace certo (GO, evento da NFC-e)", () => {
    const ws = localizarWebservice({ uf: "GO", modelo: "65", ambiente: 1, servico: "evento" });
    expect(ws.wsdl).toBe("NFeRecepcaoEvento");
    expect(ws.namespace).toBe("http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento");
  });

  it("contingência SVC só para NF-e, no autorizador certo da UF", () => {
    const contingencia = CONTINGENCIA_DA_UF.RS;
    expect(contingencia).toBe("SVC-AN");
    const ws = localizarWebservice({
      uf: "RS",
      modelo: "55",
      ambiente: 2,
      servico: "autorizacao",
      contingencia,
    });
    expect(ws.autorizador).toBe("SVC-AN");
    expect(() =>
      localizarWebservice({
        uf: "RS",
        modelo: "65",
        ambiente: 2,
        servico: "autorizacao",
        contingencia,
      }),
    ).toThrow(/offline/);
  });

  it("serviço sem endereço dá erro explicando o que falta", () => {
    const catalogo = estenderCatalogo(
      { autorizadorDaUf: { "55": {}, "65": {} }, enderecos: { "55": {}, "65": {} } },
      {},
    );
    try {
      localizarWebservice({ uf: "RS", modelo: "65", ambiente: 2, servico: "status" }, catalogo);
      expect.unreachable();
    } catch (e) {
      expect((e as ErroFiscal).codigo).toBe("WEBSERVICE_NAO_CONFIGURADO");
      expect((e as ErroFiscal).message).toContain("RS");
    }
  });

  it("estenderCatalogo troca um endereço sem mexer no catálogo padrão", () => {
    const catalogo = estenderCatalogo(CATALOGO_PADRAO, {
      enderecos: { "65": { SVRS: { 2: { status: "https://exemplo.svrs/status" } } } },
    });
    expect(
      localizarWebservice({ uf: "SC", modelo: "65", ambiente: 2, servico: "status" }, catalogo).url,
    ).toBe("https://exemplo.svrs/status");
    expect(
      localizarWebservice({ uf: "SC", modelo: "65", ambiente: 2, servico: "status" }).url,
    ).not.toBe("https://exemplo.svrs/status");
    expect(
      localizarWebservice({ uf: "SC", modelo: "65", ambiente: 2, servico: "evento" }, catalogo).url,
    ).toMatch(/^https/);
  });
});

describe("SOAP", () => {
  it("monta envelope SOAP 1.2 sem cabeçalho", () => {
    expect(montarEnvelope("urn:ns", "<a/>")).toBe(
      '<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body><nfeDadosMsg xmlns="urn:ns"><a/></nfeDadosMsg></soap12:Body></soap12:Envelope>',
    );
  });

  it("lê retorno com e sem prefixo, mantendo valores como texto", () => {
    const comPrefixo =
      '<env:Envelope xmlns:env="http://www.w3.org/2003/05/soap-envelope"><env:Body><ns2:nfeResultMsg xmlns:ns2="urn:x"><retConsSitNFe><cStat>100</cStat><chNFe>43261048618635000183650010000001581103289798</chNFe><nProt>0143</nProt></retConsSitNFe></ns2:nfeResultMsg></env:Body></env:Envelope>';
    const r = lerRespostaSoap(comPrefixo, 200);
    expect(r.xmlRetorno).toMatch(/^<retConsSitNFe>/);
    expect(r.dados.retConsSitNFe).toEqual({
      cStat: "100",
      chNFe: "43261048618635000183650010000001581103289798",
      nProt: "0143",
    });
  });

  it("resposta 200 sem nfeResultMsg: não dá para saber o que aconteceu", () => {
    try {
      lerRespostaSoap("<html>manutencao</html>", 200);
      expect.unreachable();
    } catch (e) {
      expect((e as ErroFiscal).codigo).toBe("SEFAZ_RESPOSTA_INVALIDA");
      expect(podeTerSidoProcessado(e)).toBe(true);
    }
  });

  it("erro desconhecido é tratado como 'pode ter sido processado' (lado seguro)", () => {
    expect(podeTerSidoProcessado(new Error("x"))).toBe(true);
    expect(podeTerSidoProcessado(new ErroFiscal("X", "x", { podeTerSidoProcessado: false }))).toBe(
      false,
    );
  });
});
