import { type ArmazemArquivos, validarCaminho } from "./armazens";

/**
 * Qualquer função que execute SQL parametrizado ($1, $2…) e devolva as linhas:
 *   pg:        (sql, p) => pool.query(sql, p)
 *   postgres:  (sql, p) => sql.unsafe(q, p).then((rows) => ({ rows }))
 *   PGlite:    (sql, p) => db.query(sql, p)
 * Serve para Supabase, Neon ou qualquer Postgres.
 */
export type ExecutarSql = (
  sql: string,
  parametros: unknown[],
) => Promise<{ rows: Record<string, unknown>[] }>;

/** SQL da tabela (o armazém também cria sozinho na primeira operação). */
export function sqlTabelaArquivos(tabela = "fiscal_arquivos") {
  return `CREATE TABLE IF NOT EXISTS ${tabela} (
  caminho   text        PRIMARY KEY,
  conteudo  bytea       NOT NULL,
  tipo      text        NOT NULL,
  gravado_em timestamptz NOT NULL DEFAULT now()
);`;
}

const bytes = (v: unknown): Uint8Array => {
  if (v instanceof Uint8Array) return new Uint8Array(v);
  // Alguns drivers devolvem bytea como texto hexadecimal "\x…"
  if (typeof v === "string" && v.startsWith("\\x"))
    return new Uint8Array(Buffer.from(v.slice(2), "hex"));
  throw new Error("Formato de bytea não reconhecido pelo armazém Postgres.");
};

/**
 * XMLs e PDFs numa tabela do Postgres (uma linha por arquivo). Bom para quem já tem banco
 * (Supabase/Neon) e não quer depender de storage de arquivos com limite de operações.
 * Como os outros armazéns, não tem função de apagar.
 */
export function armazemPostgres(opcoes: {
  executar: ExecutarSql;
  /** Padrão "fiscal_arquivos" (só letras, números e _) */
  tabela?: string;
}): ArmazemArquivos {
  const tabela = opcoes.tabela ?? "fiscal_arquivos";
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(tabela))
    throw new Error(`Nome de tabela inválido: ${tabela}`);
  const { executar } = opcoes;
  let pronta: Promise<unknown> | undefined;
  const preparar = () => {
    pronta ??= executar(sqlTabelaArquivos(tabela), []).catch((e) => {
      pronta = undefined;
      throw e;
    });
    return pronta;
  };

  return {
    async gravar(caminho, conteudo, tipo) {
      const c = validarCaminho(caminho);
      await preparar();
      await executar(
        `INSERT INTO ${tabela} (caminho, conteudo, tipo) VALUES ($1, $2, $3)
         ON CONFLICT (caminho) DO UPDATE SET conteudo = EXCLUDED.conteudo, tipo = EXCLUDED.tipo, gravado_em = now()`,
        [c, conteudo, tipo],
      );
    },
    async ler(caminho) {
      const c = validarCaminho(caminho);
      await preparar();
      const { rows } = await executar(`SELECT conteudo FROM ${tabela} WHERE caminho = $1`, [c]);
      return rows[0] ? bytes(rows[0].conteudo) : null;
    },
    async listar(prefixo) {
      await preparar();
      // starts_with não tem os curingas do LIKE (% e _ no caminho não atrapalham)
      const { rows } = await executar(
        `SELECT caminho FROM ${tabela} WHERE starts_with(caminho, $1) ORDER BY caminho COLLATE "C"`,
        [prefixo],
      );
      return rows.map((r) => String(r.caminho));
    },
  };
}
