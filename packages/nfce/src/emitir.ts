import {
  type CertificadoA1,
  certificadoServeParaEmitente,
  exigirCertificadoValido,
} from "@fiscal/certificado";
import { ErroFiscal } from "@fiscal/core";
import { type ClienteSefaz, podeTerSidoProcessado } from "@fiscal/transporte";
import { assinarXml } from "@fiscal/xml";
import { montarNfce } from "./montar";
import { type ResultadoAutorizacao, autorizarNfce } from "./sefaz";
import type { Contingencia, DadosNota, EmitenteNfce, NfceMontada, Venda } from "./tipos";

/** xJust aceita até 256 caracteres */
const limitar = (texto: string) => texto.slice(0, 256);

export interface EmissaoNfce {
  nota: NfceMontada;
  /** NFe assinada, como foi enviada. Guarde SEMPRE, mesmo se ficar pendente */
  xmlAssinado: string;
  autorizacao: ResultadoAutorizacao;
  /**
   * Números que a SEFAZ disse já estarem em uso por outra nota (539). Ficam gastos: marque como
   * usados na sua numeração para nunca serem dados como "pulados".
   */
  numerosEmUso: number[];
  /**
   * Só quando a nota saiu offline depois de uma tentativa online sem resposta: essa tentativa
   * pode ter sido autorizada. Consulte-a (`consultarNfce`); se autorizada, cancele-a por
   * substituição (`cancelarNfce` com `chaveSubstituta` = chave da nota offline).
   */
  tentativaOnlinePendente?: { nota: NfceMontada; xmlAssinado: string };
}

/**
 * Emite uma NFC-e de ponta a ponta: confere o certificado, monta, assina, envia e trata a resposta.
 *
 * - "autorizada": guarde `autorizacao.xmlProcessado` (nfeProc).
 * - "pendente": guarde `xmlAssinado` e resolva depois com `consultarNfce` (a SEFAZ pode ter autorizado).
 * - "denegada": o número fica gasto.
 * - "rejeitada": nada foi registrado; o número continua livre. Veja `autorizacao.cStat/motivo`.
 *
 * `proximoNumero` deve reservar o número de forma atômica (duas vendas ao mesmo tempo não podem
 * receber o mesmo número). Se a SEFAZ responder 539, pede outro número e tenta de novo.
 *
 * Com `contingencia`, se a SEFAZ estiver inacessível ou paralisada, a nota sai offline (situação
 * "offline"): imprima o DANFE e transmita depois com `transmitirNfceOffline`. Se a SEFAZ nunca
 * recebeu a tentativa online, o mesmo número é reaproveitado; se pode ter recebido (sem resposta),
 * a nota offline usa outro número e a tentativa vem em `tentativaOnlinePendente`.
 * Com `nota.contingencia` preenchida, já emite direto offline, sem tentar a SEFAZ.
 */
export async function emitirNfce(entrada: {
  cliente: ClienteSefaz;
  certificado: CertificadoA1;
  emitente: EmitenteNfce;
  venda: Venda;
  nota: Omit<DadosNota, "numero" | "codigoNumerico">;
  proximoNumero: () => Promise<number>;
  /** Padrão 3 */
  tentativasNumero?: number;
  /** Momento de referência para validar o certificado (padrão: agora) */
  agora?: Date;
  /** Entrar em contingência offline automaticamente se a SEFAZ não estiver disponível */
  contingencia?: { justificativa: string };
}): Promise<EmissaoNfce> {
  const { cliente, certificado, emitente, venda } = entrada;
  exigirCertificadoValido(certificado, entrada.agora);
  if (!certificadoServeParaEmitente(certificado, emitente.cnpj)) {
    throw new ErroFiscal(
      "CERTIFICADO_DE_OUTRA_EMPRESA",
      `O certificado é do CNPJ ${certificado.documento || "(não identificado)"}, que não tem a mesma raiz do emitente ${emitente.cnpj}.`,
      { documentoCertificado: certificado.documento, cnpjEmitente: emitente.cnpj },
    );
  }

  const montarAssinada = (dados: DadosNota) => {
    const nota = montarNfce({ emitente, venda, nota: dados, certificado });
    const xmlAssinado = assinarXml(nota.xml, { certificado, elemento: "infNFe", perfil: "sefaz" });
    return { nota, xmlAssinado };
  };
  const numerosEmUso: number[] = [];

  const offline = async (
    numero: number,
    contingencia: Contingencia,
    tentativaOnlinePendente?: EmissaoNfce["tentativaOnlinePendente"],
  ): Promise<EmissaoNfce> => {
    const { nota, xmlAssinado } = montarAssinada({ ...entrada.nota, numero, contingencia });
    return {
      nota,
      xmlAssinado,
      autorizacao: {
        situacao: "offline",
        cStat: "",
        motivo: `Emitida em contingência offline: ${contingencia.justificativa}`,
      },
      numerosEmUso,
      ...(tentativaOnlinePendente ? { tentativaOnlinePendente } : {}),
    };
  };

  if (entrada.nota.contingencia) {
    return offline(await entrada.proximoNumero(), entrada.nota.contingencia);
  }

  const tentativas = entrada.tentativasNumero ?? 3;
  for (let i = 0; i < tentativas; i++) {
    const numero = await entrada.proximoNumero();
    const { nota, xmlAssinado } = montarAssinada({ ...entrada.nota, numero });
    let autorizacao: ResultadoAutorizacao;
    try {
      autorizacao = await autorizarNfce(cliente, {
        uf: emitente.endereco.uf,
        ambiente: entrada.nota.ambiente,
        xmlAssinado,
      });
    } catch (erro) {
      // Sem contingência, ou erro de programa (não de comunicação): sobe como está
      if (!entrada.contingencia || !(erro instanceof ErroFiscal)) throw erro;
      const inicio = entrada.nota.dataEmissao ?? new Date();
      const motivo = limitar(`${entrada.contingencia.justificativa} (${erro.codigo})`);
      if (!podeTerSidoProcessado(erro)) return offline(numero, { inicio, justificativa: motivo });
      return offline(
        await entrada.proximoNumero(),
        { inicio, justificativa: motivo },
        {
          nota,
          xmlAssinado,
        },
      );
    }
    if (autorizacao.situacao === "pendente" && entrada.contingencia) {
      const justificativa = limitar(`${entrada.contingencia.justificativa} (sem resposta)`);
      return offline(
        await entrada.proximoNumero(),
        { inicio: entrada.nota.dataEmissao ?? new Date(), justificativa },
        { nota, xmlAssinado },
      );
    }
    if (autorizacao.situacao !== "numero-em-uso") {
      return { nota, xmlAssinado, autorizacao, numerosEmUso };
    }
    numerosEmUso.push(numero);
  }
  throw new ErroFiscal(
    "NFCE_SEM_NUMERO_LIVRE",
    `A SEFAZ recusou ${tentativas} números seguidos como já usados (539). Confira a numeração da série.`,
    { numerosEmUso },
  );
}
