import { gunzipSync } from "node:zlib";
import { ErroFiscal, type Uf, codigoUf, limparCnpj, validarChaveAcesso } from "@fiscal/core";
import { NS_NFE } from "@fiscal/nfe-comum";
import { type ClienteSefaz, lerXmlComoObjeto } from "@fiscal/transporte";
import { tag } from "@fiscal/xml";
import { AMBIENTE_NACIONAL, NS_WSDL_DISTRIBUICAO } from "./enderecos";

/**
 * Distribuição de DF-e (Ambiente Nacional): baixa os documentos em que a empresa aparece —
 * NF-e emitidas contra o CNPJ (resumo ou XML completo), eventos dessas notas (cancelamento,
 * carta de correção) e eventos das próprias notas registrados por terceiros.
 *
 * Funciona por NSU (número sequencial único por CNPJ): guarde o `ultNSU` e peça a partir dele.
 * Regras da Receita: quando vier 137 (nada novo) ou 656 (consumo indevido), espere 1 hora antes
 * de consultar de novo. Uma consulta devolve até 50 documentos.
 */

export type Pedido =
  /** Tudo o que veio depois deste NSU ("0" na primeira vez) */
  | { ultNSU: string }
  /** Um documento específico */
  | { nsu: string }
  /** O XML de uma NF-e pela chave (precisa de manifestação "ciência" antes, se for de terceiro) */
  | { chave: string };

export type TipoDocumento =
  /** Resumo de NF-e emitida contra o CNPJ: manifeste "ciência" para receber o XML completo */
  | "resumo-nfe"
  /** NF-e completa (nfeProc) */
  | "nfe"
  /** Resumo de evento (ex.: cancelamento de uma nota recebida) */
  | "resumo-evento"
  /** Evento completo (procEventoNFe) */
  | "evento"
  | "outro";

export interface DocumentoDistribuido {
  nsu: string;
  /** Nome do schema informado pela Receita (ex.: resNFe_v1.01.xsd) */
  schema: string;
  tipo: TipoDocumento;
  /** XML já descompactado */
  xml: string;
  chave?: string;
  /** Resumo/NF-e: quem emitiu */
  emitente?: { documento: string; nome: string; ie?: string };
  dataEmissao?: string;
  valor?: number;
  /** 1 autorizada · 2 denegada · 3 cancelada (só no resumo) */
  situacaoNfe?: string;
  /** Evento: código (110111 cancelamento, 110110 CC-e…) e descrição */
  evento?: { tipo: string; descricao: string; protocolo?: string };
}

export interface ResultadoDistribuicao {
  cStat: string;
  motivo: string;
  ultNSU: string;
  maxNSU: string;
  documentos: DocumentoDistribuido[];
  /** true quando a Receita pede para esperar 1 hora (137 nada novo, 656 consumo indevido) */
  aguardar: boolean;
}

const nsu15 = (n: string) =>
  String(n || "0")
    .replace(/\D/g, "")
    .padStart(15, "0");

/** Monta o distDFeInt (versão 1.01). */
export function montarConsultaDistribuicao(d: {
  ambiente: 1 | 2;
  /** CNPJ ou CPF interessado (o dono do certificado) */
  documento: string;
  /** UF do interessado (cUFAutor) */
  uf?: Uf;
  pedido: Pedido;
}): string {
  const doc = limparCnpj(d.documento);
  let consulta: string;
  if ("ultNSU" in d.pedido)
    consulta = `<distNSU>${tag("ultNSU", nsu15(d.pedido.ultNSU))}</distNSU>`;
  else if ("nsu" in d.pedido) consulta = `<consNSU>${tag("NSU", nsu15(d.pedido.nsu))}</consNSU>`;
  else {
    if (!validarChaveAcesso(d.pedido.chave)) {
      throw new ErroFiscal("CHAVE_INVALIDA", "Chave de acesso inválida.", {
        chave: d.pedido.chave,
      });
    }
    consulta = `<consChNFe>${tag("chNFe", d.pedido.chave)}</consChNFe>`;
  }
  return (
    `<distDFeInt xmlns="${NS_NFE}" versao="1.01">` +
    tag("tpAmb", d.ambiente) +
    (d.uf ? tag("cUFAutor", codigoUf(d.uf)) : "") +
    tag(doc.length === 11 ? "CPF" : "CNPJ", doc) +
    consulta +
    "</distDFeInt>"
  );
}

type No = Record<string, unknown>;
const o = (v: unknown): No => (v && typeof v === "object" ? (v as No) : {});
const s = (v: unknown) => (v === undefined || v === null ? "" : String(v));

/** Descompacta e classifica um docZip. */
export function lerDocumento(nsu: string, schema: string, base64: string): DocumentoDistribuido {
  const xml = gunzipSync(Buffer.from(base64, "base64")).toString("utf8");
  const raiz = lerXmlComoObjeto(xml);
  const base = { nsu, schema, xml };

  if (raiz.resNFe) {
    const r = o(raiz.resNFe);
    return {
      ...base,
      tipo: "resumo-nfe",
      chave: s(r.chNFe),
      emitente: { documento: s(r.CNPJ ?? r.CPF), nome: s(r.xNome), ie: s(r.IE) },
      dataEmissao: s(r.dhEmi),
      valor: Number(r.vNF ?? 0),
      situacaoNfe: s(r.cSitNFe),
    };
  }
  if (raiz.nfeProc) {
    const inf = o(o(o(raiz.nfeProc).NFe).infNFe);
    const emit = o(inf.emit);
    return {
      ...base,
      tipo: "nfe",
      chave: s(inf["@Id"]).replace(/^NFe/, ""),
      emitente: { documento: s(emit.CNPJ ?? emit.CPF), nome: s(emit.xNome), ie: s(emit.IE) },
      dataEmissao: s(o(inf.ide).dhEmi),
      valor: Number(o(o(inf.total).ICMSTot).vNF ?? 0),
    };
  }
  if (raiz.resEvento) {
    const r = o(raiz.resEvento);
    return {
      ...base,
      tipo: "resumo-evento",
      chave: s(r.chNFe),
      evento: { tipo: s(r.tpEvento), descricao: s(r.xEvento), protocolo: s(r.nProt) },
    };
  }
  if (raiz.procEventoNFe) {
    const inf = o(o(o(raiz.procEventoNFe).evento).infEvento);
    const ret = o(o(o(raiz.procEventoNFe).retEvento).infEvento);
    return {
      ...base,
      tipo: "evento",
      chave: s(inf.chNFe),
      evento: {
        tipo: s(inf.tpEvento),
        descricao: s(o(inf.detEvento).descEvento),
        protocolo: s(ret.nProt),
      },
    };
  }
  return { ...base, tipo: "outro" };
}

/** Uma chamada à distribuição. */
export async function consultarDistribuicao(
  cliente: ClienteSefaz,
  d: Parameters<typeof montarConsultaDistribuicao>[0],
): Promise<ResultadoDistribuicao> {
  const r = await cliente.chamarUrl({
    url: AMBIENTE_NACIONAL[d.ambiente].distribuicao,
    namespace: NS_WSDL_DISTRIBUICAO,
    acao: `${NS_WSDL_DISTRIBUICAO}/nfeDistDFeInteresse`,
    operacao: "nfeDistDFeInteresse",
    mensagem: montarConsultaDistribuicao(d),
    idempotente: true,
  });
  const ret = o(r.dados.retDistDFeInt);
  const zips = o(ret.loteDistDFeInt).docZip;
  // Com um documento só, o leitor devolve objeto; com vários, lista
  const lista = (Array.isArray(zips) ? zips : zips ? [zips] : []) as No[];
  const cStat = s(ret.cStat);
  return {
    cStat,
    motivo: s(ret.xMotivo),
    ultNSU: s(ret.ultNSU),
    maxNSU: s(ret.maxNSU),
    documentos: lista.map((z) => lerDocumento(s(z["@NSU"]), s(z["@schema"]), s(z["#text"]))),
    aguardar: cStat === "137" || cStat === "656",
  };
}

/**
 * Busca tudo o que há de novo desde `ultNSU`, em quantas chamadas forem precisas (até
 * `maxChamadas`). Devolve os documentos e o `ultNSU` para guardar e usar na próxima vez.
 */
export async function sincronizarDistribuicao(
  cliente: ClienteSefaz,
  d: Omit<Parameters<typeof montarConsultaDistribuicao>[0], "pedido"> & {
    ultNSU: string;
    /** Padrão 20 (1000 documentos) */
    maxChamadas?: number;
  },
): Promise<ResultadoDistribuicao & { chamadas: number }> {
  const documentos: DocumentoDistribuido[] = [];
  let ultNSU = nsu15(d.ultNSU);
  let ultimo: ResultadoDistribuicao | undefined;
  let chamadas = 0;
  const { ultNSU: _, maxChamadas = 20, ...base } = d;
  while (chamadas < maxChamadas) {
    ultimo = await consultarDistribuicao(cliente, { ...base, pedido: { ultNSU } });
    chamadas++;
    documentos.push(...ultimo.documentos);
    if (ultimo.cStat !== "138" || !ultimo.ultNSU) break;
    ultNSU = nsu15(ultimo.ultNSU);
    if (ultNSU >= nsu15(ultimo.maxNSU)) break;
  }
  return {
    cStat: ultimo?.cStat ?? "",
    motivo: ultimo?.motivo ?? "",
    ultNSU: ultimo?.ultNSU ? nsu15(ultimo.ultNSU) : ultNSU,
    maxNSU: ultimo?.maxNSU ?? "",
    aguardar: ultimo?.aguardar ?? false,
    documentos,
    chamadas,
  };
}
