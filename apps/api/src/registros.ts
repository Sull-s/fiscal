import type { ArmazemArquivos } from "@fiscal/armazenamento";

export type SituacaoRegistro =
  | "autorizada"
  | "pendente"
  | "denegada"
  | "cancelada"
  /** A SEFAZ/Sistema Nacional nunca recebeu: o número foi devolvido para a numeração */
  | "nao-recebida";

/** Estado de cada nota emitida pela API (índice por chave; na NFS-e, por Id da DPS). */
export interface RegistroNota {
  id: string;
  modelo: "65" | "nfse";
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
  criadaEm: string;
  atualizadaEm: string;
}

const json = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));
const ler = async <T>(armazem: ArmazemArquivos, caminho: string): Promise<T | null> => {
  const bytes = await armazem.ler(caminho);
  return bytes ? (JSON.parse(new TextDecoder().decode(bytes)) as T) : null;
};

/** Índice de notas e respostas idempotentes, guardados no mesmo armazém de arquivos. */
export function criarRegistros(armazem: ArmazemArquivos) {
  const base = (empresa: string, modelo: string, ambiente: number) =>
    `_indice/${empresa}/${modelo}/${ambiente}`;
  const segura = (id: string) => id.replace(/[^0-9A-Za-z_-]/g, "");

  return {
    async salvar(empresa: string, registro: RegistroNota) {
      const b = base(empresa, registro.modelo, registro.ambiente);
      await armazem.gravar(`${b}/${segura(registro.id)}.json`, json(registro), "application/json");
      // NFS-e: permite achar pela chave (50 dígitos) além do Id da DPS
      if (registro.chave && registro.chave !== registro.id) {
        await armazem.gravar(
          `${b}/chave-${segura(registro.chave)}.json`,
          json({ id: registro.id }),
          "application/json",
        );
      }
    },
    async obter(empresa: string, modelo: "65" | "nfse", ambiente: number, idOuChave: string) {
      const b = base(empresa, modelo, ambiente);
      const direto = await ler<RegistroNota>(armazem, `${b}/${segura(idOuChave)}.json`);
      if (direto) return direto;
      const apelido = await ler<{ id: string }>(armazem, `${b}/chave-${segura(idOuChave)}.json`);
      return apelido ? ler<RegistroNota>(armazem, `${b}/${segura(apelido.id)}.json`) : null;
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
