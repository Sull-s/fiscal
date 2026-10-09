import { PGlite } from "@electric-sql/pglite";
import { ErroFiscal } from "@fiscal/core";
import { describe, expect, it } from "vitest";
import { armazemEmMemoria } from "./memoria";
import { criarNumeracao } from "./numeracao";
import { armazemPostgres, prepararTabelas } from "./postgres";
import type { ArmazemNumeracao, Serie } from "./tipos";

/** O mesmo contrato roda nos dois armazéns: memória e PostgreSQL de verdade (PGlite). */
const armazens: [string, () => Promise<ArmazemNumeracao>][] = [
  ["memória", async () => armazemEmMemoria()],
  [
    "postgres",
    async () => {
      const db = new PGlite();
      const executar = (sql: string, p: unknown[]) => db.query<Record<string, unknown>>(sql, p);
      await prepararTabelas({ executar });
      return armazemPostgres({ executar });
    },
  ],
];

const serie: Serie = { empresa: "rose", modelo: "65", ambiente: 2, serie: "1" };

describe.each(armazens)("numeração (%s)", (_nome, criar) => {
  it("reserva números em sequência, começando no 1", async () => {
    const n = criarNumeracao(await criar());
    expect([await n.reservar(serie), await n.reservar(serie), await n.reservar(serie)]).toEqual([
      1, 2, 3,
    ]);
  });

  it("séries, modelos, ambientes e empresas são independentes", async () => {
    const n = criarNumeracao(await criar());
    await n.reservar(serie);
    await n.reservar(serie);
    expect(await n.reservar({ ...serie, serie: "2" })).toBe(1);
    expect(await n.reservar({ ...serie, ambiente: 1 })).toBe(1);
    expect(await n.reservar({ ...serie, modelo: "55" })).toBe(1);
    expect(await n.reservar({ ...serie, empresa: "padaria" })).toBe(1);
  });

  it("50 reservas simultâneas: todos os números diferentes e sem buracos", async () => {
    const n = criarNumeracao(await criar());
    const numeros = await Promise.all(Array.from({ length: 50 }, () => n.reservar(serie)));
    expect(new Set(numeros).size).toBe(50);
    expect([...numeros].sort((a, b) => a - b)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
  });

  it("rejeitada: o número é liberado e reaproveitado (o menor primeiro)", async () => {
    const n = criarNumeracao(await criar());
    for (let i = 0; i < 4; i++) await n.reservar(serie);
    await n.registrar(serie, 1, "autorizado", "chave-1");
    await n.registrar(serie, 3, "liberado");
    await n.registrar(serie, 2, "liberado");
    expect(await n.reservar(serie)).toBe(2);
    expect(await n.reservar(serie)).toBe(3);
    expect(await n.reservar(serie)).toBe(5);
  });

  it("não deixa liberar número já autorizado", async () => {
    const n = criarNumeracao(await criar());
    await n.reservar(serie);
    await n.registrar(serie, 1, "autorizado");
    await expect(n.registrar(serie, 1, "liberado")).rejects.toBeInstanceOf(ErroFiscal);
  });

  it("guarda a referência e a situação de cada número", async () => {
    const n = criarNumeracao(await criar());
    await n.reservar(serie, "venda-77");
    await n.registrar(serie, 1, "autorizado", "4326…");
    const [registro] = await n.listar(serie);
    expect(registro).toMatchObject({ numero: 1, situacao: "autorizado", referencia: "4326…" });
    expect(registro?.atualizadoEm).toBeInstanceOf(Date);
  });

  it("situação: pendentes, liberados, reservas abandonadas e lacunas", async () => {
    const n = criarNumeracao(await criar());
    for (let i = 0; i < 5; i++) await n.reservar(serie);
    await n.registrar(serie, 1, "autorizado");
    await n.registrar(serie, 2, "pendente");
    await n.registrar(serie, 3, "liberado");
    await n.registrar(serie, 4, "em-uso");
    // Inutilização antecipada do 8 empurra a sequência e deixa 6 e 7 sem registro
    await n.registrar(serie, 8, "inutilizado");

    const daqui1h = new Date(Date.now() + 3_600_000);
    expect(await n.situacao(serie, 30, daqui1h)).toEqual({
      proximo: 9,
      liberados: [3],
      pendentes: [2],
      reservasAbandonadas: [5],
      lacunas: [6, 7],
    });
    expect((await n.situacao(serie)).reservasAbandonadas).toEqual([]);
  });

  it("iniciarEm: continua a numeração de um sistema anterior", async () => {
    const n = criarNumeracao(await criar());
    await n.iniciarEm(serie, 1531);
    expect(await n.reservar(serie)).toBe(1531);
    expect((await n.situacao(serie)).lacunas).toEqual([]);
    await expect(n.iniciarEm(serie, 10)).rejects.toMatchObject({ codigo: "SERIE_JA_INICIADA" });
  });
});
