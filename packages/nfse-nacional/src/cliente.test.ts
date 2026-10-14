import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { abrirCertificadoA1 } from "@fiscal/certificado";
import { ErroFiscal } from "@fiscal/core";
import type { PedidoHttps } from "@fiscal/transporte";
import { verificarAssinaturas } from "@fiscal/xml";
import { describe, expect, it } from "vitest";
import { entradaReal } from "../testes/entrada-real";
import { criarClienteNfse } from "./cliente";
import { cancelarNfse, emitirNfse, resolverPendente } from "./emitir";

const FIXTURES = join(import.meta.dirname, "..", "testes", "fixtures");
const certificado = abrirCertificadoA1(
  readFileSync(join(FIXTURES, "certificado-teste.pfx")),
  "senha-teste",
);
const NFSE_REAL = readFileSync(join(FIXTURES, "antigo", "nfse-autorizada.xml"), "utf8");
const CHAVE = "43149022210440532000101000000000000126089303229430";
const agora = new Date("2026-10-09T18:00:00Z");

const gz = (s: string) => gzipSync(Buffer.from(s)).toString("base64");
const deGz = (s: string) => gunzipSync(Buffer.from(s, "base64")).toString("utf8");

/** Cliente com a rede trocada por respostas prontas. */
function cliente(responder: (p: PedidoHttps) => { statusHttp: number; corpo: unknown } | Error) {
  const pedidos: PedidoHttps[] = [];
  const c = criarClienteNfse({
    ambiente: 2,
    certificado,
    requisitar: async (p) => {
      pedidos.push(p);
      const r = responder(p);
      if (r instanceof Error) throw r;
      return {
        statusHttp: r.statusHttp,
        corpo: typeof r.corpo === "string" ? r.corpo : JSON.stringify(r.corpo),
      };
    },
  });
  return { c, pedidos };
}

// Certificado de teste é da 48.618.635/0001-83: o prestador precisa ser o mesmo
const entrada = () => {
  const e = entradaReal();
  return { ...e, prestador: { ...e.prestador, documento: "48618635000183" }, agora };
};

describe("emitirNfse", () => {
  it("autorizada: envia DPS assinada em gzip+base64 e devolve a NFS-e", async () => {
    const { c, pedidos } = cliente(() => ({
      statusHttp: 201,
      corpo: {
        tipoAmbiente: 2,
        versaoAplicativo: "SefinNacional_1.6.0",
        dataHoraProcessamento: "2026-08-28T08:09:12-03:00",
        idDps: "DPS…",
        chaveAcesso: CHAVE,
        nfseXmlGZipB64: gz(NFSE_REAL),
      },
    }));
    const r = await emitirNfse({ cliente: c, certificado, ...entrada() });

    expect(pedidos[0]).toMatchObject({
      metodo: "POST",
      url: "https://sefin.producaorestrita.nfse.gov.br/SefinNacional/nfse",
      prefixoErro: "NFSE",
    });
    const enviada = deGz(JSON.parse(pedidos[0]?.corpo ?? "{}").dpsXmlGZipB64);
    expect(enviada).toBe(r.xmlDpsAssinado);
    expect(enviada).toMatch(
      /<\/infDPS><Signature xmlns="http:\/\/www.w3.org\/2000\/09\/xmldsig#">/,
    );
    expect(verificarAssinaturas(enviada).valida).toBe(true);

    expect(r).toMatchObject({
      situacao: "autorizada",
      chave: CHAVE,
      dataProcessamento: "2026-08-28T08:09:12-03:00",
    });
    expect(r.xmlNfse).toBe(NFSE_REAL);
    expect(r.dps.id).toHaveLength(45);
  });

  it("rejeitada: lista de erros normalizada (Codigo/Descricao em qualquer caixa)", async () => {
    const { c } = cliente(() => ({
      statusHttp: 400,
      corpo: {
        erros: [
          {
            Codigo: "E0014",
            Descricao: "DPS já utilizada para gerar NFS-e",
            Complemento: "nDPS 1",
          },
          { codigo: "E0312", descricao: "Código de tributação inválido" },
        ],
      },
    }));
    const r = await emitirNfse({ cliente: c, certificado, ...entrada() });
    expect(r.situacao).toBe("rejeitada");
    expect(r.erros).toEqual([
      { codigo: "E0014", descricao: "DPS já utilizada para gerar NFS-e", complemento: "nDPS 1" },
      { codigo: "E0312", descricao: "Código de tributação inválido" },
    ]);
  });

  it("403 em HTML: explica que o certificado foi recusado", async () => {
    const { c } = cliente(() => ({ statusHttp: 403, corpo: "<html>403 Forbidden</html>" }));
    const r = await emitirNfse({ cliente: c, certificado, ...entrada() });
    expect(r.situacao).toBe("rejeitada");
    expect(r.erros[0]?.codigo).toBe("HTTP_403");
    expect(r.erros[0]?.descricao).toMatch(/certificado/);
  });

  it("sem resposta: 'pendente' e não reenvia", async () => {
    const { c, pedidos } = cliente(
      () => new ErroFiscal("NFSE_SEM_RESPOSTA", "sem resposta", { podeTerSidoProcessado: true }),
    );
    const r = await emitirNfse({ cliente: c, certificado, ...entrada() });
    expect(r.situacao).toBe("pendente");
    expect(pedidos).toHaveLength(1);
  });

  it("recusa certificado de outra empresa antes de enviar", async () => {
    const { c, pedidos } = cliente(() => ({ statusHttp: 500, corpo: "" }));
    await expect(
      emitirNfse({ cliente: c, certificado, ...entradaReal(), agora }),
    ).rejects.toMatchObject({
      codigo: "CERTIFICADO_DE_OUTRA_EMPRESA",
    });
    expect(pedidos).toHaveLength(0);
  });
});

describe("resolverPendente", () => {
  it("acha a chave pelo Id da DPS e baixa a NFS-e", async () => {
    const { c, pedidos } = cliente((p) =>
      p.url.includes("/dps/")
        ? { statusHttp: 200, corpo: { idDps: "x", chaveAcesso: CHAVE } }
        : { statusHttp: 200, corpo: { chaveAcesso: CHAVE, nfseXmlGZipB64: gz(NFSE_REAL) } },
    );
    const r = await resolverPendente(c, "DPS431490221044053200010100900000000000000001");
    expect(pedidos.map((p) => `${p.metodo} ${p.url.replace(/^.*SefinNacional/, "")}`)).toEqual([
      "GET /dps/DPS431490221044053200010100900000000000000001",
      `GET /nfse/${CHAVE}`,
    ]);
    expect(r).toMatchObject({ gerada: true, chave: CHAVE, xmlNfse: NFSE_REAL });
  });

  it("DPS não encontrada: não foi gerada, pode emitir de novo", async () => {
    const { c } = cliente(() => ({
      statusHttp: 404,
      corpo: { erros: [{ Codigo: "E404", Descricao: "DPS não encontrada" }] },
    }));
    expect(await resolverPendente(c, "DPS…")).toMatchObject({
      gerada: false,
      erros: [{ codigo: "E404" }],
    });
  });
});

describe("cancelarNfse", () => {
  it("assina o pedido (infPedReg) e envia para /nfse/{chave}/eventos", async () => {
    const { c, pedidos } = cliente(() => ({
      statusHttp: 201,
      corpo: { eventoXmlGZipB64: gz("<evento>ok</evento>") },
    }));
    const r = await cancelarNfse({
      cliente: c,
      certificado,
      agora,
      chave: CHAVE,
      ambiente: 2,
      versaoAplicativo: "teste",
      documentoAutor: "48618635000183",
      motivo: "Serviço não prestado",
      codigoMotivo: 2,
    });
    expect(pedidos[0]?.url).toMatch(new RegExp(`/nfse/${CHAVE}/eventos$`));
    const enviado = deGz(JSON.parse(pedidos[0]?.corpo ?? "{}").pedidoRegistroEventoXmlGZipB64);
    expect(enviado).toContain("<cMotivo>2</cMotivo>");
    expect(verificarAssinaturas(enviado).valida).toBe(true);
    expect(r).toMatchObject({ registrado: true, xmlEvento: "<evento>ok</evento>" });
  });
});
