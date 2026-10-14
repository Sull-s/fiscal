import { type ReactNode, createContext, useContext } from "react";
import { type ClienteFiscal, ErroApi } from "./cliente";

const Contexto = createContext<ClienteFiscal | null>(null);

/**
 * Dá o cliente da API para todos os componentes. Envolva a parte do sistema que usa notas:
 *   <ProvedorFiscal cliente={criarClienteFiscal({ url: "/api/fiscal" })}>…</ProvedorFiscal>
 * O visual segue as variáveis CSS `--fiscal-*` (veja estilos.css) e a classe `fiscal`.
 */
export function ProvedorFiscal(props: { cliente: ClienteFiscal; children: ReactNode }) {
  return <Contexto.Provider value={props.cliente}>{props.children}</Contexto.Provider>;
}

export function useFiscal(): ClienteFiscal {
  const c = useContext(Contexto);
  if (!c) throw new Error("Use os componentes fiscais dentro de <ProvedorFiscal>.");
  return c;
}

/** Formatação brasileira independente do idioma do navegador. */
export function moeda(valor: number): string {
  const [inteiro = "0", centavos = "00"] = Math.abs(valor).toFixed(2).split(".");
  return `${valor < 0 ? "-" : ""}R$ ${inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${centavos}`;
}

export function dataCurta(iso: string | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(iso ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}${m[4] ? ` ${m[4]}:${m[5]}` : ""}` : "";
}

export const NOME_MODELO: Record<string, string> = { "55": "NF-e", "65": "NFC-e", nfse: "NFS-e" };

export const SITUACOES: Record<string, { texto: string; tom: "ok" | "aviso" | "erro" | "neutro" }> =
  {
    autorizada: { texto: "Autorizada", tom: "ok" },
    cancelada: { texto: "Cancelada", tom: "neutro" },
    pendente: { texto: "Pendente", tom: "aviso" },
    offline: { texto: "Offline", tom: "aviso" },
    "offline-rejeitada": { texto: "Offline rejeitada", tom: "erro" },
    rejeitada: { texto: "Rejeitada", tom: "erro" },
    denegada: { texto: "Denegada", tom: "erro" },
    "nao-recebida": { texto: "Não recebida", tom: "neutro" },
  };

export function Situacao(props: { situacao: string }) {
  const s = SITUACOES[props.situacao] ?? { texto: props.situacao, tom: "neutro" as const };
  return <span className={`fiscal-etiqueta fiscal-${s.tom}`}>{s.texto}</span>;
}

/** Mensagem legível de qualquer erro (a API já manda em português). */
export function mensagemDeErro(erro: unknown): string {
  if (erro instanceof ErroApi) {
    const problemas = (erro.detalhes as { problemas?: string[] } | undefined)?.problemas;
    return problemas?.length ? problemas.join(" ") : erro.message;
  }
  return erro instanceof Error ? erro.message : String(erro);
}

/** Salva um arquivo vindo da API (PDF, ZIP, XML). */
export function baixar(conteudo: Blob, nome: string) {
  const url = URL.createObjectURL(conteudo);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
