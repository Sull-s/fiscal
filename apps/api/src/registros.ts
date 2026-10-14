import type { ArmazemArquivos } from "@fiscal/armazenamento";

/** 55 NF-e · 65 NFC-e · nfse */
export type ModeloRegistro = "55" | "65" | "nfse";

export type SituacaoRegistro =
  | "autorizada"
  | "pendente"
  | "denegada"
  | "cancelada"
  /** A SEFAZ/Sistema Nacional nunca recebeu: o número foi devolvido para a numeração */
  | "nao-recebida"
  /** NFC-e emitida em contingência offline, ainda não transmitida */
  | "offline"
  /** NFC-e offline que a SEFAZ rejeitou na transmissão: precisa de correção manual */
  | "offline-rejeitada";

/** Estado de cada nota emitida pela API (índice por chave; na NFS-e, por Id da DPS). */
export interface RegistroNota {
  id: string;
  modelo: ModeloRegistro;
  ambiente: 1 | 2;
  numero: number;
  serie: string;
  dataEmissao: string;
  situacao: SituacaoRegistro;
  /** Chave de acesso (na NFS-e, só depois de gerada) */
  chave?: string;
  protocolo?: string;
  valorTotal?: number;
  referencia?: string;
  motivo?: string;
  qrCode?: string;
  urlConsulta?: string;
  troco?: number;
  /** Tentativa online sem resposta que foi substituída por esta nota offline (chave) */
  substitui?: string;
  /** Nota offline que substituiu esta tentativa online (chave) */
  substituidaPor?: string;
  /** NF-e autorizada pela SEFAZ virtual de contingência */
  svc?: "SVC-AN" | "SVC-RS";
  /** NF-e: quantas cartas de correção já foram registradas */
  cartasCorrecao?: number;
  criadaEm: string;
  atualizadaEm: string;
}

const json = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));
const ler = async <T>(armazem: ArmazemArquivos, caminho: string): Promise<T | null> => {
  const bytes = await armazem.ler(caminho);
  return bytes ? (JSON.parse(new TextDecoder().decode(bytes)) as T) : null;
};

/** Situações que ficam numa lista de trabalho (as rotinas da API resolvem sozinhas). */
const EM_ABERTO = ["pendente", "offline"] as const;
export type SituacaoEmAberto = (typeof EM_ABERTO)[number];
const emAberto = (s: SituacaoRegistro | null): s is SituacaoEmAberto =>
  (EM_ABERTO as readonly string[]).includes(s ?? "");

export interface OpcoesRegistros {
  /** Chamado quando uma nota é criada ou muda de situação (webhooks) */
  aoMudarSituacao?: (
    empresa: string,
    registro: RegistroNota,
    anterior: SituacaoRegistro | null,
  ) => Promise<void> | void;
}

/**
 * Índice de notas e respostas idempotentes, guardados no mesmo armazém de arquivos.
 * Notas "pendente" e "offline" ganham uma marca em `_abertas/`, para as rotinas acharem sem varrer
 * o índice inteiro.
 */
export function criarRegistros(armazem: ArmazemArquivos, opcoes: OpcoesRegistros = {}) {
  const base = (empresa: string, modelo: string, ambiente: number) =>
    `_indice/${empresa}/${modelo}/${ambiente}`;
  const marcas = (empresa: string, modelo: string, ambiente: number, situacao: string) =>
    `_abertas/${empresa}/${modelo}/${ambiente}/${situacao}/`;
  const segura = (id: string) => id.replace(/[^0-9A-Za-z_-]/g, "");
  const mes = (empresa: string, ambiente: number, anoMes: string) =>
    `_mes/${empresa}/${ambiente}/${anoMes}/`;

  return {
    async salvar(empresa: string, registro: RegistroNota) {
      const b = base(empresa, registro.modelo, registro.ambiente);
      const caminho = `${b}/${segura(registro.id)}.json`;
      const anterior = (await ler<RegistroNota>(armazem, caminho))?.situacao ?? null;
      await armazem.gravar(caminho, json(registro), "application/json");
      // NFS-e: permite achar pela chave (50 dígitos) além do Id da DPS
      if (registro.chave && registro.chave !== registro.id) {
        await armazem.gravar(
          `${b}/chave-${segura(registro.chave)}.json`,
          json({ id: registro.id }),
          "application/json",
        );
      }
      // Índice do mês da emissão (relatório do contador sem varrer todas as notas)
      if (anterior === null) {
        await armazem.gravar(
          `${mes(empresa, registro.ambiente, registro.dataEmissao.slice(0, 7))}${registro.modelo}-${segura(registro.id)}`,
          json({ modelo: registro.modelo, id: registro.id }),
          "application/json",
        );
      }
      if (anterior === registro.situacao) return;
      const marcar = (situacao: SituacaoEmAberto, aberta: boolean) =>
        armazem.gravar(
          marcas(empresa, registro.modelo, registro.ambiente, situacao) + segura(registro.id),
          json({ aberta }),
          "application/json",
        );
      if (emAberto(anterior)) await marcar(anterior, false);
      if (emAberto(registro.situacao)) await marcar(registro.situacao, true);
      await opcoes.aoMudarSituacao?.(empresa, registro, anterior);
    },
    async obter(empresa: string, modelo: ModeloRegistro, ambiente: number, idOuChave: string) {
      const b = base(empresa, modelo, ambiente);
      const direto = await ler<RegistroNota>(armazem, `${b}/${segura(idOuChave)}.json`);
      if (direto) return direto;
      const apelido = await ler<{ id: string }>(armazem, `${b}/chave-${segura(idOuChave)}.json`);
      return apelido ? ler<RegistroNota>(armazem, `${b}/${segura(apelido.id)}.json`) : null;
    },

    /**
     * Ids das notas ainda "pendente" ou "offline", das mais antigas para as mais novas
     * (NFC-e: por AAMM, série e número da chave; NFS-e: o Id da DPS já vem em ordem).
     */
    async listarEmAberto(
      empresa: string,
      modelo: ModeloRegistro,
      ambiente: number,
      situacao: SituacaoEmAberto,
    ) {
      const prefixo = marcas(empresa, modelo, ambiente, situacao);
      const ids: string[] = [];
      for (const caminho of await armazem.listar(prefixo)) {
        if ((await ler<{ aberta: boolean }>(armazem, caminho))?.aberta) {
          ids.push(caminho.slice(prefixo.length));
        }
      }
      const ordem = (id: string) => (modelo !== "nfse" ? id.slice(2, 6) + id.slice(22, 34) : id);
      return ids.sort((a, b) => ordem(a).localeCompare(ordem(b)));
    },

    /** Todas as notas emitidas no mês (AAAA-MM), de todos os modelos. */
    async listarDoMes(empresa: string, ambiente: number, anoMes: string) {
      const notas: RegistroNota[] = [];
      for (const caminho of await armazem.listar(mes(empresa, ambiente, anoMes))) {
        const ref = await ler<{ modelo: ModeloRegistro; id: string }>(armazem, caminho);
        const r = ref && (await this.obter(empresa, ref.modelo, ambiente, ref.id));
        if (r) notas.push(r);
      }
      return notas;
    },

    /** Resposta guardada para um Idempotency-Key (repetir o pedido devolve a mesma coisa). */
    async respostaIdempotente(empresa: string, chave: string) {
      return ler<{ status: number; corpo: unknown }>(
        armazem,
        `_idempotencia/${empresa}/${segura(chave)}.json`,
      );
    },
    async guardarRespostaIdempotente(
      empresa: string,
      chave: string,
      status: number,
      corpo: unknown,
    ) {
      await armazem.gravar(
        `_idempotencia/${empresa}/${segura(chave)}.json`,
        json({ status, corpo }),
        "application/json",
      );
    },
  };
}

export type Registros = ReturnType<typeof criarRegistros>;
