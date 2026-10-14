import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { ErroFiscal } from "@fiscal/core";
import { strFromU8, unzipSync } from "fflate";
import { afterAll, describe, expect, it } from "vitest";
import {
  type ArmazemArquivos,
  armazemArquivosEmMemoria,
  armazemDisco,
  armazemFuncoes,
} from "./armazens";
import { criarArquivoFiscal } from "./arquivo-fiscal";
import { armazemPostgres } from "./postgres";

// Um Postgres de verdade (PGlite) para todos os testes; cada armazém usa a própria tabela
const banco = new PGlite();
let tabelas = 0;

const pastas: string[] = [];
afterAll(() => {
  for (const p of pastas) rmSync(p, { recursive: true, force: true });
});

const armazens: [string, () => ArmazemArquivos][] = [
  ["memória", () => armazemArquivosEmMemoria()],
  [
    "disco",
    () => {
      const p = mkdtempSync(join(tmpdir(), "fiscal-arquivos-"));
      pastas.push(p);
      return armazemDisco(p);
    },
  ],
  [
    "funções",
    () => {
      const m = armazemArquivosEmMemoria();
      return armazemFuncoes({ gravar: m.gravar, ler: m.ler, listar: m.listar });
    },
  ],
  [
    "postgres",
    () =>
      armazemPostgres({
        executar: (sql, p) => banco.query(sql, p),
        tabela: `arquivos_${++tabelas}`,
      }),
  ],
];

const nota = {
  cnpj: "48.618.635/0001-83",
  modelo: "65" as const,
  ambiente: 1 as const,
  chave: "43261048618635000183650010000001581103289798",
  dataEmissao: "2026-10-09T14:41:40-03:00",
};

describe.each(armazens)("armazém (%s)", (_nome, criar) => {
  it("grava, lê, substitui e lista por prefixo", async () => {
    const a = criar();
    await a.gravar("x/1.xml", new TextEncoder().encode("um"), "application/xml");
    await a.gravar("x/2.xml", new TextEncoder().encode("dois"), "application/xml");
    await a.gravar("y/3.xml", new TextEncoder().encode("três"), "application/xml");
    await a.gravar("x/1.xml", new TextEncoder().encode("um v2"), "application/xml");
    expect(new TextDecoder().decode((await a.ler("x/1.xml")) ?? undefined)).toBe("um v2");
    expect(await a.ler("x/nao-existe.xml")).toBeNull();
    expect(await a.listar("x/")).toEqual(["x/1.xml", "x/2.xml"]);
  });

  it("recusa caminhos que saem da pasta", async () => {
    const a = criar();
    await expect(a.gravar("../fora.xml", new Uint8Array(), "x")).rejects.toBeInstanceOf(ErroFiscal);
    await expect(a.gravar("C:/Windows/x.xml", new Uint8Array(), "x")).rejects.toBeInstanceOf(
      ErroFiscal,
    );
    await expect(a.ler("a/../../b")).rejects.toBeInstanceOf(ErroFiscal);
  });
});

describe("arquivo fiscal", () => {
  it("organiza por CNPJ, modelo, ambiente, ano e mês", async () => {
    const arquivo = criarArquivoFiscal(armazemArquivosEmMemoria());
    expect(await arquivo.guardar(nota, "nota", "<nfeProc/>")).toBe(
      "48618635000183/65/producao/2026/10/43261048618635000183650010000001581103289798.xml",
    );
    expect(arquivo.caminho(nota, "evento", "cancelamento")).toBe(
      "48618635000183/65/producao/2026/10/43261048618635000183650010000001581103289798-evento-cancelamento.xml",
    );
    expect(arquivo.caminho({ ...nota, ambiente: 2 }, "pdf")).toContain("/homologacao/");
    expect(await arquivo.lerTexto(nota, "nota")).toBe("<nfeProc/>");
  });

  it("ZIP do mês com manifesto e SHA-256 conferível, só produção e sem PDF por padrão", async () => {
    const pasta = mkdtempSync(join(tmpdir(), "fiscal-zip-"));
    pastas.push(pasta);
    const arquivo = criarArquivoFiscal(armazemDisco(pasta));
    await arquivo.guardar(nota, "nota", "<nfeProc>1</nfeProc>");
    await arquivo.guardar(nota, "evento", "<procEventoNFe/>", "cancelamento");
    await arquivo.guardar(nota, "pdf", new Uint8Array([37, 80, 68, 70]));
    await arquivo.guardar(
      {
        ...nota,
        chave: "4326100000000000000000000000000000000000000X".replace("X", "1"),
        modelo: "nfse",
        dataEmissao: "2026-10-20T10:00:00-03:00",
      },
      "nota",
      "<NFSe/>",
    );
    await arquivo.guardar(
      { ...nota, chave: "999", dataEmissao: "2026-09-30T23:59:00-03:00" },
      "nota",
      "<setembro/>",
    );
    await arquivo.guardar({ ...nota, chave: "888", ambiente: 2 }, "nota", "<homologacao/>");

    const { zip, quantidade } = await arquivo.exportarMes({ cnpj: nota.cnpj, ano: 2026, mes: 10 });
    const conteudo = unzipSync(zip);
    expect(Object.keys(conteudo).sort()).toEqual([
      "65/43261048618635000183650010000001581103289798-evento-cancelamento.xml",
      "65/43261048618635000183650010000001581103289798.xml",
      "manifesto.json",
      "nfse/43261000000000000000000000000000000000000001.xml",
    ]);
    expect(quantidade).toBe(3);

    const manifesto = JSON.parse(strFromU8(conteudo["manifesto.json"] as Uint8Array));
    expect(manifesto).toMatchObject({
      cnpj: "48618635000183",
      periodo: "2026-10",
      ambiente: "producao",
    });
    for (const item of manifesto.arquivos) {
      const bytes = conteudo[item.caminho] as Uint8Array;
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(item.sha256);
    }
    // Gravação atômica não deixa .tmp para trás
    expect(
      readdirSync(join(pasta, "48618635000183", "65", "producao", "2026", "10")).some((f) =>
        f.endsWith(".tmp"),
      ),
    ).toBe(false);
  });
});

describe("armazém Postgres", () => {
  it("guarda bytes exatos (PDF binário) e não confunde % e _ do prefixo com curingas", async () => {
    const a = armazemPostgres({ executar: (sql, p) => banco.query(sql, p), tabela: "binarios" });
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0x80, 0x0a]);
    await a.gravar("a_b/1.pdf", pdf, "application/pdf");
    await a.gravar("axb/2.pdf", pdf, "application/pdf");
    expect(await a.ler("a_b/1.pdf")).toEqual(pdf);
    expect(await a.listar("a_b/")).toEqual(["a_b/1.pdf"]);
    expect(await a.listar("a%")).toEqual([]);
  });

  it("recusa nome de tabela perigoso", () => {
    expect(() =>
      armazemPostgres({ executar: (sql, p) => banco.query(sql, p), tabela: "x; drop table y" }),
    ).toThrow("Nome de tabela inválido");
  });
});
