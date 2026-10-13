import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { armazemArquivosEmMemoria } from "@fiscal/armazenamento";
import { ErroFiscal } from "@fiscal/core";
import { criarClienteNfse } from "@fiscal/nfse-nacional";
import { armazemEmMemoria } from "@fiscal/numeracao";
import { type ClienteSefaz, lerXmlComoObjeto } from "@fiscal/transporte";
import { unzipSync } from "fflate";
import { beforeAll, describe, expect, it } from "vitest";
import { criarServico } from "./app";
import { criarCofre, gerarChaveMestra } from "./cofre";
import { repositorioEmpresasEmArquivos } from "./empresas";
import { verificarWebhook } from "./webhooks";

const TESTES = join(import.meta.dirname, "..", "testes");
const PFX = readFileSync(join(TESTES, "certificado-teste.pfx")).toString("base64");
const NFSE_REAL = readFileSync(join(TESTES, "nfse-autorizada.xml"), "utf8");
const CHAVE_NFSE = "43149022210440532000101000000000000126089303229430";
const ADMIN = "token-admin-de-teste-bem-comprido";
const NS = 'xmlns="http://www.portalfiscal.inf.br/nfe"';

/** SEFAZ simulada: o comportamento da próxima autorização é escolhido pelo teste. */
let proximaAutorizacao: "100" | "778" | "sem-resposta" | "sem-conexao" = "100";
const chamadasSefaz: string[] = [];
const eventosEnviados: string[] = [];
const chaveDe = (xml: string) =>
  /Id="NFe(\d{44})"|<chNFe>(\d{44})<\/chNFe>/.exec(xml)?.slice(1).find(Boolean) ?? "";
const prot = (chave: string, cStat: string, xMotivo: string, nProt = "143260000000001") =>
  `<protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><verAplic>RS</verAplic><chNFe>${chave}</chNFe><dhRecbto>2026-10-09T14:00:00-03:00</dhRecbto><nProt>${nProt}</nProt><cStat>${cStat}</cStat><xMotivo>${xMotivo}</xMotivo></infProt></protNFe>`;

const sefazFalsa: ClienteSefaz = {
  async chamar({ servico, mensagem }) {
    chamadasSefaz.push(servico);
    const chave = chaveDe(mensagem);
    let xml = "";
    if (servico === "autorizacao") {
      if (proximaAutorizacao === "sem-conexao") {
        throw new ErroFiscal("SEFAZ_SEM_CONEXAO", "Não consegui conectar na SEFAZ.", {
          podeTerSidoProcessado: false,
        });
      }
      if (proximaAutorizacao === "sem-resposta") {
        throw new ErroFiscal("SEFAZ_SEM_RESPOSTA", "A SEFAZ não respondeu.", {
          podeTerSidoProcessado: true,
        });
      }
      xml =
        proximaAutorizacao === "100"
          ? `<retEnviNFe ${NS} versao="4.00"><cStat>104</cStat><xMotivo>Lote processado</xMotivo>${prot(chave, "100", "Autorizado o uso da NF-e")}</retEnviNFe>`
          : `<retEnviNFe ${NS} versao="4.00"><cStat>104</cStat><xMotivo>Lote processado</xMotivo>${prot(chave, "778", "Rejeicao: NCM inexistente")}</retEnviNFe>`;
    } else if (servico === "consulta") {
      xml = `<retConsSitNFe ${NS} versao="4.00"><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo>${prot(chave, "100", "Autorizado o uso da NF-e", "143260000000099")}</retConsSitNFe>`;
    } else if (servico === "evento") {
      eventosEnviados.push(mensagem);
      xml = `<retEnvEvento ${NS} versao="1.00"><cStat>128</cStat><xMotivo>Lote de Evento Processado</xMotivo><retEvento versao="1.00"><infEvento><tpAmb>2</tpAmb><verAplic>RS</verAplic><cOrgao>43</cOrgao><cStat>135</cStat><xMotivo>Evento registrado</xMotivo><chNFe>${chave}</chNFe><tpEvento>110111</tpEvento><nSeqEvento>1</nSeqEvento><dhRegEvento>2026-10-09T14:10:00-03:00</dhRegEvento><nProt>143260000000002</nProt></infEvento></retEvento></retEnvEvento>`;
    } else if (servico === "status") {
      xml = `<retConsStatServ ${NS} versao="4.00"><cStat>107</cStat><xMotivo>Servico em Operacao</xMotivo><dhRecbto>${new Date().toISOString().replace(/\.\d+Z$/, "+00:00")}</dhRecbto><tMed>1</tMed></retConsStatServ>`;
    }
    return {
      xmlRetorno: xml,
      dados: lerXmlComoObjeto(xml),
      url: "falsa",
      statusHttp: 200,
      duracaoMs: 1,
    };
  },
  chamarUrl: () => Promise.reject(new Error("não usado")),
  async consultarStatus(p) {
    const r = await sefazFalsa.chamar({ ...p, servico: "status", mensagem: "" });
    const s = (r.dados.retConsStatServ ?? {}) as Record<string, string>;
    return {
      emOperacao: s.cStat === "107",
      cStat: s.cStat ?? "",
      xMotivo: s.xMotivo ?? "",
      tempoMedioSegundos: 1,
      dhRecbto: s.dhRecbto ?? null,
      diferencaRelogioSegundos: 0,
    };
  },
  fechar: () => {},
};

const emitente = {
  cnpj: "48618635000183",
  inscricaoEstadual: "0960000000",
  razaoSocial: "Rosemeri Teresinha Muller Correa",
  nomeFantasia: "Comida Caseira da Rose",
  crt: 4,
  endereco: {
    logradouro: "Av. Mãe Apolinária Matias Batista",
    numero: "39",
    bairro: "Morro Santana",
    codigoMunicipio: "4314902",
    municipio: "Porto Alegre",
    uf: "RS",
    cep: "91450510",
  },
};
const venda = {
  itens: [
    {
      codigo: "P1",
      descricao: "Prato feito",
      ncm: "21069090",
      cfop: "5102",
      quantidade: 1,
      valorUnitario: 28,
    },
  ],
  pagamentos: [{ forma: "dinheiro", valor: 30 }],
};

const cofre = criarCofre(gerarChaveMestra());
const arquivos = armazemArquivosEmMemoria();
/** Webhooks recebidos pelo "sistema do cliente" simulado */
const recebidos: { url: string; corpo: string; cabecalhos: Record<string, string> }[] = [];
let respostaWebhook = 200;
const { app, executarRotinas, ctx } = criarServico({
  enviarWebhook: async (p) => {
    recebidos.push(p);
    return respostaWebhook;
  },
  cofre,
  empresas: repositorioEmpresasEmArquivos(arquivos),
  arquivos,
  numeracao: armazemEmMemoria(),
  tokenAdmin: ADMIN,
  fabricaSefaz: () => sefazFalsa,
  fabricaNfse: (certificado, ambiente) =>
    criarClienteNfse({
      certificado,
      ambiente,
      requisitar: async (p) => {
        if (p.url.endsWith("/nfse") && p.metodo === "POST") {
          return {
            statusHttp: 201,
            corpo: JSON.stringify({
              chaveAcesso: CHAVE_NFSE,
              nfseXmlGZipB64: gzipSync(NFSE_REAL).toString("base64"),
            }),
          };
        }
        if (p.url.endsWith("/eventos"))
          return {
            statusHttp: 201,
            corpo: JSON.stringify({ eventoXmlGZipB64: gzipSync("<evento/>").toString("base64") }),
          };
        return { statusHttp: 404, corpo: "{}" };
      },
    }),
});

const req = (
  metodo: string,
  caminho: string,
  token?: string,
  corpo?: unknown,
  extra: Record<string, string> = {},
) =>
  app.request(caminho, {
    method: metodo,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(corpo ? { "Content-Type": "application/json" } : {}),
      ...extra,
    },
    ...(corpo ? { body: JSON.stringify(corpo) } : {}),
  });

let chaveApi = "";

beforeAll(async () => {
  await req("PUT", "/v1/admin/empresas/rose", ADMIN, {
    nome: "Comida Caseira da Rose",
    cnpj: "48618635000183",
    ambiente: 2,
    nfce: { emitente, serie: "1", versaoAplicativo: "Teste API" },
    nfse: { prestador: { documento: "48618635000183", regime: { opcaoSimples: 2 } }, serie: "900" },
  });
  await req("PUT", "/v1/admin/empresas/rose/certificado", ADMIN, {
    pfxBase64: PFX,
    senha: "senha-teste",
  });
  chaveApi = (
    (await (await req("POST", "/v1/admin/empresas/rose/chaves", ADMIN)).json()) as { chave: string }
  ).chave;
});

describe("administração e segurança", () => {
  it("saúde é aberta; admin exige token", async () => {
    expect((await req("GET", "/saude")).status).toBe(200);
    expect((await req("GET", "/v1/admin/empresas")).status).toBe(401);
    expect((await req("GET", "/v1/admin/empresas", "errado")).status).toBe(401);
  });

  it("certificado de outra empresa é recusado no cadastro", async () => {
    await req("PUT", "/v1/admin/empresas/padaria", ADMIN, {
      nome: "Padaria",
      cnpj: "11222333000181",
      ambiente: 2,
    });
    const r = await req("PUT", "/v1/admin/empresas/padaria/certificado", ADMIN, {
      pfxBase64: PFX,
      senha: "senha-teste",
    });
    expect(r.status).toBe(409);
    expect(((await r.json()) as { erro: { codigo: string } }).erro.codigo).toBe(
      "CERTIFICADO_DE_OUTRA_EMPRESA",
    );
  });

  it("nenhum segredo sai pela API nem fica legível no cadastro", async () => {
    const corpo = await (await req("GET", "/v1/empresa", chaveApi)).text();
    expect(corpo).toContain("EMPRESA TESTE LTDA");
    expect(corpo).not.toMatch(/pfx|senha-teste|hash/i);
    const salvo = new TextDecoder().decode(arquivos.arquivos.get("_empresas/rose.json"));
    expect(salvo).not.toContain("senha-teste");
    expect(salvo).not.toContain(chaveApi);
    expect(salvo).toMatch(/"pfx": "v1:/);
  });

  it("chave inválida, ausente ou de formato errado: 401", async () => {
    expect((await req("GET", "/v1/empresa")).status).toBe(401);
    expect((await req("GET", "/v1/empresa", `${chaveApi}x`)).status).toBe(401);
    expect(
      (await req("GET", "/v1/empresa", chaveApi.replace("fsk_rose", "fsk_padaria"))).status,
    ).toBe(401);
  });
});

describe("NFC-e pela API", () => {
  let chave = "";

  it("emite, guarda o XML e responde com QR Code; Idempotency-Key não emite duas vezes", async () => {
    proximaAutorizacao = "100";
    const antes = chamadasSefaz.length;
    const r = await req(
      "POST",
      "/v1/nfce",
      chaveApi,
      { venda, referencia: "pedido-1" },
      { "Idempotency-Key": "pedido-1" },
    );
    expect(r.status).toBe(201);
    const corpo = (await r.json()) as Record<string, unknown>;
    expect(corpo).toMatchObject({
      numero: 1,
      serie: "1",
      situacao: "autorizada",
      valorTotal: 28,
      troco: 2,
    });
    chave = String(corpo.chave);

    const repetido = await req(
      "POST",
      "/v1/nfce",
      chaveApi,
      { venda },
      { "Idempotency-Key": "pedido-1" },
    );
    expect(await repetido.json()).toEqual(corpo);
    expect(chamadasSefaz.length - antes).toBe(1);
  });

  it("consulta, XML, DANFE em texto e ESC/POS", async () => {
    expect(await (await req("GET", `/v1/nfce/${chave}`, chaveApi)).json()).toMatchObject({
      situacao: "autorizada",
      numero: 1,
    });
    expect(await (await req("GET", `/v1/nfce/${chave}/xml`, chaveApi)).text()).toMatch(
      /^<nfeProc /,
    );
    const texto = await (
      await req("GET", `/v1/nfce/${chave}/danfe?formato=texto`, chaveApi)
    ).text();
    expect(texto).toContain("Protocolo de autorização: 143260000000001");
    const escpos = new Uint8Array(
      await (
        await req("GET", `/v1/nfce/${chave}/danfe?formato=escpos&papel=58`, chaveApi)
      ).arrayBuffer(),
    );
    expect(Buffer.from(escpos.subarray(0, 2)).toString("hex")).toBe("1b40");
  });

  it("rejeitada: 422 e o número volta para a próxima emissão", async () => {
    proximaAutorizacao = "778";
    const r = await req("POST", "/v1/nfce", chaveApi, { venda });
    expect(r.status).toBe(422);
    expect(await r.json()).toMatchObject({ numero: 2, situacao: "rejeitada", cStat: "778" });
    proximaAutorizacao = "100";
    expect(await (await req("POST", "/v1/nfce", chaveApi, { venda })).json()).toMatchObject({
      numero: 2,
      situacao: "autorizada",
    });
  });

  it("venda inválida: 422 com a lista de problemas e o número não é perdido", async () => {
    const r = await req("POST", "/v1/nfce", chaveApi, {
      venda: { ...venda, itens: [{ ...venda.itens[0], ncm: "1" }] },
    });
    expect(r.status).toBe(422);
    expect(((await r.json()) as { erro: { codigo: string } }).erro.codigo).toBe(
      "NFCE_VENDA_INVALIDA",
    );
    const situacao = (await (await req("GET", "/v1/numeracao/65", chaveApi)).json()) as {
      liberados: number[];
    };
    expect(situacao.liberados).toEqual([3]);
  });

  it("sem resposta da SEFAZ: 202 pendente, e a consulta resolve depois", async () => {
    proximaAutorizacao = "sem-resposta";
    const r = await req("POST", "/v1/nfce", chaveApi, { venda });
    expect(r.status).toBe(202);
    const { chave: pendente } = (await r.json()) as { chave: string };
    proximaAutorizacao = "100";
    expect(await (await req("GET", `/v1/nfce/${pendente}`, chaveApi)).json()).toMatchObject({
      situacao: "autorizada",
      protocolo: "143260000000099",
    });
    expect(await (await req("GET", `/v1/nfce/${pendente}/xml`, chaveApi)).text()).toMatch(
      /^<nfeProc /,
    );
  });

  it("cancela e o DANFE passa a mostrar NOTA CANCELADA", async () => {
    const r = await req("POST", `/v1/nfce/${chave}/cancelamento`, chaveApi, {
      justificativa: "Cliente desistiu da compra",
    });
    expect(await r.json()).toMatchObject({
      situacao: "cancelada",
      protocoloCancelamento: "143260000000002",
    });
    expect(
      await (await req("GET", `/v1/nfce/${chave}/danfe?formato=texto`, chaveApi)).text(),
    ).toContain("NOTA CANCELADA");
  });

  it("status da SEFAZ", async () => {
    expect(await (await req("GET", "/v1/sefaz/status", chaveApi)).json()).toMatchObject({
      emOperacao: true,
      cStat: "107",
    });
  });
});

describe("NFC-e em contingência offline pela API", () => {
  type Resposta = { chave: string; numero: number; situacao: string; substitui?: string };
  const emitir = async () => {
    const r = await req("POST", "/v1/nfce", chaveApi, { venda });
    return { status: r.status, corpo: (await r.json()) as Resposta };
  };

  it("sem a opção no cadastro, SEFAZ fora do ar continua dando 503", async () => {
    proximaAutorizacao = "sem-conexao";
    const r = await req("POST", "/v1/nfce", chaveApi, { venda });
    expect(r.status).toBe(503);
  });

  it("com a opção: sai offline (202), DANFE de contingência e transmissão depois", async () => {
    await req("PUT", "/v1/admin/empresas/rose", ADMIN, {
      nfce: { emitente, serie: "1", versaoAplicativo: "Teste API", contingenciaOffline: true },
    });
    proximaAutorizacao = "sem-conexao";
    const { status, corpo } = await emitir();
    expect(status).toBe(202);
    expect(corpo.situacao).toBe("offline");
    expect(corpo.chave.slice(34, 35)).toBe("9");

    const danfe = await (
      await req("GET", `/v1/nfce/${corpo.chave}/danfe?formato=texto&via=estabelecimento`, chaveApi)
    ).text();
    expect(danfe).toContain("EMITIDA EM CONTINGÊNCIA");
    expect(danfe).toContain("VIA DO ESTABELECIMENTO");
    expect(await (await req("GET", "/v1/nfce/offline", chaveApi)).json()).toEqual({
      chaves: [corpo.chave],
    });

    // SEFAZ ainda fora: nada muda
    const ainda = await (await req("POST", "/v1/nfce/offline/transmitir", chaveApi)).json();
    expect(ainda).toMatchObject({ restantes: 1, transmitidas: [{ situacao: "offline" }] });

    proximaAutorizacao = "100";
    const t = await (await req("POST", "/v1/nfce/offline/transmitir", chaveApi)).json();
    expect(t).toEqual({
      transmitidas: [
        { chave: corpo.chave, situacao: "autorizada", motivo: "Autorizado o uso da NF-e" },
      ],
      restantes: 0,
    });
    expect(await (await req("GET", `/v1/nfce/${corpo.chave}/xml`, chaveApi)).text()).toMatch(
      /^<nfeProc /,
    );
  });

  it("sem resposta: offline com outro número e a tentativa online é cancelada por substituição", async () => {
    proximaAutorizacao = "sem-resposta";
    const { status, corpo } = await emitir();
    expect(status).toBe(202);
    expect(corpo.situacao).toBe("offline");
    const original = corpo.substitui!;
    expect(original).toMatch(/^\d{44}$/);
    expect(await (await req("GET", `/v1/nfce/${original}`, chaveApi)).json()).toMatchObject({
      situacao: "autorizada", // a SEFAZ falsa diz que a online foi autorizada
      substituidaPor: corpo.chave,
    });

    proximaAutorizacao = "100";
    await req("POST", "/v1/nfce/offline/transmitir", chaveApi);
    expect(eventosEnviados.at(-1)).toContain("<tpEvento>110112</tpEvento>");
    expect(eventosEnviados.at(-1)).toContain(`<chNFeRef>${corpo.chave}</chNFeRef>`);
    expect(await (await req("GET", `/v1/nfce/${original}`, chaveApi)).json()).toMatchObject({
      situacao: "cancelada",
    });
    await req("PUT", "/v1/admin/empresas/rose", ADMIN, {
      nfce: { emitente, serie: "1", versaoAplicativo: "Teste API" },
    });
  });
});

describe("NFS-e pela API", () => {
  it("emite, consulta pela chave, gera o DANFSE e cancela", async () => {
    const r = await req("POST", "/v1/nfse", chaveApi, {
      tomador: { documento: "45465512000161", nome: "VISTO PRATICO LTDA" },
      servico: {
        codigoMunicipioPrestacao: "4314902",
        codigoTributacaoNacional: "090201",
        descricao: "Assessoria",
      },
      valores: { valorServico: 40 },
    });
    expect(r.status).toBe(201);
    expect(await r.json()).toMatchObject({
      chave: CHAVE_NFSE,
      numeroDps: 1,
      situacao: "autorizada",
    });

    expect(await (await req("GET", `/v1/nfse/${CHAVE_NFSE}`, chaveApi)).json()).toMatchObject({
      situacao: "autorizada",
      chave: CHAVE_NFSE,
    });
    const pdf = await req("GET", `/v1/nfse/${CHAVE_NFSE}/danfse`, chaveApi);
    expect(pdf.headers.get("Content-Type")).toBe("application/pdf");
    expect(
      Buffer.from(await pdf.arrayBuffer())
        .subarray(0, 5)
        .toString(),
    ).toBe("%PDF-");

    const cancelada = await req("POST", `/v1/nfse/${CHAVE_NFSE}/cancelamento`, chaveApi, {
      motivo: "Serviço não prestado",
      codigoMotivo: 2,
    });
    expect(await cancelada.json()).toMatchObject({ situacao: "cancelada" });
  });
});

describe("arquivos para o contador", () => {
  it("ZIP do mês com NFC-e, eventos e NFS-e da homologação", async () => {
    const agora = new Date();
    const r = await req(
      "GET",
      `/v1/arquivos/${agora.getFullYear()}/${agora.getMonth() + 1}?ambiente=2`,
      chaveApi,
    );
    expect(r.headers.get("Content-Type")).toBe("application/zip");
    const nomes = Object.keys(unzipSync(new Uint8Array(await r.arrayBuffer())));
    expect(nomes).toContain("manifesto.json");
    // 3 notas online + 2 offline + a tentativa online que foi substituída
    expect(nomes.filter((n) => n.startsWith("65/") && !n.includes("evento"))).toHaveLength(6);
    expect(nomes.some((n) => n.includes("evento-cancelamento"))).toBe(true);
    expect(nomes).toContain(`nfse/${CHAVE_NFSE}.xml`);
  });
});

describe("NF-e pela API", () => {
  const operacao = {
    destinatario: {
      documento: "11222333000181",
      nome: "Loja Cliente Ltda",
      indicadorIe: 1,
      inscricaoEstadual: "0240000000",
      endereco: {
        logradouro: "Rua dos Andradas",
        numero: "500",
        bairro: "Centro",
        codigoMunicipio: "4314902",
        municipio: "Porto Alegre",
        uf: "RS",
      },
    },
    itens: [
      {
        codigo: "CAD-01",
        descricao: "Cadeira",
        ncm: "94013000",
        cfop: "5102",
        quantidade: 2,
        valorUnitario: 250,
        tributacao: { icms: { csosn: "102" }, pis: { cst: "99" }, cofins: { cst: "99" } },
      },
    ],
    pagamentos: [{ forma: "boleto", valor: 500, aPrazo: true }],
  };
  let chave = "";

  it("sem cadastro de NF-e: 409", async () => {
    const r = await req("POST", "/v1/nfe", chaveApi, {
      operacao,
      nota: { naturezaOperacao: "Venda" },
    });
    expect(r.status).toBe(409);
  });

  it("emite, devolve XML e DANFE em PDF", async () => {
    await req("PUT", "/v1/admin/empresas/rose", ADMIN, {
      nfe: { emitente: { ...emitente, crt: 1 }, serie: "1", versaoAplicativo: "Teste API" },
    });
    proximaAutorizacao = "100";
    const r = await req("POST", "/v1/nfe", chaveApi, {
      operacao,
      nota: { naturezaOperacao: "Venda de mercadoria" },
    });
    expect(r.status).toBe(201);
    const corpo = (await r.json()) as { chave: string; numero: number; situacao: string };
    expect(corpo).toMatchObject({ numero: 1, situacao: "autorizada", valorTotal: 500 });
    expect(corpo.chave.slice(20, 22)).toBe("55");
    chave = corpo.chave;
    expect(await (await req("GET", `/v1/nfe/${chave}/xml`, chaveApi)).text()).toMatch(/^<nfeProc /);
    const pdf = await req("GET", `/v1/nfe/${chave}/danfe`, chaveApi);
    expect(pdf.headers.get("Content-Type")).toBe("application/pdf");
    expect(
      Buffer.from(await pdf.arrayBuffer())
        .subarray(0, 5)
        .toString(),
    ).toBe("%PDF-");
    expect(await (await req("GET", "/v1/numeracao/55", chaveApi)).json()).toMatchObject({
      proximo: 2,
    });
  });

  it("NF-e inválida: 422 com os problemas explicados", async () => {
    const r = await req("POST", "/v1/nfe", chaveApi, {
      operacao: { ...operacao, itens: [{ ...operacao.itens[0], cfop: "6102" }] },
      nota: { naturezaOperacao: "Venda" },
    });
    expect(r.status).toBe(422);
    expect(((await r.json()) as { erro: { mensagem: string } }).erro.mensagem).toContain(
      "CFOP 6102 não combina com saída dentro do estado",
    );
  });

  it("carta de correção numerada sozinha e cancelamento", async () => {
    const correcao = { correcao: "Endereco de entrega: Rua das Flores, 100, fundos" };
    const cce1 = await (
      await req("POST", `/v1/nfe/${chave}/carta-correcao`, chaveApi, correcao)
    ).json();
    const cce2 = await (
      await req("POST", `/v1/nfe/${chave}/carta-correcao`, chaveApi, correcao)
    ).json();
    expect([cce1, cce2]).toMatchObject([{ sequencia: 1 }, { sequencia: 2 }]);
    expect(eventosEnviados.at(-1)).toContain("<tpEvento>110110</tpEvento>");
    expect(eventosEnviados.at(-1)).toContain("<nSeqEvento>2</nSeqEvento>");
    const canc = await req("POST", `/v1/nfe/${chave}/cancelamento`, chaveApi, {
      justificativa: "Pedido cancelado pelo cliente",
    });
    expect(await canc.json()).toMatchObject({ situacao: "cancelada" });
  });
});

describe("webhooks e rotinas de fundo", () => {
  let segredo = "";
  const tipos = () => recebidos.map((r) => JSON.parse(r.corpo).tipo as string);
  const daquiA = (ms: number) => new Date(Date.now() + ms);

  it("só aceita https e devolve o segredo uma vez", async () => {
    const http = await req("PUT", "/v1/webhook", chaveApi, { url: "http://cliente.exemplo/x" });
    expect(http.status).toBe(422);
    const r = await req("PUT", "/v1/webhook", chaveApi, { url: "https://cliente.exemplo/fiscal" });
    expect(r.status).toBe(201);
    segredo = ((await r.json()) as { segredo: string }).segredo;
    expect(segredo).toMatch(/^whsec_/);
    const empresa = await (await req("GET", "/v1/empresa", chaveApi)).text();
    expect(empresa).toContain("https://cliente.exemplo/fiscal");
    expect(empresa).not.toContain(segredo);
    expect(new TextDecoder().decode(arquivos.arquivos.get("_empresas/rose.json"))).not.toContain(
      segredo,
    );
  });

  it("evento de teste chega assinado e a assinatura confere", async () => {
    const r = await (await req("POST", "/v1/webhook/teste", chaveApi)).json();
    expect(r).toMatchObject({ tipo: "teste", situacao: "entregue", tentativas: 1 });
    const ultimo = recebidos.at(-1)!;
    expect(ultimo.url).toBe("https://cliente.exemplo/fiscal");
    expect(verificarWebhook(segredo, ultimo.corpo, ultimo.cabecalhos["Fiscal-Assinatura"]!)).toBe(
      true,
    );
    expect(
      verificarWebhook("whsec_outro", ultimo.corpo, ultimo.cabecalhos["Fiscal-Assinatura"]!),
    ).toBe(false);
    expect(
      verificarWebhook(segredo, `${ultimo.corpo} `, ultimo.cabecalhos["Fiscal-Assinatura"]!),
    ).toBe(false);
  });

  it("pendente: a rotina consulta a SEFAZ sozinha e avisa por webhook", async () => {
    proximaAutorizacao = "sem-resposta";
    const { chave } = (await (await req("POST", "/v1/nfce", chaveApi, { venda })).json()) as {
      chave: string;
    };
    await ctx.webhooks.aguardar();
    expect(tipos().at(-1)).toBe("nfce.pendente");

    proximaAutorizacao = "100";
    // Recém-emitida: a rotina ainda espera a própria emissão resolver
    expect((await executarRotinas()).pendentesResolvidas).toBe(0);
    const r = await executarRotinas({ agora: daquiA(120_000) });
    expect(r.pendentesResolvidas).toBe(1);
    await ctx.webhooks.aguardar();
    const evento = JSON.parse(recebidos.at(-1)!.corpo);
    expect(evento).toMatchObject({ tipo: "nfce.autorizada", dados: { id: chave } });
  });

  it("offline: a rotina transmite quando a SEFAZ volta", async () => {
    await req("PUT", "/v1/admin/empresas/rose", ADMIN, {
      nfce: { emitente, serie: "1", versaoAplicativo: "Teste API", contingenciaOffline: true },
    });
    proximaAutorizacao = "sem-conexao";
    const { chave } = (await (await req("POST", "/v1/nfce", chaveApi, { venda })).json()) as {
      chave: string;
    };
    expect((await executarRotinas()).transmitidasOffline).toBe(0);
    proximaAutorizacao = "100";
    expect((await executarRotinas()).transmitidasOffline).toBe(1);
    await ctx.webhooks.aguardar();
    expect(tipos().slice(-2)).toEqual(["nfce.offline", "nfce.autorizada"]);
    expect(await (await req("GET", `/v1/nfce/${chave}`, chaveApi)).json()).toMatchObject({
      situacao: "autorizada",
    });
  });

  it("sistema do cliente fora do ar: tenta de novo com espera crescente", async () => {
    respostaWebhook = 500;
    const r = await (await req("POST", "/v1/webhook/teste", chaveApi)).json();
    expect(r).toMatchObject({ situacao: "pendente", tentativas: 1, ultimoStatus: 500 });
    const antes = recebidos.length;
    await executarRotinas({ agora: daquiA(30_000) });
    expect(recebidos.length).toBe(antes); // ainda não deu 1 minuto
    respostaWebhook = 200;
    const rodada = await executarRotinas({ agora: daquiA(61_000) });
    expect(rodada.webhooks.entregues).toBe(1);
    const entregas = (await (await req("GET", "/v1/webhook/entregas", chaveApi)).json()) as {
      id: string;
      situacao: string;
      tentativas: number;
    }[];
    expect(entregas.find((e) => e.id === (r as { id: string }).id)).toMatchObject({
      situacao: "entregue",
      tentativas: 2,
    });
  });
});
