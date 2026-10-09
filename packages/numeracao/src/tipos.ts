/** Uma sequência de numeração: cada combinação tem números independentes. */
export interface Serie {
  /** Identificador da empresa no seu sistema (ou o CNPJ) */
  empresa: string;
  /** "55" NF-e, "65" NFC-e, "nfse" DPS da NFS-e… */
  modelo: string;
  ambiente: 1 | 2;
  serie: string;
}

/**
 * - reservado: entregue para uma emissão em andamento
 * - autorizado / denegado: usado de vez (a SEFAZ registrou)
 * - em-uso: a SEFAZ disse que já existe outra nota com ele (539); gasto
 * - pendente: enviado sem resposta; NÃO reutilize até consultar
 * - liberado: a nota foi rejeitada; o número volta a ser usado na próxima emissão
 * - inutilizado: inutilização homologada na SEFAZ
 */
export type SituacaoNumero =
  | "reservado"
  | "autorizado"
  | "denegado"
  | "em-uso"
  | "pendente"
  | "liberado"
  | "inutilizado";

export interface RegistroNumero {
  numero: number;
  situacao: SituacaoNumero;
  /** Chave de acesso, id da venda… o que ajudar a achar a nota */
  referencia?: string;
  atualizadoEm: Date;
}

/**
 * O que um banco precisa oferecer. Implementações: `armazemEmMemoria` (testes) e
 * `armazemPostgres` (produção). Outras (SQLite, Redis…) só precisam cumprir este contrato,
 * em especial: `reservar` deve ser atômico.
 */
export interface ArmazemNumeracao {
  /**
   * Devolve o menor número "liberado" da série (se houver) ou o próximo da sequência,
   * marcando-o como "reservado". DEVE ser atômico: chamadas simultâneas nunca recebem o mesmo número.
   * `inicio` é o primeiro número de uma série nova.
   */
  reservar(serie: Serie, inicio: number, referencia?: string): Promise<number>;
  atualizar(
    serie: Serie,
    numero: number,
    situacao: SituacaoNumero,
    referencia?: string,
  ): Promise<void>;
  /** Próximo número da sequência (sem contar liberados); `inicio` se a série nunca foi usada */
  proximo(serie: Serie): Promise<number | null>;
  listar(serie: Serie): Promise<RegistroNumero[]>;
}
