import { createVerify } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { abrirCertificadoA1 } from "@fiscal/certificado";
import { ErroFiscal, decomporChaveAcesso } from "@fiscal/core";
import { montarCancelamento } from "@fiscal/nfe-comum";
import { assinarXml, validarContraXsd, verificarAssinaturas } from "@fiscal/xml";
import { describe, expect, it } from "vitest";
import { chaveDe, clienteFalso, protNFe, retEnviNFe } from "../../nfe-comum/testes/sefaz-falsa";
import { PASTA_FIXTURES, carregarFixturesAntigas } from "../testes/fixtures-antigas";
import { emitirNfce } from "./emitir";
import { montarNfce } from "./montar";
import { transmitirNfceOffline } from "./sefaz";

const certificado = abrirCertificadoA1(
  readFileSync(join(PASTA_FIXTURES, "certificado-teste.pfx")),
  "senha-teste",
);
const xsd = (nome: string) => join(PASTA_FIXTURES, "xsd", nome);
const fixtures = carregarFixturesAntigas();
const entrega = fixtures.find((f) => f.nome === "entrega-homologacao")!.entrada;
const balcao = fixtures.find((f) => f.nome === "balcao-dinheiro-troco")!.entrada;

const contingencia = {
  inicio: new Date("2026-10-09T17:50:00Z"),
  justificativa: "SEFAZ sem resposta / internet indisponivel",
};
const emissao = new Date("2026-10-09T18:00:00Z");

const offline = (entrada = balcao) =>
  montarNfce({
    ...entrada,
    nota: { ...entrada.nota, dataEmissao: emissao, contingencia },
    certificado,
  });

/** Parâmetros do QR Code (o que vem depois de "?p=") */
const parametros = (qr: string) => qr.split("?p=")[1]!.split("|");

describe("NFC-e em contingência offline", () => {
  it("tpEmis 9 na chave e no ide, com dhCont e xJust; assinada passa no XSD oficial", async () => {
    const nota = offline();
    expect(nota.offline).toBe(true);
    expect(decomporChaveAcesso(nota.chave).tipoEmissao).toBe(9);
    expect(nota.xml).toContain("<tpEmis>9</tpEmis>");
    expect(nota.xml).toContain(
      "<dhCont>2026-10-09T14:50:00-03:00</dhCont><xJust>SEFAZ sem resposta / internet indisponivel</xJust></ide>",
    );
    const assinado = assinarXml(nota.xml, { certificado, elemento: "infNFe", perfil: "sefaz" });
    expect(verificarAssinaturas(assinado).valida).toBe(true);
    expect((await validarContraXsd(assinado, xsd("nfe_v4.00.xsd"))).erros).toEqual([]);
  });

  it("QR Code v3 offline: dia, valor, sem destinatário e assinatura RSA-SHA1 conferível", () => {
    const nota = offline();
    const p = parametros(nota.qrCode);
    expect(p.slice(0, 7)).toEqual([nota.chave, "3", String(nota.ambiente), "09", "16.50", "", ""]);
    const assinado = p.slice(0, 7).join("|");
    const ok = createVerify("RSA-SHA1")
      .update(assinado)
      .verify(certificado.certificadoPem, p[7]!, "base64");
    expect(ok).toBe(true);
  });

  it("QR Code offline com destinatário identifica CPF (2) ou CNPJ (1)", () => {
    const p = parametros(offline(entrega).qrCode);
    const doc = entrega.venda.destinatario!.documento!.replace(/\D/g, "");
    expect(p[5]).toBe(doc.length === 14 ? "1" : "2");
    expect(p[6]).toBe(doc);
  });

  it("online continua igual: QR só com chave, versão e ambiente", () => {
    const nota = montarNfce({ ...balcao, certificado });
    expect(nota.offline).toBe(false);
    expect(parametros(nota.qrCode)).toHaveLength(3);
  });

  it("recusa contingência sem certificado, justificativa curta ou início depois da emissão", () => {
    const tentar = (c: typeof contingencia, comCertificado = true) => {
      try {
        montarNfce({
          ...balcao,
          nota: { ...balcao.nota, dataEmissao: emissao, contingencia: c },
          ...(comCertificado ? { certificado } : {}),
        });
      } catch (e) {
        return e as ErroFiscal;
      }
      throw new Error("deveria recusar");
    };
    expect(tentar(contingencia, false).codigo).toBe("NFCE_CONTINGENCIA_INVALIDA");
    expect(tentar({ ...contingencia, justificativa: "caiu" }).message).toContain("15 a 256");
    expect(tentar({ ...contingencia, inicio: new Date("2026-10-09T18:10:00Z") }).message).toContain(
      "depois da emissão",
    );
  });
});

describe("emitirNfce com contingência automática", () => {
  const base = {
    certificado,
    agora: emissao,
    emitente: entrega.emitente,
    venda: entrega.venda,
    nota: { ambiente: 2 as const, serie: 1 },
    contingencia: { justificativa: "SEFAZ indisponivel no momento da venda" },
  };
  const numeracao = (inicio: number) => {
    let n = inicio;
    return async () => n++;
  };
  const semConexao = () =>
    new ErroFiscal("SEFAZ_SEM_CONEXAO", "Não consegui conectar", { podeTerSidoProcessado: false });
  const semResposta = () =>
    new ErroFiscal("SEFAZ_SEM_RESPOSTA", "Não respondeu", { podeTerSidoProcessado: true });

  it("SEFAZ inacessível: sai offline com o MESMO número (a SEFAZ nunca recebeu)", async () => {
    const { cliente, chamadas } = clienteFalso(() => semConexao());
    const r = await emitirNfce({ ...base, cliente, proximoNumero: numeracao(10) });
    expect(chamadas).toHaveLength(1);
    expect(r.autorizacao.situacao).toBe("offline");
    expect(r.nota).toMatchObject({ numero: 10, offline: true });
    expect(r.xmlAssinado).toContain("<tpEmis>9</tpEmis>");
    expect(r.xmlAssinado).toContain("(SEFAZ_SEM_CONEXAO)</xJust>");
    expect(r.tentativaOnlinePendente).toBeUndefined();
    expect(verificarAssinaturas(r.xmlAssinado).valida).toBe(true);
  });

  it("sem resposta: offline com OUTRO número e devolve a tentativa online para conferir", async () => {
    const { cliente } = clienteFalso(() => semResposta());
    const r = await emitirNfce({ ...base, cliente, proximoNumero: numeracao(10) });
    expect(r.nota.numero).toBe(11);
    expect(r.tentativaOnlinePendente?.nota).toMatchObject({ numero: 10, offline: false });
  });

  it("data de emissão informada pelo sistema: a contingência não começa depois dela", async () => {
    const { cliente } = clienteFalso(() => semConexao());
    const r = await emitirNfce({
      ...base,
      cliente,
      nota: { ...base.nota, dataEmissao: new Date("2026-10-09T17:00:00Z") },
      proximoNumero: numeracao(30),
    });
    expect(r.autorizacao.situacao).toBe("offline");
    expect(r.xmlAssinado).toContain("<dhCont>2026-10-09T14:00:00-03:00</dhCont>");
  });

  it("SEFAZ paralisada (108): offline", async () => {
    const { cliente } = clienteFalso(() => retEnviNFe("108", "Servico Paralisado Momentaneamente"));
    const r = await emitirNfce({ ...base, cliente, proximoNumero: numeracao(1) });
    expect(r.autorizacao.situacao).toBe("offline");
    expect(r.nota.numero).toBe(1);
  });

  it("sem a opção de contingência, o erro sobe como antes", async () => {
    const { cliente } = clienteFalso(() => semConexao());
    const { contingencia: _, ...semOpcao } = base;
    await expect(
      emitirNfce({ ...semOpcao, cliente, proximoNumero: numeracao(1) }),
    ).rejects.toMatchObject({ codigo: "SEFAZ_SEM_CONEXAO" });
  });

  it("rejeição da SEFAZ não vira offline (o problema é da nota)", async () => {
    const { cliente } = clienteFalso((c) =>
      retEnviNFe(
        "104",
        "Lote processado",
        protNFe({ chave: chaveDe(c.mensagem), cStat: "225", xMotivo: "Falha no Schema" }),
      ),
    );
    const r = await emitirNfce({ ...base, cliente, proximoNumero: numeracao(1) });
    expect(r.autorizacao.situacao).toBe("rejeitada");
  });

  it("nota.contingencia já preenchida: offline direto, sem chamar a SEFAZ", async () => {
    const { cliente, chamadas } = clienteFalso(() => semConexao());
    const r = await emitirNfce({
      ...base,
      cliente,
      nota: { ...base.nota, contingencia },
      proximoNumero: numeracao(7),
    });
    expect(chamadas).toHaveLength(0);
    expect(r.nota).toMatchObject({ numero: 7, offline: true });
  });

  it("transmitirNfceOffline envia a mesma nota e recusa nota online", async () => {
    const { cliente: fora } = clienteFalso(() => semConexao());
    const r = await emitirNfce({ ...base, cliente: fora, proximoNumero: numeracao(3) });
    const { cliente, chamadas } = clienteFalso((c) =>
      retEnviNFe(
        "104",
        "Lote processado",
        protNFe({
          chave: chaveDe(c.mensagem),
          cStat: "100",
          xMotivo: "Autorizado o uso da NF-e",
          nProt: "143260000000999",
        }),
      ),
    );
    const t = await transmitirNfceOffline(cliente, {
      uf: "RS",
      ambiente: 2,
      xmlAssinado: r.xmlAssinado,
    });
    expect(t).toMatchObject({ situacao: "autorizada", protocolo: "143260000000999" });
    expect(chamadas[0]!.mensagem).toContain(r.xmlAssinado.replace(/^<\?xml[^>]*\?>/, ""));

    const online = assinarXml(montarNfce({ ...entrega, certificado }).xml, {
      certificado,
      elemento: "infNFe",
      perfil: "sefaz",
    });
    await expect(
      transmitirNfceOffline(cliente, { uf: "RS", ambiente: 2, xmlAssinado: online }),
    ).rejects.toMatchObject({ codigo: "NFCE_NAO_E_OFFLINE" });
  });
});

describe("cancelamento por substituição (110112)", () => {
  const original = montarNfce(balcao).chave;
  const substituta = offline().chave;

  it("monta o evento e passa no XSD oficial", async () => {
    const { xml, id } = montarCancelamento({
      chave: original,
      protocolo: "143260000000777",
      justificativa: "Nota substituida pela emitida em contingencia",
      documentoEmitente: balcao.emitente.cnpj,
      ambiente: 2,
      chaveSubstituta: substituta,
      dataEvento: emissao,
    });
    expect(id).toBe(`ID110112${original}01`);
    expect(xml).toContain("<tpEvento>110112</tpEvento>");
    expect(xml).toContain(`<chNFeRef>${substituta}</chNFeRef>`);
    const assinado = assinarXml(xml, { certificado, elemento: "infEvento", perfil: "sefaz" });
    expect((await validarContraXsd(assinado, xsd("eventoCancSubst_v1.00.xsd"))).erros).toEqual([]);
  });

  it("recusa substituta inválida ou igual à original", () => {
    const dados = {
      chave: original,
      protocolo: "143260000000777",
      justificativa: "Nota substituida pela emitida em contingencia",
      documentoEmitente: balcao.emitente.cnpj,
      ambiente: 2 as const,
    };
    expect(() => montarCancelamento({ ...dados, chaveSubstituta: original })).toThrow("substituta");
    expect(() => montarCancelamento({ ...dados, chaveSubstituta: "123" })).toThrow("substituta");
  });
});
