import { ErroFiscal } from "@fiscal/core";
import type { ArmazemNumeracao, RegistroNumero, Serie, SituacaoNumero } from "./tipos";

/** Situações em que o número está usado de vez e nunca mais pode ser dado a outra nota. */
const GASTOS: ReadonlySet<SituacaoNumero> = new Set([
  "autorizado",
  "denegado",
  "em-uso",
  "inutilizado",
]);

export interface SituacaoSerie {
  /** Próximo número novo da sequência */
  proximo: number;
  /** Rejeitados, que serão reaproveitados nas próximas emissões */
  liberados: number[];
  /** Enviados sem resposta: consulte na SEFAZ antes de qualquer coisa */
  pendentes: number[];
  /** Reservados há mais tempo que o limite: a emissão provavelmente caiu no meio */
  reservasAbandonadas: number[];
  /**
   * Números da sequência que nunca foram registrados (ex.: o processo caiu entre reservar e
   * registrar). Confira se não há nota com eles e inutilize.
   */
  lacunas: number[];
}

/**
 * Numeração de documentos fiscais sobre qualquer armazém.
 *
 *   const numeracao = criarNumeracao(armazemPostgres({ executar }));
 *   const serie = { empresa: "rose", modelo: "65", ambiente: 1, serie: "1" };
 *   emitirNfce({ …, proximoNumero: () => numeracao.reservar(serie) });
 *   // depois, conforme o resultado:
 *   numeracao.registrar(serie, numero, "autorizado", chave);   // ou "liberado" se rejeitada
 */
export function criarNumeracao(armazem: ArmazemNumeracao, opcoes: { inicio?: number } = {}) {
  const inicio = opcoes.inicio ?? 1;

  return {
    /** Reserva o próximo número (reaproveita liberados primeiro). Atômico. */
    reservar(serie: Serie, referencia?: string): Promise<number> {
      return armazem.reservar(serie, inicio, referencia);
    },

    /** Registra o desfecho da emissão. "liberado" devolve o número para a próxima emissão. */
    async registrar(
      serie: Serie,
      numero: number,
      situacao: SituacaoNumero,
      referencia?: string,
    ): Promise<void> {
      if (situacao === "liberado") {
        const atual = (await armazem.listar(serie)).find((r) => r.numero === numero);
        if (atual && GASTOS.has(atual.situacao)) {
          throw new ErroFiscal(
            "NUMERO_JA_USADO",
            `O número ${numero} já está ${atual.situacao} e não pode ser reaproveitado.`,
            { numero, situacao: atual.situacao },
          );
        }
      }
      await armazem.atualizar(serie, numero, situacao, referencia);
    },

    /**
     * Começa uma série num número específico (ex.: migrar de outro sistema que parou no 1530).
     * Só é permitido enquanto a série não tiver números registrados.
     */
    async iniciarEm(serie: Serie, primeiroNumero: number): Promise<void> {
      if ((await armazem.listar(serie)).length > 0 || (await armazem.proximo(serie)) !== null) {
        throw new ErroFiscal("SERIE_JA_INICIADA", "A série já tem números registrados.");
      }
      // Marca o anterior como "em-uso" (usado no sistema antigo) para a sequência partir dele
      if (primeiroNumero > 1)
        await armazem.atualizar(serie, primeiroNumero - 1, "em-uso", "sistema anterior");
    },

    /** Resumo da série para conferência e para decidir o que inutilizar. */
    async situacao(
      serie: Serie,
      abandonadaAposMinutos = 30,
      agora = new Date(),
    ): Promise<SituacaoSerie> {
      const registros = await armazem.listar(serie);
      const proximo = (await armazem.proximo(serie)) ?? inicio;
      const porNumero = new Map<number, RegistroNumero>(registros.map((r) => [r.numero, r]));
      const limite = agora.getTime() - abandonadaAposMinutos * 60_000;
      const lacunas: number[] = [];
      for (let n = registros[0]?.numero ?? proximo; n < proximo; n++) {
        if (!porNumero.has(n)) lacunas.push(n);
      }
      return {
        proximo,
        liberados: registros.filter((r) => r.situacao === "liberado").map((r) => r.numero),
        pendentes: registros.filter((r) => r.situacao === "pendente").map((r) => r.numero),
        reservasAbandonadas: registros
          .filter((r) => r.situacao === "reservado" && r.atualizadoEm.getTime() < limite)
          .map((r) => r.numero),
        lacunas,
      };
    },

    listar: (serie: Serie) => armazem.listar(serie),
  };
}

export type Numeracao = ReturnType<typeof criarNumeracao>;
