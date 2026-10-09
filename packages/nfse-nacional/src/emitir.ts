import {
  type CertificadoA1,
  certificadoServeParaEmitente,
  exigirCertificadoValido,
} from "@fiscal/certificado";
import { ErroFiscal } from "@fiscal/core";
import { assinarXml } from "@fiscal/xml";
import type { ClienteNfse, ResultadoEmissaoNfse } from "./cliente";
import { montarCancelamentoNfse, montarDps } from "./dps";
import type { DadosDps, DpsMontada, Prestador, Servico, Tomador, Valores } from "./tipos";

function conferirCertificado(certificado: CertificadoA1, documento: string, agora?: Date) {
  exigirCertificadoValido(certificado, agora);
  if (!certificadoServeParaEmitente(certificado, documento)) {
    throw new ErroFiscal(
      "CERTIFICADO_DE_OUTRA_EMPRESA",
      `O certificado é do documento ${certificado.documento || "(não identificado)"}, diferente do prestador ${documento}.`,
    );
  }
}

/**
 * Emite uma NFS-e de ponta a ponta: confere o certificado, monta a DPS, assina e envia.
 * Guarde SEMPRE `dps.id` e `xmlDpsAssinado`: se ficar "pendente", `resolverPendente(dps.id)`.
 */
export async function emitirNfse(entrada: {
  cliente: ClienteNfse;
  certificado: CertificadoA1;
  prestador: Prestador;
  tomador?: Tomador;
  servico: Servico;
  valores: Valores;
  dps: DadosDps;
  agora?: Date;
}): Promise<ResultadoEmissaoNfse & { dps: DpsMontada; xmlDpsAssinado: string }> {
  conferirCertificado(entrada.certificado, entrada.prestador.documento, entrada.agora);
  const dps = montarDps(entrada);
  const xmlDpsAssinado = assinarXml(dps.xml, {
    certificado: entrada.certificado,
    elemento: "infDPS",
    perfil: "nfse-nacional",
  });
  const resultado = await entrada.cliente.emitir(xmlDpsAssinado);
  return { ...resultado, dps, xmlDpsAssinado };
}

/** Resolve uma emissão "pendente": procura a NFS-e gerada a partir do Id da DPS. */
export async function resolverPendente(cliente: ClienteNfse, idDps: string) {
  const dps = await cliente.consultarDps(idDps);
  if (!dps.encontrada || !dps.chave) {
    return { gerada: false as const, erros: dps.erros };
  }
  const nfse = await cliente.consultarNfse(dps.chave);
  return {
    gerada: true as const,
    chave: dps.chave,
    ...(nfse.xmlNfse ? { xmlNfse: nfse.xmlNfse } : {}),
  };
}

/** Cancela uma NFS-e (evento e101101). Motivo: 1 erro na emissão · 2 serviço não prestado · 9 outros. */
export async function cancelarNfse(entrada: {
  cliente: ClienteNfse;
  certificado: CertificadoA1;
  chave: string;
  ambiente: 1 | 2;
  versaoAplicativo: string;
  documentoAutor: string;
  motivo: string;
  codigoMotivo?: 1 | 2 | 9;
  agora?: Date;
}) {
  conferirCertificado(entrada.certificado, entrada.documentoAutor, entrada.agora);
  const xml = montarCancelamentoNfse(entrada);
  const assinado = assinarXml(xml, {
    certificado: entrada.certificado,
    elemento: "infPedReg",
    perfil: "nfse-nacional",
  });
  return {
    ...(await entrada.cliente.registrarEvento(entrada.chave, assinado)),
    xmlPedidoAssinado: assinado,
  };
}
