import type { ArmazemNumeracao, RegistroNumero, Serie, SituacaoNumero } from "./tipos";

/**
 * Qualquer função que execute SQL parametrizado ($1, $2…) e devolva as linhas:
 *   pg:        (sql, p) => pool.query(sql, p)
 *   Neon:      (sql, p) => neon(url).query(sql, p).then((rows) => ({ rows }))
 *   PGlite:    (sql, p) => db.query(sql, p)
 */
export type ExecutarSql = (
  sql: string,
  parametros: unknown[],
) => Promise<{ rows: Record<string, unknown>[] }>;

/** SQL para criar as tabelas (rode uma vez, ou use `prepararTabelas`). */
export function sqlTabelas(prefixo = "fiscal") {
  return `
CREATE TABLE IF NOT EXISTS ${prefixo}_numeracao_serie (
  empresa   text     NOT NULL,
  modelo    text     NOT NULL,
  ambiente  smallint NOT NULL,
  serie     text     NOT NULL,
  proximo   bigint   NOT NULL,
  PRIMARY KEY (empresa, modelo, ambiente, serie)
);
CREATE TABLE IF NOT EXISTS ${prefixo}_numeracao_numero (
  empresa       text        NOT NULL,
  modelo        text        NOT NULL,
  ambiente      smallint    NOT NULL,
  serie         text        NOT NULL,
  numero        bigint      NOT NULL,
  situacao      text        NOT NULL,
  referencia    text,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa, modelo, ambiente, serie, numero)
);
CREATE INDEX IF NOT EXISTS ${prefixo}_numeracao_liberados
  ON ${prefixo}_numeracao_numero (empresa, modelo, ambiente, serie, numero)
  WHERE situacao = 'liberado';`;
}

export interface OpcoesPostgres {
  executar: ExecutarSql;
  /** Prefixo das tabelas (padrão "fiscal") */
  prefixo?: string;
}

export async function prepararTabelas(opcoes: OpcoesPostgres): Promise<void> {
  // Uma instrução por vez: nem todo driver aceita várias numa chamada parametrizada
  for (const instrucao of sqlTabelas(opcoes.prefixo)
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)) {
    await opcoes.executar(instrucao, []);
  }
}

/**
 * Armazém PostgreSQL. A reserva é uma única instrução por caminho (reaproveitar liberado OU
 * avançar a sequência), então é atômica mesmo com vários servidores emitindo ao mesmo tempo.
 */
export function armazemPostgres(opcoes: OpcoesPostgres): ArmazemNumeracao {
  const p = opcoes.prefixo ?? "fiscal";
  const serieT = `${p}_numeracao_serie`;
  const numeroT = `${p}_numeracao_numero`;
  const { executar } = opcoes;
  const chave = (s: Serie) => [s.empresa, s.modelo, s.ambiente, s.serie];

  return {
    async reservar(serie, inicio, referencia) {
      // 1) Reaproveita o menor número liberado (SKIP LOCKED: duas transações nunca pegam o mesmo)
      const reaproveitado = await executar(
        `UPDATE ${numeroT} SET situacao = 'reservado', referencia = $5, atualizado_em = now()
          WHERE (empresa, modelo, ambiente, serie, numero) = (
            SELECT empresa, modelo, ambiente, serie, numero FROM ${numeroT}
             WHERE empresa = $1 AND modelo = $2 AND ambiente = $3 AND serie = $4 AND situacao = 'liberado'
             ORDER BY numero LIMIT 1 FOR UPDATE SKIP LOCKED)
          RETURNING numero`,
        [...chave(serie), referencia ?? null],
      );
      if (reaproveitado.rows[0]) return Number(reaproveitado.rows[0].numero);

      // 2) Avança a sequência e registra a reserva na mesma instrução
      const novo = await executar(
        `WITH n AS (
           INSERT INTO ${serieT} (empresa, modelo, ambiente, serie, proximo) VALUES ($1, $2, $3, $4, $5::bigint + 1)
           ON CONFLICT (empresa, modelo, ambiente, serie) DO UPDATE SET proximo = ${serieT}.proximo + 1
           RETURNING proximo - 1 AS numero)
         INSERT INTO ${numeroT} (empresa, modelo, ambiente, serie, numero, situacao, referencia)
         SELECT $1, $2, $3, $4, numero, 'reservado', $6 FROM n
         ON CONFLICT (empresa, modelo, ambiente, serie, numero)
           DO UPDATE SET situacao = 'reservado', referencia = EXCLUDED.referencia, atualizado_em = now()
         RETURNING numero`,
        [...chave(serie), inicio, referencia ?? null],
      );
      return Number(novo.rows[0]?.numero);
    },

    async atualizar(serie, numero, situacao, referencia) {
      await executar(
        `INSERT INTO ${numeroT} (empresa, modelo, ambiente, serie, numero, situacao, referencia)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (empresa, modelo, ambiente, serie, numero) DO UPDATE
           SET situacao = EXCLUDED.situacao,
               referencia = COALESCE(EXCLUDED.referencia, ${numeroT}.referencia),
               atualizado_em = now()`,
        [...chave(serie), numero, situacao, referencia ?? null],
      );
      // Número à frente da sequência (ex.: inutilização antecipada) empurra o próximo
      await executar(
        `INSERT INTO ${serieT} (empresa, modelo, ambiente, serie, proximo) VALUES ($1, $2, $3, $4, $5::bigint + 1)
         ON CONFLICT (empresa, modelo, ambiente, serie) DO UPDATE
           SET proximo = GREATEST(${serieT}.proximo, EXCLUDED.proximo)`,
        [...chave(serie), numero],
      );
    },

    async proximo(serie) {
      const r = await executar(
        `SELECT proximo FROM ${serieT} WHERE empresa = $1 AND modelo = $2 AND ambiente = $3 AND serie = $4`,
        chave(serie),
      );
      return r.rows[0] ? Number(r.rows[0].proximo) : null;
    },

    async listar(serie) {
      const r = await executar(
        `SELECT numero, situacao, referencia, atualizado_em FROM ${numeroT}
          WHERE empresa = $1 AND modelo = $2 AND ambiente = $3 AND serie = $4 ORDER BY numero`,
        chave(serie),
      );
      return r.rows.map(
        (l): RegistroNumero => ({
          numero: Number(l.numero),
          situacao: l.situacao as SituacaoNumero,
          ...(l.referencia ? { referencia: String(l.referencia) } : {}),
          atualizadoEm: new Date(l.atualizado_em as string | Date),
        }),
      );
    },
  };
}
