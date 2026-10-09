import { nomeMunicipio } from "@fiscal/core/municipios";
import { DOMParser, type Element } from "@xmldom/xmldom";

const primeiro = (no: Element | null | undefined, tag: string): Element | null =>
  no ? (no.getElementsByTagName(tag)[0] ?? null) : null;
const texto = (no: Element | null | undefined, tag: string) =>
  (primeiro(no, tag)?.textContent ?? "").trim();
const ou = (...v: string[]) => v.find(Boolean) ?? "";

export interface DadosDanfse {
  chave: string;
  nNFSe: string;
  nDFSe: string;
  dhProc: string;
  verAplic: string;
  ambGer: string;
  cStat: string;
  municipioEmissor: string;
  tpAmb: string;
  serie: string;
  nDPS: string;
  dhEmiDps: string;
  dCompet: string;
  tpEmit: string;
  prestador: {
    doc: string;
    nome: string;
    im: string;
    fone: string;
    email: string;
    municipio: string;
    cMun: string;
    cep: string;
    endereco: string;
    opSimpNac: string;
    regApTribSN: string;
  };
  tomador: {
    doc: string;
    nome: string;
    im: string;
    fone: string;
    email: string;
    cMun: string;
    municipio: string;
    cep: string;
    endereco: string;
  };
  servico: {
    cTribNac: string;
    cTribMun: string;
    cNBS: string;
    xNBS: string;
    xTribNac: string;
    localPrestacao: string;
    descricao: string;
    infoCompl: string;
  };
  issqn: {
    tipo: string;
    municipioIncidencia: string;
    vBC: string;
    pAliq: string;
    vISSQN: string;
    retencao: string;
  };
  federal: { vRetIRRF: string; vRetCP: string; vRetCSLL: string; vPis: string; vCofins: string };
  valores: {
    vServ: string;
    vDescIncond: string;
    vDescCond: string;
    vTotalRet: string;
    vLiq: string;
  };
}

/** Extrai da NFS-e (XML devolvido pelo Sistema Nacional) tudo que o DANFSE mostra. */
export function lerDanfse(xmlNfse: string): DadosDanfse {
  const doc = new DOMParser().parseFromString(xmlNfse, "text/xml");
  const inf = doc.getElementsByTagName("infNFSe")[0] ?? null;
  if (!inf) throw new Error("XML não parece uma NFS-e (infNFSe ausente).");

  const emit = primeiro(inf, "emit");
  const ender = primeiro(emit, "enderNac");
  const infDps = primeiro(inf, "infDPS");
  const prest = primeiro(infDps, "prest");
  const regTrib = primeiro(prest, "regTrib");
  const toma = primeiro(infDps, "toma");
  const tomaEnd = primeiro(toma, "end");
  const serv = primeiro(infDps, "serv");
  const valDps = primeiro(infDps, "valores");
  const tribMun = primeiro(valDps, "tribMun");
  const tribFed = primeiro(valDps, "tribFed");
  // <valores> aparece duas vezes: o primeiro é o da NFS-e, o segundo o da DPS
  const valNfse = inf.getElementsByTagName("valores")[0] ?? null;
  const juntar = (...partes: string[]) => partes.filter(Boolean).join(", ");

  return {
    chave: (inf.getAttribute("Id") ?? "").replace(/^NFS/, ""),
    nNFSe: texto(inf, "nNFSe"),
    nDFSe: texto(inf, "nDFSe"),
    dhProc: texto(inf, "dhProc"),
    verAplic: texto(inf, "verAplic"),
    ambGer: texto(inf, "ambGer"),
    cStat: texto(inf, "cStat"),
    municipioEmissor: texto(inf, "xLocEmi"),
    tpAmb: texto(infDps, "tpAmb"),
    serie: texto(infDps, "serie"),
    nDPS: texto(infDps, "nDPS"),
    dhEmiDps: texto(infDps, "dhEmi"),
    dCompet: texto(infDps, "dCompet"),
    tpEmit: texto(infDps, "tpEmit"),
    // O DANFSE mostra o que foi informado na DPS; o bloco emit (cadastro da Receita) é reserva
    prestador: {
      doc: ou(texto(prest, "CNPJ"), texto(prest, "CPF"), texto(emit, "CNPJ")),
      nome: texto(emit, "xNome"),
      im: texto(prest, "IM"),
      fone: ou(texto(prest, "fone"), texto(emit, "fone")),
      email: ou(texto(prest, "email"), texto(emit, "email")),
      municipio: ou(nomeMunicipio(texto(ender, "cMun")), texto(inf, "xLocEmi")),
      cMun: texto(ender, "cMun"),
      cep: texto(ender, "CEP"),
      endereco: juntar(texto(ender, "xLgr"), texto(ender, "nro"), texto(ender, "xBairro")),
      opSimpNac: texto(regTrib, "opSimpNac"),
      regApTribSN: texto(regTrib, "regApTribSN"),
    },
    tomador: {
      doc: ou(texto(toma, "CNPJ"), texto(toma, "CPF"), texto(toma, "NIF")),
      nome: texto(toma, "xNome"),
      im: texto(toma, "IM"),
      fone: texto(toma, "fone"),
      email: texto(toma, "email"),
      cMun: texto(tomaEnd, "cMun"),
      municipio: nomeMunicipio(texto(tomaEnd, "cMun")),
      cep: texto(tomaEnd, "CEP"),
      endereco: juntar(
        texto(tomaEnd, "xLgr"),
        texto(tomaEnd, "nro"),
        texto(tomaEnd, "xCpl"),
        texto(tomaEnd, "xBairro"),
      ),
    },
    servico: {
      cTribNac: texto(serv, "cTribNac"),
      cTribMun: texto(serv, "cTribMun"),
      cNBS: texto(serv, "cNBS"),
      xNBS: texto(inf, "xNBS"),
      xTribNac: texto(inf, "xTribNac"),
      localPrestacao: ou(texto(inf, "xLocPrestacao"), nomeMunicipio(texto(serv, "cLocPrestacao"))),
      descricao: texto(serv, "xDescServ"),
      infoCompl: texto(serv, "xInfComp"),
    },
    issqn: {
      tipo: texto(tribMun, "tribISSQN"),
      municipioIncidencia: ou(texto(inf, "xLocIncid"), nomeMunicipio(texto(inf, "cLocIncid"))),
      vBC: texto(valNfse, "vBC"),
      pAliq: ou(texto(valNfse, "pAliqAplic"), texto(tribMun, "pAliq")),
      vISSQN: texto(valNfse, "vISSQN"),
      retencao: texto(tribMun, "tpRetISSQN"),
    },
    federal: {
      vRetIRRF: texto(tribFed, "vRetIRRF"),
      vRetCP: texto(tribFed, "vRetCP"),
      vRetCSLL: texto(tribFed, "vRetCSLL"),
      vPis: texto(tribFed, "vPis"),
      vCofins: texto(tribFed, "vCofins"),
    },
    valores: {
      vServ: texto(valDps, "vServ"),
      vDescIncond: texto(valDps, "vDescIncond"),
      vDescCond: texto(valDps, "vDescCond"),
      vTotalRet: texto(valNfse, "vTotalRet"),
      vLiq: texto(valNfse, "vLiq"),
    },
  };
}
