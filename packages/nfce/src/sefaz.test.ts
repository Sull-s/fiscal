import { readFileSync } from "node:fs";
import { join } from "node:path";
import { abrirCertificadoA1 } from "@fiscal/certificado";
import { ErroFiscal } from "@fiscal/core";
import { assinarXml, validarContraXsd, verificarAssinaturas } from "@fiscal/xml";
import { describe, expect, it } from "vitest";
import {
  chaveDe,
  clienteFalso,
  digestDe,
  protNFe,
  retConsSitNFe,
  retEnviNFe,
} from "../../nfe-comum/testes/sefaz-falsa";
import { PASTA_FIXTURES, carregarFixturesAntigas } from "../testes/fixtures-antigas";
import { montarNfce } from "./montar";
import { autorizarNfce, cancelarNfce, consultarNfce, inutilizarNumeracao } from "./sefaz";

const certificado = abrirCertificadoA1(
  readFileSync(join(PASTA_FIXTURES, "certificado-teste.pfx")),
  "senha-teste",
);
const xsd = (nome: string) => join(PASTA_FIXTURES, "xsd", nome);
const entrada = carregarFixturesAntigas().find((f) => f.nome === "entrega-homologacao")!.entrada;
const xmlAssinado = assinarXml(montarNfce(entrada).xml, {
  certificado,
  elemento: "infNFe",
  perfil: "sefaz",
});
const chave = chaveDe(xmlAssinado);
const pedido = { uf: "RS" as const, ambiente: 2 as const, xmlAssinado };
const PROTOCOLO = "143260000123456";

const semResposta = () =>
  new ErroFiscal("SEFAZ_SEM_RESPOSTA", "A SEFAZ não respondeu em 30 segundos.", {
    podeTerSidoProcessado: true,
  });

describe("autorizarNfce", () => {
  it("autorizada: devolve protocolo e nfeProc válido no XSD, com a assinatura intacta", async () => {
    const { cliente, chamadas } = clienteFalso(() =>
      retEnviNFe(
        "104",
        "Lote processado",
        protNFe({
          chave,
          cStat: "100",
          xMotivo: "Autorizado o uso da NF-e",
          nProt: PROTOCOLO,
          digVal: digestDe(xmlAssinado),
        }),
      ),
    );
    const r = await autorizarNfce(cliente, pedido);

    expect(chamadas[0]?.servico).toBe("autorizacao");
    expect(chamadas[0]?.mensagem).toMatch(
      /^<enviNFe xmlns="[^"]+" versao="4.00"><idLote>\d{1,15}<\/idLote><indSinc>1<\/indSinc><NFe /,
    );
    expect(r).toMatchObject({ situacao: "autorizada", cStat: "100", protocolo: PROTOCOLO });
    expect(r.xmlProcessado).toMatch(
      /^<nfeProc xmlns="http:\/\/www.portalfiscal.inf.br\/nfe" versao="4.00"><NFe /,
    );
    expect((await validarContraXsd(r.xmlProcessado!, xsd("procNFe_v4.00.xsd"))).erros).toEqual([]);
    expect(verificarAssinaturas(r.xmlProcessado!).valida).toBe(true);
  });

  it("denegada: o XML com protocolo também deve ser guardado", async () => {
    const { cliente } = clienteFalso(() =>
      retEnviNFe(
        "104",
        "Lote processado",
        protNFe({
          chave,
          cStat: "301",
          xMotivo: "Uso Denegado: Irregularidade fiscal do emitente",
          nProt: PROTOCOLO,
        }),
      ),
    );
    const r = await autorizarNfce(cliente, pedido);
    expect(r.situacao).toBe("denegada");
    expect(r.xmlProcessado).toContain("<cStat>301</cStat>");
  });

  it("rejeitada na nota: sem nfeProc, motivo da SEFAZ preservado", async () => {
    const { cliente } = clienteFalso(() =>
      retEnviNFe(
        "104",
        "Lote processado",
        protNFe({ chave, cStat: "778", xMotivo: "Rejeicao: Informado NCM inexistente" }),
      ),
    );
    const r = await autorizarNfce(cliente, pedido);
    expect(r).toMatchObject({
      situacao: "rejeitada",
      cStat: "778",
      motivo: "Rejeicao: Informado NCM inexistente",
    });
    expect(r.xmlProcessado).toBeUndefined();
  });

  it("rejeitada no lote (ex.: 225 schema)", async () => {
    const { cliente } = clienteFalso(() =>
      retEnviNFe("225", "Rejeicao: Falha no Schema XML da NFe"),
    );
    expect(await autorizarNfce(cliente, pedido)).toMatchObject({
      situacao: "rejeitada",
      cStat: "225",
    });
  });

  it("539: número já usado com outra chave", async () => {
    const { cliente } = clienteFalso(() =>
      retEnviNFe(
        "104",
        "Lote processado",
        protNFe({
          chave,
          cStat: "539",
          xMotivo: "Rejeicao: Duplicidade de NF-e com diferenca na Chave de Acesso",
        }),
      ),
    );
    expect((await autorizarNfce(cliente, pedido)).situacao).toBe("numero-em-uso");
  });

  it("sem resposta: 'pendente', sem reenviar", async () => {
    const { cliente, chamadas } = clienteFalso(() => semResposta());
    const r = await autorizarNfce(cliente, pedido);
    expect(r.situacao).toBe("pendente");
    expect(r.motivo).toContain("não respondeu");
    expect(chamadas).toHaveLength(1);
  });

  it("sem conexão (nada chegou na SEFAZ): repassa o erro, porque é seguro tentar de novo", async () => {
    const { cliente } = clienteFalso(
      () =>
        new ErroFiscal("SEFAZ_SEM_CONEXAO", "Não consegui conectar", {
          podeTerSidoProcessado: false,
        }),
    );
    await expect(autorizarNfce(cliente, pedido)).rejects.toThrow("Não consegui conectar");
  });

  it("204 (já autorizada antes, ex.: reenvio após pendente): consulta e recupera o protocolo", async () => {
    const { cliente, chamadas } = clienteFalso((c) =>
      c.servico === "autorizacao"
        ? retEnviNFe(
            "104",
            "Lote processado",
            protNFe({ chave, cStat: "204", xMotivo: "Rejeicao: Duplicidade de NF-e" }),
          )
        : retConsSitNFe(
            "100",
            "Autorizado o uso da NF-e",
            protNFe({ chave, cStat: "100", xMotivo: "Autorizado o uso da NF-e", nProt: PROTOCOLO }),
          ),
    );
    const r = await autorizarNfce(cliente, pedido);
    expect(chamadas.map((c) => c.servico)).toEqual(["autorizacao", "consulta"]);
    expect(chamadas[1]?.mensagem).toContain(`<chNFe>${chave}</chNFe>`);
    expect(r).toMatchObject({ situacao: "autorizada", protocolo: PROTOCOLO });
    expect(r.xmlProcessado).toContain("<nfeProc");
  });

  it("103 (processamento assíncrono): busca o resultado pelo recibo", async () => {
    const { cliente, chamadas } = clienteFalso((c, i) => {
      if (c.servico === "autorizacao") {
        return retEnviNFe(
          "103",
          "Lote recebido com sucesso",
          "<infRec><nRec>431000012345678</nRec><tMed>1</tMed></infRec>",
        );
      }
      return i === 1
        ? '<retConsReciNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><cStat>105</cStat><xMotivo>Lote em processamento</xMotivo></retConsReciNFe>'
        : `<retConsReciNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><cStat>104</cStat><xMotivo>Lote processado</xMotivo>${protNFe({ chave, cStat: "100", xMotivo: "Autorizado o uso da NF-e", nProt: PROTOCOLO })}</retConsReciNFe>`;
    });
    const r = await autorizarNfce(cliente, { ...pedido, esperaReciboMs: 0 });
    expect(chamadas.map((c) => c.servico)).toEqual([
      "autorizacao",
      "retAutorizacao",
      "retAutorizacao",
    ]);
    expect(chamadas[1]?.mensagem).toContain("<nRec>431000012345678</nRec>");
    expect(r).toMatchObject({ situacao: "autorizada", protocolo: PROTOCOLO });
  });

  it("108 (SEFAZ paralisada): erro dizendo que nada foi processado", async () => {
    const { cliente } = clienteFalso(() => retEnviNFe("108", "Servico Paralisado Momentaneamente"));
    try {
      await autorizarNfce(cliente, pedido);
      expect.unreachable();
    } catch (e) {
      expect((e as ErroFiscal).codigo).toBe("SEFAZ_PARALISADA");
      expect((e as ErroFiscal).detalhes?.podeTerSidoProcessado).toBe(false);
    }
  });
});

describe("consultarNfce", () => {
  it("217: a SEFAZ nunca recebeu a nota", async () => {
    const { cliente } = clienteFalso(() =>
      retConsSitNFe("217", "Rejeicao: NF-e nao consta na base de dados da SEFAZ"),
    );
    expect((await consultarNfce(cliente, { uf: "RS", ambiente: 2, chave })).situacao).toBe(
      "nao-encontrada",
    );
  });

  it("cancelada: não confunde com autorizada, mesmo trazendo o protocolo original", async () => {
    const { cliente } = clienteFalso(() =>
      retConsSitNFe(
        "101",
        "Cancelamento de NF-e homologado",
        protNFe({ chave, cStat: "100", xMotivo: "Autorizado o uso da NF-e", nProt: PROTOCOLO }),
      ),
    );
    const r = await consultarNfce(cliente, { uf: "RS", ambiente: 2, chave, xmlNota: xmlAssinado });
    expect(r).toMatchObject({ situacao: "cancelada", cStat: "101", protocolo: PROTOCOLO });
    expect(r.xmlProcessado).toBeUndefined();
  });
});

describe("cancelarNfce", () => {
  it("assina, envia e devolve procEventoNFe válido no XSD", async () => {
    const { cliente, chamadas } = clienteFalso(
      () =>
        `<retEnvEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00"><idLote>1</idLote><tpAmb>2</tpAmb><verAplic>RS20260901</verAplic><cOrgao>43</cOrgao><cStat>128</cStat><xMotivo>Lote de Evento Processado</xMotivo>` +
        `<retEvento versao="1.00"><infEvento><tpAmb>2</tpAmb><verAplic>RS20260901</verAplic><cOrgao>43</cOrgao><cStat>135</cStat><xMotivo>Evento registrado e vinculado a NF-e</xMotivo><chNFe>${chave}</chNFe><tpEvento>110111</tpEvento><xEvento>Cancelamento registrado</xEvento><nSeqEvento>1</nSeqEvento><dhRegEvento>2026-10-09T14:50:00-03:00</dhRegEvento><nProt>143260000123457</nProt></infEvento></retEvento></retEnvEvento>`,
    );
    const r = await cancelarNfce(cliente, {
      uf: "RS",
      ambiente: 2,
      chave,
      protocolo: PROTOCOLO,
      justificativa: "Cliente desistiu da compra antes da entrega",
      documentoEmitente: "48618635000183",
      certificado,
    });
    expect(chamadas[0]?.servico).toBe("evento");
    expect(chamadas[0]?.mensagem).toMatch(/^<envEvento [^>]+><idLote>\d+<\/idLote><evento /);
    expect(r).toMatchObject({ registrado: true, cStat: "135", protocolo: "143260000123457" });
    expect(
      (await validarContraXsd(r.xmlProcessado!, xsd("procEventoCancNFe_v1.00.xsd"))).erros,
    ).toEqual([]);
    expect(verificarAssinaturas(r.xmlProcessado!).valida).toBe(true);
  });

  it("fora do prazo: não registrado, motivo da SEFAZ", async () => {
    const { cliente } = clienteFalso(
      () =>
        `<retEnvEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00"><cStat>128</cStat><xMotivo>Lote de Evento Processado</xMotivo><retEvento versao="1.00"><infEvento><cStat>501</cStat><xMotivo>Rejeicao: Prazo de cancelamento superior ao previsto na Legislacao</xMotivo></infEvento></retEvento></retEnvEvento>`,
    );
    const r = await cancelarNfce(cliente, {
      uf: "RS",
      ambiente: 2,
      chave,
      protocolo: PROTOCOLO,
      justificativa: "Cliente desistiu da compra antes da entrega",
      documentoEmitente: "48618635000183",
      certificado,
    });
    expect(r).toMatchObject({ registrado: false, cStat: "501" });
    expect(r.xmlProcessado).toBeUndefined();
  });
});

describe("inutilizarNumeracao", () => {
  it("102: devolve procInutNFe válido no XSD", async () => {
    const { cliente } = clienteFalso(
      () =>
        `<retInutNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><infInut><tpAmb>2</tpAmb><verAplic>RS20260901</verAplic><cStat>102</cStat><xMotivo>Inutilizacao de numero homologado</xMotivo><cUF>43</cUF><ano>26</ano><CNPJ>48618635000183</CNPJ><mod>65</mod><serie>1</serie><nNFIni>10</nNFIni><nNFFin>12</nNFFin><dhRecbto>2026-10-09T15:00:00-03:00</dhRecbto><nProt>143260000123458</nProt></infInut></retInutNFe>`,
    );
    const r = await inutilizarNumeracao(cliente, {
      uf: "RS",
      cnpj: "48618635000183",
      ambiente: 2,
      serie: 1,
      inicio: 10,
      fim: 12,
      ano: 2026,
      justificativa: "Numeros pulados por falha na transmissao",
      certificado,
    });
    expect(r).toMatchObject({ registrado: true, cStat: "102", protocolo: "143260000123458" });
    expect((await validarContraXsd(r.xmlProcessado!, xsd("procInutNFe_v4.00.xsd"))).erros).toEqual(
      [],
    );
  });
});
