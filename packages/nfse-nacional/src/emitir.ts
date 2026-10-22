import {
  type CertificadoA1,
  certificadoServeParaEmitente,
  exigirCertificadoValido,
} from "@fiscal/certificado";
import { ErroFiscal } from "@fiscal/core";
import { assinarXml } from "@fiscal/xml";
import type { ClienteNfse, ErroNfse, ResultadoEmissaoNfse } from "./cliente";
import { LEIAUTE_PADRAO, montarCancelamentoNfse, montarDps } from "./dps";
import type {
  DadosDps,
  DpsMontada,
  LeiauteDps,
  Prestador,
  Servico,
  Tomador,
  Valores,
} from "./tipos";

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
 * Leiaute que o Sistema Nacional aceitou por último em cada ambiente (vale até o processo
 * reiniciar). Começa no LEIAUTE_PADRAO; muda sozinho quando o governo vira o esquema.
 */
const leiauteAceito = new Map<1 | 2, LeiauteDps>();

/** Leiaute que a próxima emissão vai usar no ambiente (para log e para a tela de testes) */
export const leiauteEmUso = (ambiente: 1 | 2): LeiauteDps =>
  leiauteAceito.get(ambiente) ?? LEIAUTE_PADRAO[ambiente];

/**
 * Recusa de esquema (E1235) num dos campos que mudaram entre os leiautes: a DPS nem foi
 * registrada (o número não foi gasto) e o outro leiaute pode passar.
 */
export const recusaDeLeiaute = (erros: ErroNfse[]) =>
  erros.some(
    (e) =>
      e.codigo === "E1235" &&
      /finNFSe|cMotivoEmisTI|chNFSeRej|xDescServ|cNBS|cIntContrib/.test(
        `${e.descricao} ${e.complemento ?? ""}`,
      ),
  );

/**
 * Emite uma NFS-e de ponta a ponta: confere o certificado, monta a DPS, assina e envia.
 * Guarde SEMPRE `dps.id` e `xmlDpsAssinado`: se ficar "pendente", `resolverPendente(dps.id)`.
 *
 * Virada de leiaute: sem `dps.leiaute` forçado, se o Sistema Nacional recusar por esquema num
 * campo que mudou (recusaDeLeiaute), a mesma DPS é montada no outro leiaute e enviada de novo
 * (uma vez). O que passar fica valendo para as próximas emissões daquele ambiente.
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
  const ambiente = entrada.dps.ambiente;
  const enviar = async (leiaute: LeiauteDps) => {
    const dps = montarDps({ ...entrada, dps: { ...entrada.dps, leiaute } });
    const xmlDpsAssinado = assinarXml(dps.xml, {
      certificado: entrada.certificado,
      elemento: "infDPS",
      perfil: "nfse-nacional",
    });
    return { ...(await entrada.cliente.emitir(xmlDpsAssinado)), dps, xmlDpsAssinado };
  };

  const primeiro = entrada.dps.leiaute ?? leiauteEmUso(ambiente);
  const resultado = await enviar(primeiro);
  if (resultado.situacao === "autorizada" && !entrada.dps.leiaute)
    leiauteAceito.set(ambiente, primeiro);
  if (
    entrada.dps.leiaute ||
    resultado.situacao !== "rejeitada" ||
    !recusaDeLeiaute(resultado.erros)
  )
    return resultado;

  const outro: LeiauteDps = primeiro === "2026-02" ? "2026-10" : "2026-02";
  const segundo = await enviar(outro);
  // O outro também recusou pelo esquema: a mudança é outra; devolve a primeira resposta
  if (segundo.situacao === "rejeitada" && recusaDeLeiaute(segundo.erros)) return resultado;
  leiauteAceito.set(ambiente, outro);
  return {
    ...segundo,
    alertas: [
      ...segundo.alertas,
      {
        codigo: "LEIAUTE_TROCADO",
        descricao: `O Sistema Nacional recusou o leiaute ${primeiro} e aceitou o ${outro}; as próximas emissões deste ambiente usam o ${outro}.`,
      },
    ],
  };
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
