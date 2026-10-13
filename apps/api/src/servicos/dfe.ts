import {
  type DocumentoDistribuido,
  type TipoManifestacao,
  manifestar,
  sincronizarDistribuicao,
} from "@fiscal/dfe";
import type { Empresa } from "../empresas";
import { falhar } from "../http";
import type { Operacao } from "./nfce";

/** Nota recebida (emitida contra o CNPJ da empresa), como a API guarda e devolve. */
export interface NotaRecebida {
  chave: string;
  emitente?: { documento: string; nome: string; ie?: string };
  dataEmissao?: string;
  valor?: number;
  /** 1 autorizada · 2 denegada · 3 cancelada */
  situacaoNfe?: string;
  /** Já baixou o XML completo (nfeProc) */
  xmlCompleto: boolean;
  /** Última manifestação registrada pela empresa */
  manifestacao?: { tipo: TipoManifestacao; protocolo?: string; em: string };
  /** Eventos vistos na distribuição (cancelamento, CC-e…) */
  eventos: { tipo: string; descricao: string; protocolo?: string }[];
  atualizadaEm: string;
}

interface EstadoDfe {
  ultNSU: string;
  /** Não consultar antes disso (regra da Receita: 1 hora depois de 137/656 ou de chegar ao fim) */
  proximaConsulta: string;
}

const UMA_HORA = 3_600_000;
const json = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));

export function documentoInteressado(empresa: Empresa) {
  return empresa.cnpj.replace(/\D/g, "");
}

function caminhos(empresa: Empresa) {
  const base = `_dfe/${empresa.id}/${empresa.ambiente}`;
  return {
    estado: `${base}/estado.json`,
    nota: (chave: string) => `${base}/notas/${chave}.json`,
    xml: (chave: string) => `${base}/xml/${chave}.xml`,
    evento: (nsu: string) => `${base}/eventos/${nsu}.xml`,
    notas: `${base}/notas/`,
  };
}

async function lerJson<T>(op: Operacao, caminho: string): Promise<T | null> {
  const b = await op.ctx.deps.arquivos.ler(caminho);
  return b ? (JSON.parse(new TextDecoder().decode(b)) as T) : null;
}

export async function lerNotaRecebida(op: Operacao, chave: string) {
  return lerJson<NotaRecebida>(op, caminhos(op.empresa).nota(chave.replace(/\D/g, "")));
}

export async function listarNotasRecebidas(op: Operacao) {
  const c = caminhos(op.empresa);
  const lista = await op.ctx.deps.arquivos.listar(c.notas);
  const notas = await Promise.all(lista.map((p) => lerJson<NotaRecebida>(op, p)));
  return notas
    .filter((n): n is NotaRecebida => n !== null)
    .sort((a, b) => (b.dataEmissao ?? "").localeCompare(a.dataEmissao ?? ""));
}

export async function xmlNotaRecebida(op: Operacao, chave: string) {
  const b = await op.ctx.deps.arquivos.ler(caminhos(op.empresa).xml(chave.replace(/\D/g, "")));
  return b ? new TextDecoder().decode(b) : null;
}

/** Registra um documento da distribuição no índice de notas recebidas. */
async function registrar(op: Operacao, d: DocumentoDistribuido) {
  const { ctx, empresa } = op;
  const c = caminhos(empresa);
  if (!d.chave) return null;
  const anterior = await lerJson<NotaRecebida>(op, c.nota(d.chave));
  const nota: NotaRecebida = anterior ?? {
    chave: d.chave,
    xmlCompleto: false,
    eventos: [],
    atualizadaEm: "",
  };
  if (d.emitente) nota.emitente = d.emitente;
  if (d.dataEmissao) nota.dataEmissao = d.dataEmissao;
  if (d.valor !== undefined) nota.valor = d.valor;
  if (d.situacaoNfe) nota.situacaoNfe = d.situacaoNfe;
  if (d.tipo === "nfe") {
    nota.xmlCompleto = true;
    await ctx.deps.arquivos.gravar(
      c.xml(d.chave),
      new TextEncoder().encode(d.xml),
      "application/xml",
    );
  }
  if ((d.tipo === "evento" || d.tipo === "resumo-evento") && d.evento) {
    if (!nota.eventos.some((e) => e.protocolo && e.protocolo === d.evento?.protocolo)) {
      nota.eventos.push(d.evento);
    }
    // Cancelamento pelo emitente
    if (d.evento.tipo === "110111") nota.situacaoNfe = "3";
    await ctx.deps.arquivos.gravar(
      c.evento(d.nsu),
      new TextEncoder().encode(d.xml),
      "application/xml",
    );
  }
  nota.atualizadaEm = new Date().toISOString();
  await ctx.deps.arquivos.gravar(c.nota(d.chave), json(nota), "application/json");
  return { nota, nova: !anterior };
}

/** Envia a manifestação e guarda o resultado na nota recebida. */
export async function manifestarNota(
  op: Operacao,
  chave: string,
  tipo: TipoManifestacao,
  justificativa?: string,
) {
  const { ctx, empresa } = op;
  const resultado = await manifestar(ctx.sefaz(empresa), {
    chave,
    tipo,
    documento: documentoInteressado(empresa),
    ambiente: empresa.ambiente,
    certificado: ctx.certificado(empresa),
    ...(justificativa ? { justificativa } : {}),
  });
  // 573 = esta manifestação já tinha sido registrada antes
  if (!resultado.registrado && resultado.cStat !== "573") return resultado;
  const c = caminhos(empresa);
  const nota = (await lerJson<NotaRecebida>(op, c.nota(chave))) ?? {
    chave,
    xmlCompleto: false,
    eventos: [],
    atualizadaEm: "",
  };
  nota.manifestacao = {
    tipo,
    ...(resultado.protocolo ? { protocolo: resultado.protocolo } : {}),
    em: new Date().toISOString(),
  };
  nota.atualizadaEm = nota.manifestacao.em;
  await ctx.deps.arquivos.gravar(c.nota(chave), json(nota), "application/json");
  return resultado;
}

/**
 * Busca o que há de novo na distribuição, respeitando a espera de 1 hora da Receita.
 * Notas novas geram webhook "dfe.nota"; eventos (ex.: cancelamento pelo fornecedor) "dfe.evento".
 * Com `cienciaAutomatica`, manifesta ciência dos resumos novos para o XML completo vir depois.
 */
export async function sincronizarDfe(op: Operacao, agora = new Date()) {
  const { ctx, empresa } = op;
  const config = empresa.dfe ?? falhar(409, "DFE_NAO_CONFIGURADO", "Ative o DF-e no cadastro.");
  const c = caminhos(empresa);
  const estado = (await lerJson<EstadoDfe>(op, c.estado)) ?? {
    ultNSU: "0",
    proximaConsulta: new Date(0).toISOString(),
  };
  if (agora < new Date(estado.proximaConsulta)) {
    return { consultou: false, proximaConsulta: estado.proximaConsulta, novos: 0 };
  }

  const r = await sincronizarDistribuicao(ctx.sefaz(empresa), {
    ambiente: empresa.ambiente,
    documento: documentoInteressado(empresa),
    uf: (empresa.nfe ?? empresa.nfce)?.emitente.endereco.uf ?? "RS",
    ultNSU: estado.ultNSU,
  });
  let novos = 0;
  for (const d of r.documentos) {
    const reg = await registrar(op, d);
    if (!reg) continue;
    novos++;
    const evento = d.tipo === "evento" || d.tipo === "resumo-evento" ? "dfe.evento" : "dfe.nota";
    await ctx.webhooks.publicar(empresa.id, evento, { nsu: d.nsu, tipo: d.tipo, nota: reg.nota });
    if (config.cienciaAutomatica && d.tipo === "resumo-nfe" && !reg.nota.manifestacao) {
      await manifestarNota(op, d.chave ?? "", "ciencia").catch((erro) =>
        ctx.deps.aoRegistrar?.({ empresa: empresa.id, rotina: "dfe-ciencia", erro: String(erro) }),
      );
    }
  }
  // Chegou ao fim (ou a Receita pediu): só volta daqui a 1 hora
  const fim = r.aguardar || !r.maxNSU || r.ultNSU >= r.maxNSU.padStart(15, "0");
  const novoEstado: EstadoDfe = {
    ultNSU: r.ultNSU || estado.ultNSU,
    proximaConsulta: new Date(agora.getTime() + (fim ? UMA_HORA : 0)).toISOString(),
  };
  await ctx.deps.arquivos.gravar(c.estado, json(novoEstado), "application/json");
  return {
    consultou: true,
    cStat: r.cStat,
    motivo: r.motivo,
    novos,
    ultNSU: novoEstado.ultNSU,
    proximaConsulta: novoEstado.proximaConsulta,
  };
}
