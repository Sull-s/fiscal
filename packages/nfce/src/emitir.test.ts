import { readFileSync } from "node:fs";
import { join } from "node:path";
import { abrirCertificadoA1 } from "@fiscal/certificado";
import { ErroFiscal } from "@fiscal/core";
import { describe, expect, it } from "vitest";
import { chaveDe, clienteFalso, protNFe, retEnviNFe } from "../../nfe-comum/testes/sefaz-falsa";
import { PASTA_FIXTURES, carregarFixturesAntigas } from "../testes/fixtures-antigas";
import { emitirNfce } from "./emitir";

const certificado = abrirCertificadoA1(
  readFileSync(join(PASTA_FIXTURES, "certificado-teste.pfx")),
  "senha-teste",
);
const fixtures = carregarFixturesAntigas();
const rose = fixtures.find((f) => f.nome === "entrega-homologacao")!.entrada;
const outraEmpresa = fixtures.find((f) => f.nome === "balcao-dinheiro-troco")!.entrada;
const agora = new Date("2026-10-09T18:00:00Z");

function numeracao(inicio: number) {
  let n = inicio;
  return async () => n++;
}

describe("emitirNfce", () => {
  it("539 no primeiro número: tenta o próximo e informa o número gasto", async () => {
    const { cliente } = clienteFalso((c, i) => {
      const chave = chaveDe(c.mensagem);
      return i === 0
        ? retEnviNFe(
            "104",
            "Lote processado",
            protNFe({ chave, cStat: "539", xMotivo: "Duplicidade com diferenca na chave" }),
          )
        : retEnviNFe(
            "104",
            "Lote processado",
            protNFe({
              chave,
              cStat: "100",
              xMotivo: "Autorizado o uso da NF-e",
              nProt: "143260000000777",
            }),
          );
    });
    const r = await emitirNfce({
      cliente,
      certificado,
      agora,
      emitente: rose.emitente,
      venda: rose.venda,
      nota: { ambiente: 2, serie: 1, versaoAplicativo: "Teste" },
      proximoNumero: numeracao(500),
    });
    expect(r.numerosEmUso).toEqual([500]);
    expect(r.nota.numero).toBe(501);
    expect(r.autorizacao).toMatchObject({ situacao: "autorizada", protocolo: "143260000000777" });
    expect(r.xmlAssinado).toContain("<Signature");
  });

  it("três 539 seguidos: para e avisa para conferir a numeração", async () => {
    const { cliente } = clienteFalso((c) =>
      retEnviNFe(
        "104",
        "Lote processado",
        protNFe({ chave: chaveDe(c.mensagem), cStat: "539", xMotivo: "Duplicidade" }),
      ),
    );
    await expect(
      emitirNfce({
        cliente,
        certificado,
        agora,
        emitente: rose.emitente,
        venda: rose.venda,
        nota: { ambiente: 2, serie: 1 },
        proximoNumero: numeracao(1),
      }),
    ).rejects.toMatchObject({
      codigo: "NFCE_SEM_NUMERO_LIVRE",
      detalhes: { numerosEmUso: [1, 2, 3] },
    });
  });

  it("recusa certificado de outra empresa antes de gastar número ou chamar a SEFAZ (evita a 213)", async () => {
    const { cliente, chamadas } = clienteFalso(() => "");
    let pedidos = 0;
    await expect(
      emitirNfce({
        cliente,
        certificado,
        agora,
        emitente: outraEmpresa.emitente,
        venda: outraEmpresa.venda,
        nota: { ambiente: 2, serie: 1 },
        proximoNumero: async () => ++pedidos,
      }),
    ).rejects.toMatchObject({ codigo: "CERTIFICADO_DE_OUTRA_EMPRESA" });
    expect(pedidos).toBe(0);
    expect(chamadas).toHaveLength(0);
  });

  it("recusa certificado vencido", async () => {
    const { cliente } = clienteFalso(() => "");
    await expect(
      emitirNfce({
        cliente,
        certificado,
        agora: new Date("2040-01-01T00:00:00Z"),
        emitente: rose.emitente,
        venda: rose.venda,
        nota: { ambiente: 2, serie: 1 },
        proximoNumero: numeracao(1),
      }),
    ).rejects.toBeInstanceOf(ErroFiscal);
  });
});
