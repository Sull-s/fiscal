import { XMLParser } from "fast-xml-parser";

const leitor = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  parseTagValue: false,
  isArray: (nome) => ["det", "detPag", "dup", "vol", "NFref"].includes(nome),
});

type No = Record<string, unknown>;
const o = (v: unknown): No => (v && typeof v === "object" ? (v as No) : {});
const s = (v: unknown) => (v === undefined || v === null ? "" : String(v));
const lista = (v: unknown) => (Array.isArray(v) ? (v as No[]) : []);

export interface ItemDanfe {
  codigo: string;
  descricao: string;
  ncm: string;
  /** Origem + CST/CSOSN, ex.: "0102" */
  cst: string;
  cfop: string;
  unidade: string;
  quantidade: string;
  valorUnitario: string;
  valorTotal: string;
  desconto: string;
  bcIcms: string;
  valorIcms: string;
  valorIpi: string;
  aliquotaIcms: string;
  aliquotaIpi: string;
  informacoes: string;
}

export interface DadosDanfe {
  chave: string;
  ambiente: "1" | "2";
  numero: string;
  serie: string;
  /** "0" entrada, "1" saída */
  tipo: string;
  naturezaOperacao: string;
  dataEmissao: string;
  dataSaida: string;
  crt: string;
  emitente: {
    nome: string;
    fantasia: string;
    cnpj: string;
    ie: string;
    ieSt: string;
    logradouro: string;
    bairro: string;
    municipio: string;
    uf: string;
    cep: string;
    fone: string;
  };
  destinatario: {
    nome: string;
    documento: string;
    ie: string;
    logradouro: string;
    bairro: string;
    municipio: string;
    uf: string;
    cep: string;
    fone: string;
  };
  totais: Record<string, string>;
  transporte: {
    modalidade: string;
    nome: string;
    documento: string;
    ie: string;
    endereco: string;
    municipio: string;
    uf: string;
    volumes: {
      qVol: string;
      esp: string;
      marca: string;
      nVol: string;
      pesoB: string;
      pesoL: string;
    }[];
  };
  duplicatas: { numero: string; vencimento: string; valor: string }[];
  itens: ItemDanfe[];
  informacoesComplementares: string;
  informacoesFisco: string;
  protocolo?: { numero: string; data: string };
}

function imposto(det: No) {
  const imp = o(det.imposto);
  // O grupo de ICMS tem um filho só (ICMS00, ICMSSN102…)
  const icms = o(Object.values(o(imp.ICMS))[0]);
  const ipiTrib = o(o(imp.IPI).IPITrib);
  return {
    cst: `${s(icms.orig)}${s(icms.CST ?? icms.CSOSN)}`,
    bcIcms: s(icms.vBC),
    valorIcms: s(icms.vICMS),
    aliquotaIcms: s(icms.pICMS),
    valorIpi: s(ipiTrib.vIPI),
    aliquotaIpi: s(ipiTrib.pIPI),
  };
}

/** Lê o XML da NF-e (nfeProc autorizado ou NFe ainda sem protocolo) para o DANFE. */
export function lerDanfe(xml: string): DadosDanfe {
  const raiz = leitor.parse(xml) as No;
  const proc = o(raiz.nfeProc);
  const inf = o(o(proc.NFe ?? raiz.NFe).infNFe);
  const ide = o(inf.ide);
  const emit = o(inf.emit);
  const ee = o(emit.enderEmit);
  const dest = o(inf.dest);
  const ed = o(dest.enderDest);
  const transp = o(inf.transp);
  const transporta = o(transp.transporta);
  const prot = o(o(proc.protNFe).infProt);
  const adic = o(inf.infAdic);
  const endereco = (e: No) => [s(e.xLgr), s(e.nro), s(e.xCpl)].filter(Boolean).join(", ");

  return {
    chave: s(inf["@Id"]).replace(/^NFe/, ""),
    ambiente: s(ide.tpAmb) === "1" ? "1" : "2",
    numero: s(ide.nNF),
    serie: s(ide.serie),
    tipo: s(ide.tpNF),
    naturezaOperacao: s(ide.natOp),
    dataEmissao: s(ide.dhEmi),
    dataSaida: s(ide.dhSaiEnt),
    crt: s(emit.CRT),
    emitente: {
      nome: s(emit.xNome),
      fantasia: s(emit.xFant),
      cnpj: s(emit.CNPJ ?? emit.CPF),
      ie: s(emit.IE),
      ieSt: s(emit.IEST),
      logradouro: endereco(ee),
      bairro: s(ee.xBairro),
      municipio: s(ee.xMun),
      uf: s(ee.UF),
      cep: s(ee.CEP),
      fone: s(ee.fone),
    },
    destinatario: {
      nome: s(dest.xNome),
      documento: s(dest.CNPJ ?? dest.CPF ?? dest.idEstrangeiro),
      ie: s(dest.IE),
      logradouro: endereco(ed),
      bairro: s(ed.xBairro),
      municipio: s(ed.xMun),
      uf: s(ed.UF),
      cep: s(ed.CEP),
      fone: s(ed.fone),
    },
    totais: Object.fromEntries(Object.entries(o(o(inf.total).ICMSTot)).map(([k, v]) => [k, s(v)])),
    transporte: {
      modalidade: s(transp.modFrete),
      nome: s(transporta.xNome),
      documento: s(transporta.CNPJ ?? transporta.CPF),
      ie: s(transporta.IE),
      endereco: s(transporta.xEnder),
      municipio: s(transporta.xMun),
      uf: s(transporta.UF),
      volumes: lista(transp.vol).map((v) => ({
        qVol: s(v.qVol),
        esp: s(v.esp),
        marca: s(v.marca),
        nVol: s(v.nVol),
        pesoB: s(v.pesoB),
        pesoL: s(v.pesoL),
      })),
    },
    duplicatas: lista(o(inf.cobr).dup).map((d) => ({
      numero: s(d.nDup),
      vencimento: s(d.dVenc),
      valor: s(d.vDup),
    })),
    itens: lista(inf.det).map((det) => {
      const p = o(det.prod);
      return {
        codigo: s(p.cProd),
        descricao: s(p.xProd),
        ncm: s(p.NCM),
        cfop: s(p.CFOP),
        unidade: s(p.uCom),
        quantidade: s(p.qCom),
        valorUnitario: s(p.vUnCom),
        valorTotal: s(p.vProd),
        desconto: s(p.vDesc),
        informacoes: s(det.infAdProd),
        ...imposto(det),
      };
    }),
    informacoesComplementares: s(adic.infCpl),
    informacoesFisco: s(adic.infAdFisco),
    ...(prot.nProt ? { protocolo: { numero: s(prot.nProt), data: s(prot.dhRecbto) } } : {}),
  };
}
