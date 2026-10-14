import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { lerDanfeNfce, montarDanfeNfce } from "./danfe-nfce";
import { quebrarTexto } from "./modelo";
import { paraEscPos, paraHtml, paraTexto } from "./renderizadores";

const FIXTURES = join(import.meta.dirname, "..", "..", "testes", "fixtures");
const ler = (nome: string) => readFileSync(join(FIXTURES, nome), "utf8");
const autorizada = ler("nfce-entrega-autorizada.xml");
const pendente = ler("nfce-balcao-homologacao-pendente.xml");

describe("lerDanfeNfce", () => {
  it("extrai do nfeProc o que o cupom mostra", () => {
    const d = lerDanfeNfce(autorizada);
    expect(d).toMatchObject({
      ambiente: 1,
      numero: "158",
      serie: "1",
      emitente: {
        razaoSocial: "Rosemeri Teresinha Muller Correa",
        nomeFantasia: "Comida Caseira da Rose",
        cnpj: "48618635000183",
      },
      totais: { produtos: 48, desconto: 4.8, acrescimos: 5, aPagar: 48.2, troco: 0 },
      pagamentos: [{ forma: "Cartão de Crédito", valor: 48.2 }],
      consumidor: { documento: "12345678909", nome: "Mônica Souza" },
      protocolo: { numero: "143260000123456", data: "2026-10-09T14:41:42-03:00" },
      urlConsulta: "www.sefaz.rs.gov.br/nfce/consulta",
    });
    expect(d.itens).toHaveLength(3);
    expect(d.itens[1]).toEqual({
      numero: 2,
      codigo: "B1",
      descricao: "Refrigerante lata 350 ml",
      quantidade: 2,
      unidade: "UN",
      valorUnitario: 6,
      valorTotal: 12,
    });
  });
});

describe("DANFE NFC-e em texto (80 mm)", () => {
  it("nota autorizada de entrega", () => {
    expect(paraTexto(montarDanfeNfce(autorizada))).toMatchSnapshot();
  });

  it("nota de homologação sem protocolo, com troco, cancelada, em 58 mm", () => {
    const texto = paraTexto(montarDanfeNfce(pendente, { cancelada: true }), 58);
    expect(texto).toMatchSnapshot();
    expect(texto).toContain("HOMOLOGAÇÃO - SEM VALOR FISCAL");
    expect(texto).toContain("CONSUMIDOR NÃO IDENTIFICADO");
    expect(texto).toContain("*** NOTA CANCELADA ***");
    expect(texto).toMatch(/Troco R\$ +3,50/);
    // Nenhuma linha passa das 32 colunas do papel de 58 mm
    expect(texto.split("\n").every((l) => l.length <= 32)).toBe(true);
  });

  it("contingência offline (tpEmis 9): avisa e identifica a via", () => {
    const offline = pendente.replace("<tpEmis>1</tpEmis>", "<tpEmis>9</tpEmis>");
    expect(lerDanfeNfce(offline).contingencia).toBe(true);
    const texto = paraTexto(montarDanfeNfce(offline, { via: "estabelecimento" }));
    expect(texto).toContain("EMITIDA EM CONTINGÊNCIA");
    expect(texto).toContain("Pendente de autorização");
    expect(texto).toContain("VIA DO ESTABELECIMENTO");
    expect(paraTexto(montarDanfeNfce(pendente))).not.toContain("CONTINGÊNCIA");
  });
});

describe("ESC/POS", () => {
  const bytes = paraEscPos(montarDanfeNfce(autorizada));
  const hex = Buffer.from(bytes).toString("hex");

  it("inicializa, usa PC850 e corta o papel no fim", () => {
    expect(hex.startsWith("1b401b7402")).toBe(true);
    expect(hex.endsWith("1d564200")).toBe(true);
  });

  it("acentos em PC850 (Mônica → 0x93, Eletrônica → 0x93)", () => {
    expect(Buffer.from(bytes).includes(Buffer.from([0x4d, 0x93, 0x6e, 0x69, 0x63, 0x61]))).toBe(
      true,
    );
  });

  it("QR Code nativo com o conteúdo exato do XML", () => {
    const qr = lerDanfeNfce(autorizada).qrCode;
    const armazenar = Buffer.from([
      0x1d,
      0x28,
      0x6b,
      (qr.length + 3) % 256,
      Math.floor((qr.length + 3) / 256),
      0x31,
      0x50,
      0x30,
    ]);
    const pos = Buffer.from(bytes).indexOf(armazenar);
    expect(pos).toBeGreaterThan(0);
    expect(
      Buffer.from(bytes)
        .subarray(pos + 8, pos + 8 + qr.length)
        .toString("latin1"),
    ).toBe(qr);
  });

  it("gaveta opcional", () => {
    const comGaveta = Buffer.from(paraEscPos([], { abrirGaveta: true, cortar: false })).toString(
      "hex",
    );
    expect(comGaveta).toBe("1b401b74021b700019fa");
  });
});

describe("HTML", () => {
  it("autocontido, com QR Code em SVG e tamanho de página do papel", async () => {
    const html = await paraHtml(montarDanfeNfce(autorizada));
    expect(html).toContain("<svg");
    expect(html).toContain("@page{size:80mm auto");
    expect(html).toContain("Mônica Souza");
    expect(html).not.toContain("<script");
  });
});

describe("quebrarTexto", () => {
  it("quebra palavras e corta URLs maiores que a linha", () => {
    expect(quebrarTexto("abc def ghi", 7)).toEqual(["abc def", "ghi"]);
    expect(quebrarTexto("https://exemplo.com/abcdef", 10)).toEqual([
      "https://ex",
      "emplo.com/",
      "abcdef",
    ]);
    expect(quebrarTexto("a\n\nb", 10)).toEqual(["a", "", "b"]);
  });

  it("mostra os tributos aproximados quando a nota informa (Lei 12.741)", () => {
    const comTributos = pendente.replace("<vNF>", "<vTotTrib>3.21</vTotTrib><vNF>");
    expect(lerDanfeNfce(comTributos).totais.tributos).toBe(3.21);
    expect(paraTexto(montarDanfeNfce(comTributos))).toContain("12.741/2012");
    expect(paraTexto(montarDanfeNfce(pendente))).not.toContain("12.741");
  });
});
