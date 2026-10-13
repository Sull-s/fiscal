import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { abrirCertificadoA1 } from "@fiscal/certificado";
import { montarChaveAcesso } from "@fiscal/core";
import { type ChamadaPorUrl, type ClienteSefaz, lerXmlComoObjeto } from "@fiscal/transporte";
import { assinarXml, validarContraXsd } from "@fiscal/xml";
import { describe, expect, it } from "vitest";
import {
  consultarDistribuicao,
  montarConsultaDistribuicao,
  sincronizarDistribuicao,
} from "./distribuicao";
import { manifestar, montarManifestacao } from "./manifestacao";

const FIXTURES = join(import.meta.dirname, "..", "testes", "fixtures");
const xsd = (nome: string) => join(FIXTURES, "xsd", nome);
const certificado = abrirCertificadoA1(
  readFileSync(join(FIXTURES, "certificado-teste.pfx")),
  "senha-teste",
);
const NS = 'xmlns="http://www.portalfiscal.inf.br/nfe"';
const chave = montarChaveAcesso({
  uf: "SP",
  anoMes: "2610",
  documentoEmitente: "11222333000181",
  modelo: "55",
  serie: 1,
  numero: 9876,
  tipoEmissao: 1,
  codigoNumerico: "11223344",
});

/** Cliente que só responde chamarUrl, devolvendo o retorno pedido. */
function clienteDistribuicao(responder: (c: ChamadaPorUrl, i: number) => string) {
  const chamadas: ChamadaPorUrl[] = [];
  const cliente: ClienteSefaz = {
    chamar: () => Promise.reject(new Error("não usado")),
    consultarStatus: () => Promise.reject(new Error("não usado")),
    async chamarUrl(c) {
      chamadas.push(c);
      const xmlRetorno = responder(c, chamadas.length - 1);
      return {
        xmlRetorno,
        dados: lerXmlComoObjeto(xmlRetorno),
        url: c.url,
        statusHttp: 200,
        duracaoMs: 1,
      };
    },
    fechar: () => {},
  };
  return { cliente, chamadas };
}
const zip = (xml: string) => gzipSync(xml).toString("base64");
const resNFe = `<resNFe ${NS} versao="1.01"><chNFe>${chave}</chNFe><CNPJ>11222333000181</CNPJ><xNome>Fornecedor SP Ltda</xNome><IE>111222333444</IE><dhEmi>2026-10-10T10:00:00-03:00</dhEmi><tpNF>1</tpNF><vNF>1500.00</vNF><digVal>abc=</digVal><dhRecbto>2026-10-10T10:00:05-03:00</dhRecbto><nProt>135260000000001</nProt><cSitNFe>1</cSitNFe></resNFe>`;
const resEvento = `<resEvento ${NS} versao="1.01"><cOrgao>35</cOrgao><CNPJ>11222333000181</CNPJ><chNFe>${chave}</chNFe><dhEvento>2026-10-10T11:00:00-03:00</dhEvento><tpEvento>110111</tpEvento><nSeqEvento>1</nSeqEvento><xEvento>Cancelamento</xEvento><dhRecbto>2026-10-10T11:00:01-03:00</dhRecbto><nProt>135260000000002</nProt></resEvento>`;
const ret = (
  cStat: string,
  ultNSU: string,
  maxNSU: string,
  docs: [string, string, string][] = [],
) =>
  `<retDistDFeInt ${NS} versao="1.01"><tpAmb>2</tpAmb><verAplic>1.7.3</verAplic><cStat>${cStat}</cStat><xMotivo>${cStat === "138" ? "Documento localizado" : "Nenhum documento localizado"}</xMotivo><dhResp>2026-10-13T10:00:00-03:00</dhResp><ultNSU>${ultNSU}</ultNSU><maxNSU>${maxNSU}</maxNSU>${
    docs.length
      ? `<loteDistDFeInt>${docs.map(([nsu, schema, xml]) => `<docZip NSU="${nsu}" schema="${schema}">${zip(xml)}</docZip>`).join("")}</loteDistDFeInt>`
      : ""
  }</retDistDFeInt>`;

describe("distribuição DF-e", () => {
  it("as três formas de consulta passam no XSD oficial", async () => {
    for (const pedido of [{ ultNSU: "0" }, { nsu: "123" }, { chave }]) {
      const xml = montarConsultaDistribuicao({
        ambiente: 2,
        documento: "48.618.635/0001-83",
        uf: "RS",
        pedido,
      });
      expect((await validarContraXsd(xml, xsd("distDFeInt_v1.01.xsd"))).erros).toEqual([]);
    }
    expect(
      montarConsultaDistribuicao({
        ambiente: 1,
        documento: "48618635000183",
        pedido: { ultNSU: "42" },
      }),
    ).toContain("<distNSU><ultNSU>000000000000042</ultNSU></distNSU>");
  });

  it("chama o Ambiente Nacional, descompacta e classifica resumos e eventos", async () => {
    const { cliente, chamadas } = clienteDistribuicao(() =>
      ret("138", "000000000000002", "000000000000002", [
        ["000000000000001", "resNFe_v1.01.xsd", resNFe],
        ["000000000000002", "resEvento_v1.01.xsd", resEvento],
      ]),
    );
    const r = await consultarDistribuicao(cliente, {
      ambiente: 2,
      documento: "48618635000183",
      pedido: { ultNSU: "0" },
    });
    expect(chamadas[0]).toMatchObject({
      url: "https://hom1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx",
      operacao: "nfeDistDFeInteresse",
      idempotente: true,
    });
    expect(r).toMatchObject({ cStat: "138", ultNSU: "000000000000002", aguardar: false });
    expect(r.documentos[0]).toMatchObject({
      nsu: "000000000000001",
      tipo: "resumo-nfe",
      chave,
      emitente: { documento: "11222333000181", nome: "Fornecedor SP Ltda" },
      valor: 1500,
      situacaoNfe: "1",
    });
    expect(r.documentos[0]?.xml).toBe(resNFe);
    expect(r.documentos[1]).toMatchObject({
      tipo: "resumo-evento",
      evento: { tipo: "110111", descricao: "Cancelamento" },
    });
  });

  it("um documento só (o leitor devolve objeto, não lista) também funciona", async () => {
    const { cliente } = clienteDistribuicao(() =>
      ret("138", "5", "5", [["000000000000005", "resNFe_v1.01.xsd", resNFe]]),
    );
    const r = await consultarDistribuicao(cliente, {
      ambiente: 2,
      documento: "48618635000183",
      pedido: { nsu: "5" },
    });
    expect(r.documentos).toHaveLength(1);
  });

  it("sincroniza em várias chamadas até o maxNSU e para no 137 pedindo para esperar", async () => {
    const { cliente, chamadas } = clienteDistribuicao((c, i) =>
      i === 0
        ? ret("138", "000000000000001", "000000000000002", [
            ["000000000000001", "resNFe_v1.01.xsd", resNFe],
          ])
        : i === 1
          ? ret("138", "000000000000002", "000000000000002", [
              ["000000000000002", "resEvento_v1.01.xsd", resEvento],
            ])
          : ret("137", "000000000000002", "000000000000002"),
    );
    const r = await sincronizarDistribuicao(cliente, {
      ambiente: 2,
      documento: "48618635000183",
      ultNSU: "0",
    });
    expect(r).toMatchObject({ chamadas: 2, ultNSU: "000000000000002" });
    expect(r.documentos.map((d) => d.tipo)).toEqual(["resumo-nfe", "resumo-evento"]);
    expect(chamadas[1]?.mensagem).toContain("<ultNSU>000000000000001</ultNSU>");

    const nada = await sincronizarDistribuicao(cliente, {
      ambiente: 2,
      documento: "48618635000183",
      ultNSU: "2",
    });
    expect(nada).toMatchObject({
      cStat: "137",
      aguardar: true,
      documentos: [],
      ultNSU: "000000000000002",
    });
  });
});

describe("manifestação do destinatário", () => {
  const base = {
    chave,
    documento: "48618635000183",
    ambiente: 2 as const,
    dataEvento: new Date("2026-10-13T13:00:00Z"),
  };

  it("os quatro tipos passam no XSD oficial", async () => {
    for (const tipo of ["ciencia", "confirmacao", "desconhecimento", "nao-realizada"] as const) {
      const { xml } = montarManifestacao({
        ...base,
        tipo,
        justificativa: "Mercadoria nao foi entregue no endereco",
      });
      const assinado = assinarXml(xml, { certificado, elemento: "infEvento", perfil: "sefaz" });
      expect((await validarContraXsd(assinado, xsd("confRecebto_v1.00.xsd"))).erros).toEqual([]);
    }
    const { xml, id } = montarManifestacao({ ...base, tipo: "ciencia" });
    expect(id).toBe(`ID210210${chave}01`);
    expect(xml).toContain("<cOrgao>91</cOrgao>");
    expect(xml).not.toContain("xJust");
  });

  it("operação não realizada exige justificativa; NFC-e não tem manifestação", () => {
    expect(() => montarManifestacao({ ...base, tipo: "nao-realizada" })).toThrow("15 caracteres");
    const nfce = `${chave.slice(0, 20)}65${chave.slice(22)}`;
    expect(() => montarManifestacao({ ...base, chave: nfce, tipo: "ciencia" })).toThrow();
  });

  it("envia ao Ambiente Nacional", async () => {
    const { cliente, chamadas } = clienteDistribuicao(
      () =>
        `<retEnvEvento ${NS} versao="1.00"><idLote>1</idLote><tpAmb>2</tpAmb><verAplic>AN</verAplic><cOrgao>91</cOrgao><cStat>128</cStat><xMotivo>Lote de evento processado</xMotivo><retEvento versao="1.00"><infEvento><tpAmb>2</tpAmb><verAplic>AN</verAplic><cOrgao>91</cOrgao><cStat>135</cStat><xMotivo>Evento registrado e vinculado a NF-e</xMotivo><chNFe>${chave}</chNFe><tpEvento>210210</tpEvento><nSeqEvento>1</nSeqEvento><dhRegEvento>2026-10-13T10:00:01-03:00</dhRegEvento><nProt>891260000000001</nProt></infEvento></retEvento></retEnvEvento>`,
    );
    const r = await manifestar(cliente, { ...base, tipo: "ciencia", certificado });
    expect(chamadas[0]).toMatchObject({
      url: "https://hom1.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx",
      namespace: "http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4",
    });
    expect(r).toMatchObject({ registrado: true, protocolo: "891260000000001" });
  });
});
