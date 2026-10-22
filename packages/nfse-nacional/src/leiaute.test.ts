import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { abrirCertificadoA1 } from "@fiscal/certificado";
import type { PedidoHttps } from "@fiscal/transporte";
import { describe, expect, it } from "vitest";
import { entradaReal } from "../testes/entrada-real";
import { criarClienteNfse } from "./cliente";
import { emitirNfse, leiauteEmUso, recusaDeLeiaute } from "./emitir";

// Arquivo próprio: o leiaute aceito fica na memória do módulo e não pode vazar para outros testes
const FIXTURES = join(import.meta.dirname, "..", "testes", "fixtures");
const certificado = abrirCertificadoA1(
  readFileSync(join(FIXTURES, "certificado-teste.pfx")),
  "senha-teste",
);
const NFSE_REAL = readFileSync(join(FIXTURES, "antigo", "nfse-autorizada.xml"), "utf8");
const agora = new Date("2026-10-22T12:00:00Z");
const gz = (s: string) => gzipSync(Buffer.from(s)).toString("base64");
const deGz = (s: string) => gunzipSync(Buffer.from(s, "base64")).toString("utf8");

// Mensagens reais do Sistema Nacional (E1235) nos dois sentidos da virada
const FALTA_FINNFSE =
  "The element 'infDPS' in namespace 'http://www.sped.fazenda.gov.br/nfse' has invalid child element 'cLocEmi' in namespace 'http://www.sped.fazenda.gov.br/nfse'. List of possible elements expected: 'cMotivoEmisTI, finNFSe' in namespace 'http://www.sped.fazenda.gov.br/nfse'.";
const SOBRA_FINNFSE =
  "The element 'infDPS' in namespace 'http://www.sped.fazenda.gov.br/nfse' has invalid child element 'finNFSe' in namespace 'http://www.sped.fazenda.gov.br/nfse'. List of possible elements expected: 'cMotivoEmisTI, chNFSeRej, cLocEmi' in namespace 'http://www.sped.fazenda.gov.br/nfse'.";

/** Sistema Nacional simulado que só aceita um leiaute (troca com `aceita = ...`) */
function governo(aceita: "2026-02" | "2026-10") {
  const estado = { aceita, enviados: [] as string[] };
  const c = criarClienteNfse({
    ambiente: 2,
    certificado,
    requisitar: async (p: PedidoHttps) => {
      const dps = deGz(JSON.parse(p.corpo ?? "{}").dpsXmlGZipB64);
      const novo = dps.includes("<finNFSe>");
      estado.enviados.push(novo ? "2026-10" : "2026-02");
      if ((estado.aceita === "2026-10") !== novo) {
        return {
          statusHttp: 400,
          corpo: JSON.stringify({
            erros: [
              {
                Codigo: "E1235",
                Descricao: "Falha no esquema XML do DF-e.",
                Complemento: novo ? SOBRA_FINNFSE : FALTA_FINNFSE,
              },
            ],
          }),
        };
      }
      return {
        statusHttp: 201,
        corpo: JSON.stringify({
          chaveAcesso: "43149022210440532000101000000000000126089303229430",
          nfseXmlGZipB64: gz(NFSE_REAL),
        }),
      };
    },
  });
  return { c, estado };
}

const entrada = () => {
  const e = entradaReal();
  return { ...e, prestador: { ...e.prestador, documento: "48618635000183" }, agora };
};

describe("virada de leiaute da NFS-e", () => {
  it("reconhece só as recusas de esquema nos campos que mudaram", () => {
    expect(recusaDeLeiaute([{ codigo: "E1235", descricao: "x", complemento: FALTA_FINNFSE }])).toBe(
      true,
    );
    expect(
      recusaDeLeiaute([{ codigo: "E1235", descricao: "x", complemento: "'end' ... 'xLgr'" }]),
    ).toBe(false);
    expect(recusaDeLeiaute([{ codigo: "E0014", descricao: "DPS duplicada" }])).toBe(false);
  });

  it("governo ainda no leiaute antigo: reenvia sozinho no 2026-02 e passa a usá-lo", async () => {
    const { c, estado } = governo("2026-02");
    expect(leiauteEmUso(2)).toBe("2026-10");
    const r = await emitirNfse({ cliente: c, certificado, ...entrada() });
    expect(r.situacao).toBe("autorizada");
    expect(estado.enviados).toEqual(["2026-10", "2026-02"]);
    expect(r.dps.leiaute).toBe("2026-02");
    expect(r.alertas.at(-1)?.codigo).toBe("LEIAUTE_TROCADO");
    expect(leiauteEmUso(2)).toBe("2026-02");

    // A próxima já vai direto no que funcionou
    await emitirNfse({ cliente: c, certificado, ...entrada() });
    expect(estado.enviados).toEqual(["2026-10", "2026-02", "2026-02"]);
  });

  it("governo vira para o novo: troca sozinho para o 2026-10 (mesmo número, sem gastar outro)", async () => {
    const { c, estado } = governo("2026-10");
    const r = await emitirNfse({ cliente: c, certificado, ...entrada() });
    expect(r.situacao).toBe("autorizada");
    expect(estado.enviados).toEqual(["2026-02", "2026-10"]);
    expect(r.xmlDpsAssinado).toContain("<finNFSe>0</finNFSe>");
    // Mesma DPS (mesmo número): a recusa de esquema não gasta o número
    expect(r.dps.id.endsWith(String(entrada().dps.numero).padStart(15, "0"))).toBe(true);
    expect(leiauteEmUso(2)).toBe("2026-10");
  });

  it("leiaute forçado não troca sozinho", async () => {
    const { c, estado } = governo("2026-10");
    const e = entrada();
    const r = await emitirNfse({
      cliente: c,
      certificado,
      ...e,
      dps: { ...e.dps, leiaute: "2026-02" },
    });
    expect(r.situacao).toBe("rejeitada");
    expect(estado.enviados).toEqual(["2026-02"]);
  });

  it("produção (ambiente 1) não é afetada pelo que se aprendeu na homologação", () => {
    expect(leiauteEmUso(1)).toBe("2026-02");
  });
});
