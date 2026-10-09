import { ErroFiscal } from "@fiscal/core";
import { lerXmlComoObjeto } from "@fiscal/transporte";

/**
 * Chave de acesso da NFS-e Nacional (50 dígitos):
 * município emissor (7) + ambiente gerador (1) + tipo de inscrição (1) + CNPJ/CPF (14)
 * + número da NFS-e (13) + AAMM (4) + código numérico (9) + DV (1)
 */
export function decomporChaveNfse(chave: string) {
  if (!/^\d{50}$/.test(chave)) {
    throw new ErroFiscal("CHAVE_NFSE_INVALIDA", "Chave da NFS-e deve ter 50 dígitos.", { chave });
  }
  return {
    codigoMunicipio: chave.slice(0, 7),
    ambienteGerador: Number(chave[7]),
    tipoInscricao: Number(chave[8]),
    documentoEmitente: chave.slice(9, 23),
    numero: Number(chave.slice(23, 36)),
    anoMes: chave.slice(36, 40),
    codigoNumerico: chave.slice(40, 49),
    digitoVerificador: Number(chave[49]),
  };
}

type No = Record<string, unknown>;
const texto = (v: unknown) => (v === undefined || v === null ? "" : String(v));
const obj = (v: unknown): No => (v && typeof v === "object" ? (v as No) : {});

export interface ResumoNfse {
  chave: string;
  numero: string;
  /** cStat 100 = gerada; o Sistema Nacional usa 107 em algumas respostas de geração */
  situacao: string;
  dataProcessamento: string;
  ambiente: string;
  municipioEmissor: string;
  municipioIncidencia: string;
  descricaoTributacaoNacional: string;
  emitente: { documento: string; nome: string };
  tomador: { documento: string; nome: string };
  servico: { codigoTributacaoNacional: string; descricao: string };
  valores: { servico: string; liquido: string };
  dps: { id: string; serie: string; numero: string; dataEmissao: string; competencia: string };
}

/** Lê os campos principais do XML de uma NFS-e (o que o governo devolve). Útil para DANFSE e listagens. */
export function lerNfse(xml: string): ResumoNfse {
  const raiz = obj(lerXmlComoObjeto(xml).NFSe);
  const inf = obj(raiz.infNFSe);
  if (!inf["@Id"]) throw new ErroFiscal("NFSE_XML_INVALIDO", "XML não é uma NFS-e (sem infNFSe).");
  const infDps = obj(obj(inf.DPS).infDPS);
  const emit = obj(inf.emit);
  const toma = obj(infDps.toma);
  const cServ = obj(obj(infDps.serv).cServ);
  const doc = (n: No) => texto(n.CNPJ ?? n.CPF ?? n.NIF);

  return {
    chave: texto(inf["@Id"]).replace(/^NFS/, ""),
    numero: texto(inf.nNFSe),
    situacao: texto(inf.cStat),
    dataProcessamento: texto(inf.dhProc),
    ambiente: texto(inf.ambGer),
    municipioEmissor: texto(inf.xLocEmi),
    municipioIncidencia: texto(inf.xLocIncid),
    descricaoTributacaoNacional: texto(inf.xTribNac),
    emitente: { documento: doc(emit), nome: texto(emit.xNome) },
    tomador: { documento: doc(toma), nome: texto(toma.xNome) },
    servico: {
      codigoTributacaoNacional: texto(cServ.cTribNac),
      descricao: texto(cServ.xDescServ),
    },
    valores: {
      servico: texto(obj(obj(infDps.valores).vServPrest).vServ),
      liquido: texto(obj(inf.valores).vLiq),
    },
    dps: {
      id: texto(infDps["@Id"]),
      serie: texto(infDps.serie),
      numero: texto(infDps.nDPS),
      dataEmissao: texto(infDps.dhEmi),
      competencia: texto(infDps.dCompet),
    },
  };
}
