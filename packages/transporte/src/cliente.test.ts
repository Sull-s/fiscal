import { ErroFiscal } from "@fiscal/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { gerarPkiDeTeste, respostaSoap, subirSefazFalsa } from "../testes/sefaz-falsa";
import { type RegistroChamada, criarClienteSefaz } from "./cliente";
import { podeTerSidoProcessado } from "./soap";
import { CATALOGO_PADRAO, estenderCatalogo } from "./webservices";

const pki = gerarPkiDeTeste();
const NS = "http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4";
const ACAO = `${NS}/nfeStatusServicoNF`;

function cliente(extra: Partial<Parameters<typeof criarClienteSefaz>[0]> = {}) {
  return criarClienteSefaz({
    certificado: { chavePrivadaPem: pki.cliente.chavePem, cadeiaPem: pki.cliente.certPem },
    autoridades: [pki.acPem],
    esperaEntreTentativasMs: 0,
    ...extra,
  });
}

async function capturarErro(promessa: Promise<unknown>): Promise<ErroFiscal> {
  try {
    await promessa;
  } catch (e) {
    expect(e).toBeInstanceOf(ErroFiscal);
    return e as ErroFiscal;
  }
  throw new Error("era para ter dado erro");
}

describe("chamada bem-sucedida", () => {
  let sefaz: Awaited<ReturnType<typeof subirSefazFalsa>>;
  beforeAll(async () => {
    sefaz = await subirSefazFalsa(pki, (_p, res) => {
      res.writeHead(200, { "Content-Type": "application/soap+xml" });
      res.end(
        respostaSoap(
          `<retConsStatServ versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><tpAmb>2</tpAmb><cStat>107</cStat><xMotivo>Servico em Operacao</xMotivo><cUF>43</cUF><dhRecbto>${new Date(Date.now() - 120_000).toISOString().replace(/\.\d+Z$/, "+00:00")}</dhRecbto><tMed>1</tMed></retConsStatServ>`,
        ),
      );
    });
  });
  afterAll(() => sefaz.fechar());

  it("envia SOAP 1.2 com action, autentica com o certificado e lê o retorno", async () => {
    const registros: RegistroChamada[] = [];
    const c = cliente({ aoRegistrar: (r) => registros.push(r) });
    const r = await c.chamarUrl({
      url: sefaz.url,
      namespace: NS,
      acao: ACAO,
      mensagem: "<consStatServ/>",
    });
    c.fechar();

    const pedido = sefaz.pedidos.at(-1);
    expect(pedido?.certificadoCliente).toBe("EMPRESA TESTE LTDA:48618635000183");
    expect(pedido?.contentType).toBe(`application/soap+xml; charset=utf-8; action="${ACAO}"`);
    expect(pedido?.corpo).toContain(
      `<soap12:Body><nfeDadosMsg xmlns="${NS}"><consStatServ/></nfeDadosMsg>`,
    );

    expect(r.statusHttp).toBe(200);
    expect(r.xmlRetorno).toMatch(/^<retConsStatServ versao="4.00"/);
    expect((r.dados.retConsStatServ as Record<string, string>).cStat).toBe("107");
    expect(registros).toHaveLength(1);
    expect(registros[0]?.resposta).toContain("<cStat>107</cStat>");
  });

  it("consultarStatus monta a mensagem, lê o retorno e mede o relógio", async () => {
    const catalogo = estenderCatalogo(CATALOGO_PADRAO, {
      enderecos: { "65": { RS: { 2: { status: sefaz.url } } } },
    });
    const c = cliente({ catalogo });
    const status = await c.consultarStatus({ uf: "RS", modelo: "65", ambiente: 2 });
    c.fechar();

    expect(sefaz.pedidos.at(-1)?.corpo).toContain(
      '<consStatServ xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><tpAmb>2</tpAmb><cUF>43</cUF><xServ>STATUS</xServ></consStatServ>',
    );
    expect(status.emOperacao).toBe(true);
    expect(status.cStat).toBe("107");
    expect(status.tempoMedioSegundos).toBe(1);
    // A SEFAZ falsa responde com o relógio 2 minutos atrasado em relação ao PC
    expect(status.diferencaRelogioSegundos).toBeGreaterThanOrEqual(119);
    expect(status.diferencaRelogioSegundos).toBeLessThanOrEqual(121);
  });

  it("recusa servidor com certificado de AC desconhecida, sem enviar nada", async () => {
    const antes = sefaz.pedidos.length;
    const c = cliente({ autoridades: [], tentativas: 1 });
    const erro = await capturarErro(
      c.chamarUrl({
        url: sefaz.url,
        namespace: NS,
        acao: ACAO,
        mensagem: "<x/>",
        servico: "autorizacao",
      }),
    );
    c.fechar();
    expect(erro.codigo).toBe("SEFAZ_SEM_CONEXAO");
    expect(podeTerSidoProcessado(erro)).toBe(false);
    expect(sefaz.pedidos.length).toBe(antes);
  });
});

describe("falhas e nova tentativa segura", () => {
  it("SOAP Fault: erro claro e sem nova tentativa", async () => {
    const sefaz = await subirSefazFalsa(pki, (_p, res) => {
      res.writeHead(500, { "Content-Type": "application/soap+xml" });
      res.end(
        '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><soap:Fault><soap:Code><soap:Value>soap:Receiver</soap:Value></soap:Code><soap:Reason><soap:Text xml:lang="pt">Servidor indisponivel</soap:Text></soap:Reason></soap:Fault></soap:Body></soap:Envelope>',
      );
    });
    const c = cliente();
    const erro = await capturarErro(
      c.chamarUrl({
        url: sefaz.url,
        namespace: NS,
        acao: ACAO,
        mensagem: "<x/>",
        servico: "status",
      }),
    );
    c.fechar();
    await sefaz.fechar();
    expect(erro.codigo).toBe("SEFAZ_FAULT");
    expect(erro.message).toContain("Servidor indisponivel");
    expect(sefaz.pedidos).toHaveLength(1);
  });

  it("HTTP 403 sem SOAP vira erro de HTTP", async () => {
    const sefaz = await subirSefazFalsa(pki, (_p, res) => {
      res.writeHead(403, { "Content-Type": "text/html" });
      res.end("<html>Forbidden</html>");
    });
    const c = cliente({ tentativas: 1 });
    const erro = await capturarErro(
      c.chamarUrl({ url: sefaz.url, namespace: NS, acao: ACAO, mensagem: "<x/>" }),
    );
    c.fechar();
    await sefaz.fechar();
    expect(erro.codigo).toBe("SEFAZ_HTTP");
    expect(erro.message).toContain("403");
    expect(podeTerSidoProcessado(erro)).toBe(false);
  });

  describe("SEFAZ que recebe e não responde", () => {
    let sefaz: Awaited<ReturnType<typeof subirSefazFalsa>>;
    beforeAll(async () => {
      sefaz = await subirSefazFalsa(pki, () => {
        /* nunca responde */
      });
    });
    afterAll(() => sefaz.fechar());

    it("autorização: NÃO repete (a nota pode ter sido autorizada) e avisa para consultar", async () => {
      const antes = sefaz.pedidos.length;
      const c = cliente({ timeoutMs: 300, tentativas: 3 });
      const erro = await capturarErro(
        c.chamarUrl({
          url: sefaz.url,
          namespace: NS,
          acao: ACAO,
          mensagem: "<x/>",
          servico: "autorizacao",
        }),
      );
      c.fechar();
      expect(erro.codigo).toBe("SEFAZ_SEM_RESPOSTA");
      expect(podeTerSidoProcessado(erro)).toBe(true);
      expect(sefaz.pedidos.length - antes).toBe(1);
    });

    it("status: repete até o limite, porque consultar é seguro", async () => {
      const antes = sefaz.pedidos.length;
      const c = cliente({ timeoutMs: 300, tentativas: 3 });
      await capturarErro(
        c.chamarUrl({
          url: sefaz.url,
          namespace: NS,
          acao: ACAO,
          mensagem: "<x/>",
          servico: "status",
        }),
      );
      c.fechar();
      expect(sefaz.pedidos.length - antes).toBe(3);
    });
  });

  it("SEFAZ fora do ar (conexão recusada): repete até na autorização, porque nada chegou lá", async () => {
    const sefaz = await subirSefazFalsa(pki, () => {});
    const url = sefaz.url;
    await sefaz.fechar();

    const registros: RegistroChamada[] = [];
    const c = cliente({ tentativas: 3, aoRegistrar: (r) => registros.push(r) });
    const erro = await capturarErro(
      c.chamarUrl({ url, namespace: NS, acao: ACAO, mensagem: "<x/>", servico: "autorizacao" }),
    );
    c.fechar();
    expect(erro.codigo).toBe("SEFAZ_SEM_CONEXAO");
    expect(podeTerSidoProcessado(erro)).toBe(false);
    expect(registros.map((r) => r.tentativa)).toEqual([1, 2, 3]);
    expect(registros.every((r) => r.erro?.codigo === "SEFAZ_SEM_CONEXAO")).toBe(true);
  });
});
