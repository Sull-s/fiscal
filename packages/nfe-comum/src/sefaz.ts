import { ErroFiscal, type Uf } from "@fiscal/core";
import { type ClienteSefaz, type Contingencia, podeTerSidoProcessado } from "@fiscal/transporte";
import { type MaterialAssinatura, assinarXml } from "@fiscal/xml";
import { NS_NFE } from "./constantes";
import { montarCancelamento, montarCartaCorrecao, montarInutilizacao } from "./eventos";

type Campos = Record<string, string | undefined>;
const NS_WSDL_EVENTO = "http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4";

/** 55 = NF-e, 65 = NFC-e */
export type ModeloNfe = "55" | "65";

const sem = (xml: string) => xml.replace(/^<\?xml[^>]*\?>/, "").trim();
const extrair = (xml: string, elemento: string) =>
  new RegExp(`<${elemento}\\b[\\s\\S]*?</${elemento}>`).exec(xml)?.[0] ?? "";
const gerarIdLote = () => String(Date.now()).slice(-15);

/** cStat que significam "uso denegado": o número da nota fica gasto. */
const DENEGADA = new Set(["110", "301", "302", "303"]);
const AUTORIZADA = new Set(["100", "150"]);

export type SituacaoAutorizacao =
  | "autorizada"
  | "denegada"
  | "rejeitada"
  /** 539: o número já foi usado com outra chave; tente o próximo número */
  | "numero-em-uso"
  /** Sem resposta: a SEFAZ pode ter autorizado. Consulte pela chave antes de qualquer outra coisa */
  | "pendente"
  /**
   * Só em `emitirNfce` com contingência: a SEFAZ estava fora e a nota saiu offline (tpEmis 9).
   * Vale para o consumidor; transmita com `transmitirNfceOffline` assim que a SEFAZ voltar.
   */
  | "offline";

export interface ResultadoAutorizacao {
  situacao: SituacaoAutorizacao;
  cStat: string;
  motivo: string;
  protocolo?: string;
  dataRecebimento?: string;
  /** <protNFe> devolvido pela SEFAZ */
  xmlProtocolo?: string;
  /** <nfeProc> (nota + protocolo): é o XML que vale juridicamente e vai para o cliente/contador */
  xmlProcessado?: string;
}

function classificar(cStat: string): SituacaoAutorizacao {
  if (AUTORIZADA.has(cStat)) return "autorizada";
  if (DENEGADA.has(cStat)) return "denegada";
  if (cStat === "539") return "numero-em-uso";
  return "rejeitada";
}

function comProtocolo(xmlNota: string, xmlRetorno: string, inf: Campos): ResultadoAutorizacao {
  const cStat = inf.cStat ?? "";
  const xmlProtocolo = extrair(xmlRetorno, "protNFe");
  const situacao = classificar(cStat);
  const guardaXml = situacao === "autorizada" || situacao === "denegada";
  return {
    situacao,
    cStat,
    motivo: inf.xMotivo ?? "",
    ...(inf.nProt ? { protocolo: inf.nProt } : {}),
    ...(inf.dhRecbto ? { dataRecebimento: inf.dhRecbto } : {}),
    ...(xmlProtocolo ? { xmlProtocolo } : {}),
    ...(guardaXml && xmlProtocolo
      ? {
          xmlProcessado: `<nfeProc xmlns="${NS_NFE}" versao="4.00">${sem(xmlNota)}${xmlProtocolo}</nfeProc>`,
        }
      : {}),
  };
}

/**
 * Envia a NFC-e assinada para autorização (modo síncrono) e classifica a resposta.
 * Nunca reenvia por conta própria: se não houver resposta, devolve "pendente".
 */
export async function autorizarNota(
  cliente: ClienteSefaz,
  pedido: {
    uf: Uf;
    modelo: ModeloNfe;
    ambiente: 1 | 2;
    xmlAssinado: string;
    /** NF-e emitida em contingência SVC (tpEmis 6/7): vai para a SEFAZ virtual */
    contingencia?: Contingencia;
    /** Tentativas de buscar o resultado quando a SEFAZ responde 103 (processamento assíncrono) */
    consultasRecibo?: number;
    esperaReciboMs?: number;
  },
): Promise<ResultadoAutorizacao> {
  const { uf, ambiente, modelo } = pedido;
  const svc = pedido.contingencia ? { contingencia: pedido.contingencia } : {};
  const nota = sem(pedido.xmlAssinado);
  const mensagem = `<enviNFe xmlns="${NS_NFE}" versao="4.00"><idLote>${gerarIdLote()}</idLote><indSinc>1</indSinc>${nota}</enviNFe>`;

  let resposta: Awaited<ReturnType<ClienteSefaz["chamar"]>>;
  try {
    resposta = await cliente.chamar({
      uf,
      modelo,
      ambiente,
      ...svc,
      servico: "autorizacao",
      mensagem,
    });
  } catch (erro) {
    if (podeTerSidoProcessado(erro)) {
      return {
        situacao: "pendente",
        cStat: "",
        motivo: erro instanceof Error ? erro.message : String(erro),
      };
    }
    throw erro;
  }

  const ret = (resposta.dados.retEnviNFe ?? {}) as Campos & { protNFe?: { infProt?: Campos } };
  const inf = ret.protNFe?.infProt;
  if (inf) {
    // 204: esta mesma chave já foi autorizada (ex.: reenvio após "pendente"): busca o protocolo
    if (inf.cStat === "204") {
      const chave = /Id="NFe(\d{44})"/.exec(nota)?.[1] ?? "";
      const consulta = await consultarNota(cliente, {
        uf,
        modelo,
        ambiente,
        chave,
        xmlNota: nota,
        ...svc,
      });
      if (consulta.situacao === "autorizada") return { ...consulta, situacao: "autorizada" };
    }
    return comProtocolo(nota, resposta.xmlRetorno, inf);
  }

  // 108/109: serviço paralisado. Nada foi processado: o chamador pode tentar depois ou ir para offline
  if (ret.cStat === "108" || ret.cStat === "109") {
    throw new ErroFiscal(
      "SEFAZ_PARALISADA",
      `SEFAZ fora de operação (${ret.cStat}): ${ret.xMotivo}`,
      {
        cStat: ret.cStat,
        podeTerSidoProcessado: false,
      },
    );
  }

  // 103: lote recebido para processamento assíncrono; busca o resultado pelo recibo
  if (ret.cStat === "103") {
    const nRec = (ret as Campos & { infRec?: Campos }).infRec?.nRec ?? "";
    const tentativas = pedido.consultasRecibo ?? 5;
    for (let i = 0; i < tentativas; i++) {
      await new Promise((ok) => setTimeout(ok, pedido.esperaReciboMs ?? 2000));
      const r = await cliente.chamar({
        uf,
        modelo,
        ambiente,
        ...svc,
        servico: "retAutorizacao",
        mensagem: `<consReciNFe xmlns="${NS_NFE}" versao="4.00"><tpAmb>${ambiente}</tpAmb><nRec>${nRec}</nRec></consReciNFe>`,
      });
      const rec = (r.dados.retConsReciNFe ?? {}) as Campos & { protNFe?: { infProt?: Campos } };
      if (rec.protNFe?.infProt) return comProtocolo(nota, r.xmlRetorno, rec.protNFe.infProt);
      if (rec.cStat !== "105") break; // 105 = ainda em processamento
    }
    return {
      situacao: "pendente",
      cStat: "103",
      motivo: `Lote ${nRec} ainda em processamento na SEFAZ.`,
    };
  }

  // Rejeição do lote inteiro (schema, certificado…): a nota não foi processada
  return { situacao: "rejeitada", cStat: ret.cStat ?? "", motivo: ret.xMotivo ?? "" };
}

/** Situação atual da nota na SEFAZ. "nao-encontrada" (217): a SEFAZ nunca recebeu; pode emitir de novo. */
export type SituacaoNaSefaz = "autorizada" | "cancelada" | "denegada" | "nao-encontrada" | "outra";

export interface ResultadoConsulta {
  situacao: SituacaoNaSefaz;
  cStat: string;
  motivo: string;
  /** Protocolo de autorização (também presente em nota cancelada) */
  protocolo?: string;
  xmlProtocolo?: string;
  /** <nfeProc>, quando a nota está autorizada e `xmlNota` foi informado */
  xmlProcessado?: string;
}

function situacaoDaConsulta(cStat: string): SituacaoNaSefaz {
  if (AUTORIZADA.has(cStat)) return "autorizada";
  if (["101", "151", "155"].includes(cStat)) return "cancelada";
  if (DENEGADA.has(cStat)) return "denegada";
  if (cStat === "217") return "nao-encontrada";
  return "outra";
}

/**
 * Consulta a situação da nota pela chave. É o jeito de resolver notas "pendentes".
 * Com `xmlNota`, devolve também o <nfeProc> pronto quando autorizada.
 */
export async function consultarNota(
  cliente: ClienteSefaz,
  pedido: {
    uf: Uf;
    modelo: ModeloNfe;
    ambiente: 1 | 2;
    chave: string;
    xmlNota?: string;
    /** Consulta na SEFAZ virtual de contingência */
    contingencia?: Contingencia;
  },
): Promise<ResultadoConsulta> {
  const { uf, ambiente, chave, modelo } = pedido;
  const mensagem = `<consSitNFe xmlns="${NS_NFE}" versao="4.00"><tpAmb>${ambiente}</tpAmb><xServ>CONSULTAR</xServ><chNFe>${chave}</chNFe></consSitNFe>`;
  const r = await cliente.chamar({
    uf,
    modelo,
    ambiente,
    servico: "consulta",
    mensagem,
    ...(pedido.contingencia ? { contingencia: pedido.contingencia } : {}),
  });
  const ret = (r.dados.retConsSitNFe ?? {}) as Campos & { protNFe?: { infProt?: Campos } };
  const cStat = ret.cStat ?? "";
  const situacao = situacaoDaConsulta(cStat);
  const inf = ret.protNFe?.infProt;
  const xmlProtocolo = extrair(r.xmlRetorno, "protNFe");
  return {
    situacao,
    cStat,
    motivo: ret.xMotivo ?? "",
    ...(inf?.nProt ? { protocolo: inf.nProt } : {}),
    ...(xmlProtocolo ? { xmlProtocolo } : {}),
    ...(situacao === "autorizada" && pedido.xmlNota && xmlProtocolo
      ? {
          xmlProcessado: `<nfeProc xmlns="${NS_NFE}" versao="4.00">${sem(pedido.xmlNota)}${xmlProtocolo}</nfeProc>`,
        }
      : {}),
  };
}

export interface ResultadoEvento {
  registrado: boolean;
  cStat: string;
  motivo: string;
  protocolo?: string;
  /** <procEventoNFe> (evento + retorno), para guardar junto com a nota */
  xmlProcessado?: string;
}

/**
 * Assina e envia um evento (cancelamento, carta de correção…) já montado.
 * 135/136/155 = evento registrado.
 */
export async function enviarEvento(
  cliente: ClienteSefaz,
  pedido: {
    uf: Uf;
    modelo: ModeloNfe;
    ambiente: 1 | 2;
    /** <evento> sem assinatura */
    xmlEvento: string;
    certificado: MaterialAssinatura;
    /** Evento de nota autorizada na SVC, enquanto a contingência está ativa */
    contingencia?: Contingencia;
    /**
     * Endereço fixo do RecepcaoEvento (ex.: Ambiente Nacional, para a manifestação do
     * destinatário), em vez do autorizador da UF.
     */
    url?: string;
  },
): Promise<ResultadoEvento> {
  const evento = assinarXml(pedido.xmlEvento, {
    certificado: pedido.certificado,
    elemento: "infEvento",
    perfil: "sefaz",
  });
  const mensagem = `<envEvento xmlns="${NS_NFE}" versao="1.00"><idLote>${gerarIdLote()}</idLote>${evento}</envEvento>`;
  const r = pedido.url
    ? await cliente.chamarUrl({
        url: pedido.url,
        namespace: NS_WSDL_EVENTO,
        acao: `${NS_WSDL_EVENTO}/nfeRecepcaoEvento`,
        mensagem,
        servico: "evento",
      })
    : await cliente.chamar({
        uf: pedido.uf,
        modelo: pedido.modelo,
        ambiente: pedido.ambiente,
        servico: "evento",
        mensagem,
        ...(pedido.contingencia ? { contingencia: pedido.contingencia } : {}),
      });
  const ret = (r.dados.retEnvEvento ?? {}) as Campos & { retEvento?: { infEvento?: Campos } };
  const inf = ret.retEvento?.infEvento;
  const cStat = inf?.cStat ?? ret.cStat ?? "";
  const registrado = ["135", "136", "155"].includes(cStat);
  const retEvento = extrair(r.xmlRetorno, "retEvento");
  return {
    registrado,
    cStat,
    motivo: inf?.xMotivo ?? ret.xMotivo ?? "",
    ...(inf?.nProt ? { protocolo: inf.nProt } : {}),
    ...(registrado
      ? {
          xmlProcessado: `<procEventoNFe xmlns="${NS_NFE}" versao="1.00">${evento}${retEvento}</procEventoNFe>`,
        }
      : {}),
  };
}

/** Cancela uma nota autorizada (ou, com `chaveSubstituta`, cancela por substituição). */
export function cancelarNota(
  cliente: ClienteSefaz,
  pedido: Parameters<typeof montarCancelamento>[0] & {
    uf: Uf;
    modelo: ModeloNfe;
    certificado: MaterialAssinatura;
    contingencia?: Contingencia;
  },
): Promise<ResultadoEvento> {
  return enviarEvento(cliente, { ...pedido, xmlEvento: montarCancelamento(pedido).xml });
}

/** Carta de correção (só NF-e modelo 55). Cada nova carta substitui as anteriores: mande o texto completo. */
export function enviarCartaCorrecao(
  cliente: ClienteSefaz,
  pedido: Parameters<typeof montarCartaCorrecao>[0] & {
    uf: Uf;
    certificado: MaterialAssinatura;
    contingencia?: Contingencia;
  },
): Promise<ResultadoEvento> {
  return enviarEvento(cliente, {
    ...pedido,
    modelo: "55",
    xmlEvento: montarCartaCorrecao(pedido).xml,
  });
}

/** Inutiliza uma faixa de números. 102 = inutilização homologada. */
export async function inutilizarNumeracao(
  cliente: ClienteSefaz,
  pedido: Parameters<typeof montarInutilizacao>[0] & { certificado: MaterialAssinatura },
): Promise<ResultadoEvento> {
  const { xml } = montarInutilizacao(pedido);
  const assinado = assinarXml(xml, {
    certificado: pedido.certificado,
    elemento: "infInut",
    perfil: "sefaz",
  });
  const r = await cliente.chamar({
    uf: pedido.uf,
    modelo: pedido.modelo ?? "65",
    ambiente: pedido.ambiente,
    servico: "inutilizacao",
    mensagem: assinado,
  });
  const inf = ((r.dados.retInutNFe ?? {}) as { infInut?: Campos }).infInut ?? {};
  const registrado = inf.cStat === "102";
  return {
    registrado,
    cStat: inf.cStat ?? "",
    motivo: inf.xMotivo ?? "",
    ...(inf.nProt ? { protocolo: inf.nProt } : {}),
    ...(registrado
      ? {
          // "ProcInutNFe" com P maiúsculo é o nome do XSD oficial (procInutNFe_v4.00.xsd)
          xmlProcessado: `<ProcInutNFe xmlns="${NS_NFE}" versao="4.00">${assinado}${extrair(r.xmlRetorno, "retInutNFe")}</ProcInutNFe>`,
        }
      : {}),
  };
}
