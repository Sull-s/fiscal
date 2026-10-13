import {
  type CertificadoA1,
  certificadoServeParaEmitente,
  exigirCertificadoValido,
} from "@fiscal/certificado";
import { ErroFiscal } from "@fiscal/core";
import { type ResultadoAutorizacao, autorizarNota } from "@fiscal/nfe-comum";
import { CONTINGENCIA_DA_UF, type ClienteSefaz, podeTerSidoProcessado } from "@fiscal/transporte";
import { assinarXml } from "@fiscal/xml";
import { montarNfe } from "./montar";
import type { DadosNfe, EmitenteNfe, NfeMontada, OperacaoNfe } from "./tipos";

export interface EmissaoNfe {
  nota: NfeMontada;
  /** NFe assinada, como foi enviada. Guarde SEMPRE, mesmo se ficar pendente */
  xmlAssinado: string;
  autorizacao: ResultadoAutorizacao;
  /** Números que a SEFAZ disse já estarem em uso (539): ficam gastos na sua numeração */
  numerosEmUso: number[];
  /**
   * Só quando a nota foi para a SVC depois de uma tentativa na SEFAZ do estado sem resposta:
   * essa tentativa pode ter sido autorizada. Consulte-a depois (`consultarNfe`) e, se autorizada,
   * cancele-a (`cancelarNfe`), porque a venda já saiu pela SVC com outro número.
   */
  tentativaPendente?: { nota: NfeMontada; xmlAssinado: string };
}

/**
 * Emite uma NF-e de ponta a ponta: confere o certificado, monta, assina, envia e trata a resposta.
 *
 * - "autorizada": guarde `autorizacao.xmlProcessado` (nfeProc) e mande ao destinatário.
 * - "pendente": guarde `xmlAssinado` e resolva depois com `consultarNfe`.
 * - "denegada": o número fica gasto.
 * - "rejeitada": nada foi registrado; o número continua livre.
 *
 * `proximoNumero` deve reservar o número de forma atômica. Se a SEFAZ responder 539, tenta o próximo.
 *
 * Com `contingencia`, se a SEFAZ do estado estiver inacessível, paralisada ou sem resposta, emite na
 * SVC (tpEmis 6/7). Se a SEFAZ nunca recebeu a tentativa, reaproveita o número; se pode ter
 * recebido, usa outro número e devolve a tentativa em `tentativaPendente`.
 * Com `nota.contingencia` preenchida, vai direto para a SVC.
 */
export async function emitirNfe(entrada: {
  cliente: ClienteSefaz;
  certificado: CertificadoA1;
  emitente: EmitenteNfe;
  operacao: OperacaoNfe;
  nota: Omit<DadosNfe, "numero" | "codigoNumerico">;
  proximoNumero: () => Promise<number>;
  /** Padrão 3 */
  tentativasNumero?: number;
  agora?: Date;
  /** Entrar em contingência SVC automaticamente se a SEFAZ do estado não atender */
  contingencia?: { justificativa: string; svc?: "SVC-AN" | "SVC-RS" };
}): Promise<EmissaoNfe> {
  const { cliente, certificado, emitente, operacao } = entrada;
  exigirCertificadoValido(certificado, entrada.agora);
  if (!certificadoServeParaEmitente(certificado, emitente.cnpj)) {
    throw new ErroFiscal(
      "CERTIFICADO_DE_OUTRA_EMPRESA",
      `O certificado é do CNPJ ${certificado.documento || "(não identificado)"}, que não tem a mesma raiz do emitente ${emitente.cnpj}.`,
      { documentoCertificado: certificado.documento, cnpjEmitente: emitente.cnpj },
    );
  }

  const numerosEmUso: number[] = [];
  const uf = emitente.endereco.uf;
  const ambiente = entrada.nota.ambiente;

  const enviar = async (numero: number, contingencia?: NonNullable<DadosNfe["contingencia"]>) => {
    const nota = montarNfe({
      emitente,
      operacao,
      nota: { ...entrada.nota, numero, ...(contingencia ? { contingencia } : {}) },
    });
    const xmlAssinado = assinarXml(nota.xml, { certificado, elemento: "infNFe", perfil: "sefaz" });
    const autorizacao = await autorizarNota(cliente, {
      uf,
      modelo: "55",
      ambiente,
      xmlAssinado,
      ...(nota.contingencia ? { contingencia: nota.contingencia } : {}),
    });
    return { nota, xmlAssinado, autorizacao };
  };

  const tentativas = entrada.tentativasNumero ?? 3;
  let contingencia = entrada.nota.contingencia;
  let tentativaPendente: EmissaoNfe["tentativaPendente"];
  let numero = await entrada.proximoNumero();
  for (let i = 0; i < tentativas; i++) {
    let r: Awaited<ReturnType<typeof enviar>>;
    try {
      r = await enviar(numero, contingencia);
    } catch (erro) {
      // autorizarNota já devolve "pendente" quando a SEFAZ pode ter recebido; o que sobe aqui é
      // falha antes do envio (sem conexão, paralisada) ou erro de programa
      if (contingencia || !entrada.contingencia || !(erro instanceof ErroFiscal)) throw erro;
      if (podeTerSidoProcessado(erro)) throw erro;
      // SEFAZ do estado fora: o mesmo número vai para a SVC (a SEFAZ nunca o recebeu)
      contingencia = svcPara(entrada.contingencia, `${erro.codigo}`);
      i--;
      continue;
    }
    if (r.autorizacao.situacao === "pendente" && !contingencia && entrada.contingencia) {
      // Pode ter sido autorizada: a SVC recebe a venda com outro número
      tentativaPendente = { nota: r.nota, xmlAssinado: r.xmlAssinado };
      contingencia = svcPara(entrada.contingencia, "sem resposta");
      numero = await entrada.proximoNumero();
      i--;
      continue;
    }
    if (r.autorizacao.situacao !== "numero-em-uso") {
      return { ...r, numerosEmUso, ...(tentativaPendente ? { tentativaPendente } : {}) };
    }
    numerosEmUso.push(numero);
    numero = await entrada.proximoNumero();
  }
  throw new ErroFiscal(
    "NFE_SEM_NUMERO_LIVRE",
    `A SEFAZ recusou ${tentativas} números seguidos como já usados (539). Confira a numeração da série.`,
    { numerosEmUso },
  );

  function svcPara(opcao: { justificativa: string; svc?: "SVC-AN" | "SVC-RS" }, motivo: string) {
    return {
      svc: opcao.svc ?? CONTINGENCIA_DA_UF[uf],
      // Nunca depois da emissão (que pode vir informada pelo sistema)
      inicio: entrada.nota.dataEmissao ?? new Date(),
      justificativa: `${opcao.justificativa} (${motivo})`.slice(0, 256),
    };
  }
}
