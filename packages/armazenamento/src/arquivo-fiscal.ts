import { createHash } from "node:crypto";
import { ErroFiscal, limparCnpj } from "@fiscal/core";
import { strToU8, zipSync } from "fflate";
import type { ArmazemArquivos } from "./armazens";

export type ModeloArquivo = "55" | "65" | "nfse";

/**
 * - nota: XML da nota (nfeProc/NFS-e; antes da autorização, a NFe assinada)
 * - evento: XML de evento processado (cancelamento, CC-e…); use `sufixo` para diferenciar
 * - inutilizacao: XML da inutilização processada (a "chave" é o Id da inutilização)
 * - pdf: DANFE/DANFSE
 */
export type TipoArquivo = "nota" | "evento" | "inutilizacao" | "pdf";

export interface IdentificacaoDocumento {
  /** CNPJ (ou CPF) do emitente */
  cnpj: string;
  modelo: ModeloArquivo;
  ambiente: 1 | 2;
  /** Chave de acesso (44 ou 50 dígitos) ou outro identificador único */
  chave: string;
  /** Data de emissão ISO (define a pasta ano/mês). Ex.: "2026-10-09T14:41:40-03:00" */
  dataEmissao: string;
}

const EXTENSAO: Record<TipoArquivo, string> = {
  nota: "xml",
  evento: "xml",
  inutilizacao: "xml",
  pdf: "pdf",
};
const CONTEUDO: Record<string, string> = { xml: "application/xml", pdf: "application/pdf" };

function pastaMes(
  cnpj: string,
  modelo: ModeloArquivo,
  ambiente: 1 | 2,
  ano: number | string,
  mes: number | string,
) {
  const doc = limparCnpj(cnpj);
  if (!doc) throw new ErroFiscal("CNPJ_OBRIGATORIO", "Informe o CNPJ do emitente.");
  return `${doc}/${modelo}/${ambiente === 1 ? "producao" : "homologacao"}/${ano}/${String(mes).padStart(2, "0")}/`;
}

/**
 * Organização dos documentos fiscais num armazém:
 *   {cnpj}/{modelo}/{producao|homologacao}/{AAAA}/{MM}/{chave}[-sufixo].{xml|pdf}
 */
export function criarArquivoFiscal(armazem: ArmazemArquivos) {
  function caminho(doc: IdentificacaoDocumento, tipo: TipoArquivo, sufixo?: string) {
    const m = /^(\d{4})-(\d{2})/.exec(doc.dataEmissao);
    if (!m) throw new ErroFiscal("DATA_INVALIDA", `Data de emissão inválida: ${doc.dataEmissao}`);
    if (!/^[0-9A-Za-z]+$/.test(doc.chave))
      throw new ErroFiscal("CHAVE_INVALIDA", "Chave com caracteres inválidos.");
    const nome =
      tipo === "nota"
        ? doc.chave
        : `${doc.chave}-${tipo}${sufixo ? `-${sufixo.replace(/[^0-9A-Za-z_-]/g, "")}` : ""}`;
    return `${pastaMes(doc.cnpj, doc.modelo, doc.ambiente, m[1] ?? "", m[2] ?? "")}${nome}.${EXTENSAO[tipo]}`;
  }

  return {
    caminho,

    /** Guarda (ou substitui, ex.: NFe assinada → nfeProc autorizado) e devolve o caminho. */
    async guardar(
      doc: IdentificacaoDocumento,
      tipo: TipoArquivo,
      conteudo: string | Uint8Array,
      sufixo?: string,
    ) {
      const destino = caminho(doc, tipo, sufixo);
      const bytes = typeof conteudo === "string" ? strToU8(conteudo) : conteudo;
      await armazem.gravar(destino, bytes, CONTEUDO[EXTENSAO[tipo]] ?? "application/octet-stream");
      return destino;
    },

    async ler(doc: IdentificacaoDocumento, tipo: TipoArquivo, sufixo?: string) {
      return armazem.ler(caminho(doc, tipo, sufixo));
    },

    async lerTexto(doc: IdentificacaoDocumento, tipo: TipoArquivo, sufixo?: string) {
      const bytes = await armazem.ler(caminho(doc, tipo, sufixo));
      return bytes ? new TextDecoder().decode(bytes) : null;
    },

    listarMes(filtro: {
      cnpj: string;
      modelo: ModeloArquivo;
      ambiente: 1 | 2;
      ano: number;
      mes: number;
    }) {
      return armazem.listar(
        pastaMes(filtro.cnpj, filtro.modelo, filtro.ambiente, filtro.ano, filtro.mes),
      );
    },

    /**
     * ZIP do mês para o contador: todos os XMLs (e PDFs, se pedir) dos modelos informados,
     * com `manifesto.json` (lista, tamanho e SHA-256 de cada arquivo).
     */
    async exportarMes(filtro: {
      cnpj: string;
      ano: number;
      mes: number;
      /** Padrão: todos */
      modelos?: ModeloArquivo[];
      /** Padrão: produção */
      ambiente?: 1 | 2;
      incluirPdf?: boolean;
    }): Promise<{ zip: Uint8Array; quantidade: number }> {
      const ambiente = filtro.ambiente ?? 1;
      const arquivos: Record<string, Uint8Array> = {};
      const manifesto: { caminho: string; bytes: number; sha256: string }[] = [];
      for (const modelo of filtro.modelos ?? (["55", "65", "nfse"] as const)) {
        const caminhos = await armazem.listar(
          pastaMes(filtro.cnpj, modelo, ambiente, filtro.ano, filtro.mes),
        );
        for (const c of caminhos) {
          if (!filtro.incluirPdf && c.endsWith(".pdf")) continue;
          const bytes = await armazem.ler(c);
          if (!bytes) continue;
          // Dentro do ZIP: modelo/arquivo (o CNPJ, ano e mês já estão no nome do ZIP)
          const nome = `${modelo}/${c.slice(c.lastIndexOf("/") + 1)}`;
          arquivos[nome] = bytes;
          manifesto.push({
            caminho: nome,
            bytes: bytes.length,
            sha256: createHash("sha256").update(bytes).digest("hex"),
          });
        }
      }
      arquivos["manifesto.json"] = strToU8(
        JSON.stringify(
          {
            cnpj: limparCnpj(filtro.cnpj),
            periodo: `${filtro.ano}-${String(filtro.mes).padStart(2, "0")}`,
            ambiente: ambiente === 1 ? "producao" : "homologacao",
            geradoEm: new Date().toISOString(),
            arquivos: manifesto,
          },
          null,
          2,
        ),
      );
      return { zip: zipSync(arquivos, { level: 6 }), quantidade: manifesto.length };
    },
  };
}

export type ArquivoFiscal = ReturnType<typeof criarArquivoFiscal>;
