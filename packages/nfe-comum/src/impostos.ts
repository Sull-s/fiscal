import { ErroFiscal } from "@fiscal/core";
import { formatarDecimal, tag } from "@fiscal/xml";
import { reais } from "./valores";

/**
 * Impostos do item (grupo <imposto>) para NF-e e NFC-e, com os valores calculados em centavos
 * inteiros (sem erro de ponto flutuante) e somados depois no <ICMSTot>.
 *
 *  - Simples Nacional (CRT 1/2/4): CSOSN 101 (com crédito), 102, 103, 300, 400, 500 e, com
 *    substituição tributária calculada na nota, 201 (com crédito), 202 e 203;
 *  - Regime normal (CRT 3): CST 00, 20 (base reduzida), 40, 41, 50, 60 e, com ST, 10, 30 e 70;
 *    FCP opcional;
 *  - DIFAL para consumidor final não contribuinte de outro estado (ICMSUFDest), base única ou dupla;
 *  - IPI tributado (50/99) ou não tributado (51 a 55);
 *  - PIS/COFINS por alíquota (01/02), não tributados (04 a 09) e outras (49 a 99, zerados);
 *  - Tributos aproximados (Lei 12.741/2012, tabela IBPT) e IBS/CBS da reforma (NT 2025.002).
 * Ainda não: CSOSN 900, CST 51/90, ICMS monofásico de combustíveis, II.
 */

export type Origem = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/** Substituição tributária calculada na nota (modalidade MVA). */
export interface SubstituicaoTributaria {
  /** Margem de valor agregado (%), da tabela do estado para o NCM */
  mva: number;
  /** Alíquota interna do ICMS no destino (%) */
  aliquota: number;
  /** Redução da base da ST (%) */
  reducaoBase?: number;
  /** FCP sobre a ST (%) */
  aliquotaFcp?: number;
}

export type IcmsItem =
  /** Simples com permissão de crédito: informe a alíquota do crédito (Anexo do Simples) */
  | { csosn: "101"; aliquotaCredito: number }
  | { csosn: "102" | "103" | "300" | "400" }
  /** ST já cobrada antes (produto revendido) */
  | { csosn: "500" }
  /**
   * Simples com ST cobrada nesta nota (201 com crédito; 202 sem; 203 isenta com ST).
   * `aliquotaPropria`: alíquota do ICMS da operação própria, deduzida da ST (como no regime normal).
   */
  | {
      csosn: "201";
      aliquotaCredito: number;
      aliquotaPropria: number;
      st: SubstituicaoTributaria;
    }
  | { csosn: "202" | "203"; aliquotaPropria: number; st: SubstituicaoTributaria }
  /** Tributada integralmente */
  | { cst: "00"; aliquota: number; aliquotaFcp?: number }
  /** Tributada e com ST cobrada nesta nota */
  | { cst: "10"; aliquota: number; aliquotaFcp?: number; st: SubstituicaoTributaria }
  /** Base de cálculo reduzida em `reducaoBase` % */
  | { cst: "20"; aliquota: number; reducaoBase: number; aliquotaFcp?: number }
  /** Isenta ou não tributada, com ST. `aliquotaPropria` (padrão 0) é deduzida da ST */
  | { cst: "30"; aliquotaPropria?: number; st: SubstituicaoTributaria }
  /** 40 isenta · 41 não tributada · 50 suspensão */
  | { cst: "40" | "41" | "50" }
  /** ST já cobrada antes */
  | { cst: "60" }
  /** Base reduzida e com ST */
  | {
      cst: "70";
      aliquota: number;
      reducaoBase: number;
      aliquotaFcp?: number;
      st: SubstituicaoTributaria;
    };

export const CST_PIS_NAO_TRIBUTADO = ["04", "05", "06", "07", "08", "09"] as const;
export const CST_PIS_ALIQUOTA = ["01", "02"] as const;

export type PisCofinsItem =
  /** Tributado pela alíquota (%), ex.: 1,65 e 7,6 no não cumulativo; 0,65 e 3 no cumulativo */
  | { cst: (typeof CST_PIS_ALIQUOTA)[number]; aliquota: number }
  /** 04 monofásico, 06 alíquota zero, 07 isenta, 08 sem incidência, 09 suspensão */
  | { cst: (typeof CST_PIS_NAO_TRIBUTADO)[number] }
  /** 49 a 99: outras operações (vai com valores zerados) */
  | { cst: string };

export type IpiItem =
  | { cst: "50" | "99"; aliquota: number; enquadramento?: string }
  | { cst: "51" | "52" | "53" | "54" | "55"; enquadramento?: string };

/**
 * DIFAL (EC 87/2015, LC 190/2022): venda a consumidor final não contribuinte de outro estado.
 * A diferença entre a alíquota interna do destino e a interestadual vai para o estado de destino.
 */
export interface Difal {
  /** Alíquota interna do ICMS no estado de destino (%) */
  aliquotaInterna: number;
  /** 4 (importados), 7 (S/SE → N/NE/CO/ES) ou 12 */
  aliquotaInterestadual: 4 | 7 | 12;
  /** FCP do destino (%) */
  aliquotaFcp?: number;
  /**
   * Base dupla (cálculo "por dentro" com a alíquota do destino), exigida por vários estados
   * (ex.: MG, PR, RS, SP). Base única: a mesma base da operação. Confirme com o contador.
   */
  baseDupla?: boolean;
}

/** Alíquotas do IBS e da CBS (%). */
export interface AliquotasIbsCbs {
  cbs: number;
  ibsUf: number;
  ibsMun: number;
}

/** Alíquotas de teste de 2026 (LC 214/2025): CBS 0,9% e IBS 0,1% (estadual). */
export const ALIQUOTAS_IBS_CBS_2026: AliquotasIbsCbs = { cbs: 0.9, ibsUf: 0.1, ibsMun: 0 };

/** IBS/CBS do item (reforma tributária, NT 2025.002). */
export interface IbsCbsItem {
  /** CST do IBS/CBS, 3 dígitos (ex.: "000" tributação integral) */
  cst: string;
  /** Classificação tributária, 6 dígitos (ex.: "000001") */
  classificacao: string;
  /** Padrão: alíquotas de teste de 2026 */
  aliquotas?: AliquotasIbsCbs;
}

/** Percentuais aproximados de tributos (tabela IBPT do NCM), para a Lei 12.741/2012. */
export interface TributosAproximados {
  federal: number;
  estadual: number;
  municipal?: number;
}

export interface TributacaoItem {
  /** Origem da mercadoria. Padrão 0 (nacional) */
  origem?: Origem;
  icms: IcmsItem;
  pis?: PisCofinsItem;
  cofins?: PisCofinsItem;
  ipi?: IpiItem;
  /** Só em venda interestadual a consumidor final não contribuinte */
  difal?: Difal;
  ibsCbs?: IbsCbsItem;
  tributosAproximados?: TributosAproximados;
}

/** Valores do item em centavos (desconto, frete, seguro e outras já repartidos). */
export interface ValoresItem {
  produto: number;
  desconto?: number;
  frete?: number;
  seguro?: number;
  outras?: number;
}

/** Valores somados no total da nota (centavos). */
export const CAMPOS_TOTAIS = [
  "vBC",
  "vICMS",
  "vFCP",
  "vBCST",
  "vST",
  "vFCPST",
  "vFCPUFDest",
  "vICMSUFDest",
  "vIPI",
  "vPIS",
  "vCOFINS",
  "vCredICMSSN",
  "vTotTrib",
  "vTribFederal",
  "vTribEstadual",
  "vTribMunicipal",
  "vBCIBSCBS",
  "vIBSUF",
  "vIBSMun",
  "vCBS",
] as const;
export type TotaisImpostos = Record<(typeof CAMPOS_TOTAIS)[number], number>;

export const totaisZerados = (): TotaisImpostos =>
  Object.fromEntries(CAMPOS_TOTAIS.map((c) => [c, 0])) as TotaisImpostos;

export function somarTotais(total: TotaisImpostos, item: TotaisImpostos) {
  for (const c of CAMPOS_TOTAIS) total[c] += item[c];
}

export interface ImpostosItem extends TotaisImpostos {
  /** Conteúdo do <imposto> (sem a tag externa) */
  xml: string;
  /** Alíquota do crédito, para o texto obrigatório nas informações complementares */
  pCredSN?: number;
  /** O item tem DIFAL / IBS-CBS (decide se os grupos de total aparecem) */
  temDifal: boolean;
  temIbsCbs: boolean;
}

/** base × percentual / 100, arredondado (metade para cima) em centavos, com aritmética exata. */
export function aplicarAliquota(baseCentavos: number, percentual: number): number {
  const p = BigInt(formatarDecimal(percentual, 4).replace(".", "")); // × 10^4
  const produto = BigInt(baseCentavos) * p; // × 10^4 × 100
  const divisor = 1_000_000n;
  let r = produto / divisor;
  if ((produto % divisor) * 2n >= divisor) r += 1n;
  return Number(r);
}

/** base / (1 − percentual/100), arredondado em centavos (cálculo "por dentro"). */
function porDentro(baseCentavos: number, percentual: number): number {
  const p = BigInt(formatarDecimal(percentual, 4).replace(".", "")); // × 10^4
  const divisor = 1_000_000n - p; // (100 − p) × 10^4
  const produto = BigInt(baseCentavos) * 1_000_000n;
  let r = produto / divisor;
  if ((produto % divisor) * 2n >= divisor) r += 1n;
  return Number(r);
}

const dec2 = (c: number) => formatarDecimal(reais(c), 2);
const dec4 = (p: number) => formatarDecimal(p, 4);
const pct = (p: number) => Number.isFinite(p) && p >= 0 && p <= 100;

const CSOSN_SUPORTADOS = ["101", "102", "103", "201", "202", "203", "300", "400", "500"];
const CST_SUPORTADOS = ["00", "10", "20", "30", "40", "41", "50", "60", "70"];

/** Problemas da tributação de um item (para juntar com as outras validações). */
export function problemasTributacao(t: TributacaoItem, crt: 1 | 2 | 3 | 4): string[] {
  const p: string[] = [];
  const icms = t.icms as Partial<Record<string, unknown>>;
  const simples = crt !== 3;
  if ("csosn" in icms && !simples) p.push("CSOSN é só para o Simples; no regime normal use CST.");
  if ("cst" in icms && simples) p.push("Empresa do Simples usa CSOSN, não CST de ICMS.");
  if ("csosn" in icms && !CSOSN_SUPORTADOS.includes(String(icms.csosn)))
    p.push(`CSOSN ${String(icms.csosn)} ainda não suportado (use ${CSOSN_SUPORTADOS.join(", ")}).`);
  if ("cst" in icms && !CST_SUPORTADOS.includes(String(icms.cst)))
    p.push(
      `CST de ICMS ${String(icms.cst)} ainda não suportado (use ${CST_SUPORTADOS.join(", ")}).`,
    );
  for (const campo of [
    "aliquota",
    "aliquotaCredito",
    "aliquotaPropria",
    "reducaoBase",
    "aliquotaFcp",
  ] as const) {
    if (campo in icms && icms[campo] !== undefined && !pct(Number(icms[campo])))
      p.push(`ICMS: ${campo} deve ser um percentual de 0 a 100.`);
  }
  const precisaSt = ["10", "30", "70", "201", "202", "203"].includes(
    String(icms.cst ?? icms.csosn),
  );
  const st = icms.st as Partial<SubstituicaoTributaria> | undefined;
  if (precisaSt && !st)
    p.push("ICMS: esta tributação calcula ST e precisa dos dados da ST (mva, aliquota).");
  if (st) {
    if (!(Number(st.mva) >= 0 && Number(st.mva) <= 1000)) p.push("ST: MVA inválida.");
    if (!pct(Number(st.aliquota))) p.push("ST: alíquota inválida.");
    if (st.reducaoBase !== undefined && !pct(st.reducaoBase))
      p.push("ST: redução de base inválida.");
  }
  for (const [nome, imp] of [
    ["PIS", t.pis],
    ["COFINS", t.cofins],
  ] as const) {
    if (!imp) continue;
    const cst = imp.cst;
    if (!/^\d{2}$/.test(cst)) p.push(`${nome}: CST inválido.`);
    else if (simples && (CST_PIS_ALIQUOTA as readonly string[]).includes(cst))
      p.push(`${nome}: no Simples o imposto vai no DAS; use CST 04 a 09, 49 ou 99.`);
    if ("aliquota" in imp && !pct(imp.aliquota)) p.push(`${nome}: alíquota inválida.`);
  }
  if (t.ipi && "aliquota" in t.ipi && !pct(t.ipi.aliquota)) p.push("IPI: alíquota inválida.");
  if (t.difal) {
    if (!pct(t.difal.aliquotaInterna)) p.push("DIFAL: alíquota interna inválida.");
    if (![4, 7, 12].includes(t.difal.aliquotaInterestadual))
      p.push("DIFAL: alíquota interestadual deve ser 4, 7 ou 12.");
  }
  if (t.ibsCbs) {
    if (!/^\d{3}$/.test(t.ibsCbs.cst)) p.push("IBS/CBS: CST deve ter 3 dígitos.");
    if (!/^\d{6}$/.test(t.ibsCbs.classificacao))
      p.push("IBS/CBS: classificação tributária (cClassTrib) deve ter 6 dígitos.");
  }
  return p;
}

/** Grupo da ST: base com MVA (e redução), ICMS-ST deduzido do ICMS próprio, FCP-ST. */
function calcularSt(
  st: SubstituicaoTributaria,
  baseOperacao: number,
  icmsProprio: number,
): { xml: string; vBCST: number; vST: number; vFCPST: number } {
  let vBCST = aplicarAliquota(baseOperacao, 100 + st.mva);
  if (st.reducaoBase) vBCST = aplicarAliquota(vBCST, 100 - st.reducaoBase);
  const vST = Math.max(0, aplicarAliquota(vBCST, st.aliquota) - icmsProprio);
  const vFCPST = st.aliquotaFcp ? aplicarAliquota(vBCST, st.aliquotaFcp) : 0;
  const xml =
    // 4 = margem de valor agregado (MVA)
    tag("modBCST", "4") +
    tag("pMVAST", dec4(st.mva)) +
    (st.reducaoBase ? tag("pRedBCST", dec4(st.reducaoBase)) : "") +
    tag("vBCST", dec2(vBCST)) +
    tag("pICMSST", dec4(st.aliquota)) +
    tag("vICMSST", dec2(vST)) +
    (st.aliquotaFcp
      ? tag("vBCFCPST", dec2(vBCST)) +
        tag("pFCPST", dec4(st.aliquotaFcp)) +
        tag("vFCPST", dec2(vFCPST))
      : "");
  return { xml, vBCST, vST, vFCPST };
}

/**
 * Calcula e monta os impostos do item.
 *
 * Bases: valor da operação = produto − desconto + frete + seguro + outras.
 *  - IPI sobre o valor da operação;
 *  - ICMS sobre o valor da operação, mais o IPI quando o comprador é consumidor final;
 *  - ST: (operação + IPI) × (1 + MVA), menos o ICMS próprio;
 *  - PIS/COFINS sobre o valor da operação sem o ICMS destacado (Lei 14.592/2023), salvo
 *    `icmsNaBasePisCofins: true`;
 *  - IBS/CBS sobre a operação sem ICMS, FCP, DIFAL, PIS e COFINS (NT 2025.002).
 */
export function calcularImpostos(
  t: TributacaoItem,
  v: ValoresItem,
  opcoes: { consumidorFinal: boolean; icmsNaBasePisCofins?: boolean },
): ImpostosItem {
  const orig = String(t.origem ?? 0);
  const operacao =
    v.produto - (v.desconto ?? 0) + (v.frete ?? 0) + (v.seguro ?? 0) + (v.outras ?? 0);
  const r: ImpostosItem = {
    xml: "",
    ...totaisZerados(),
    temDifal: false,
    temIbsCbs: false,
  };

  // IPI primeiro: entra na base do ICMS (consumidor final) e na base da ST
  let ipi = "";
  if (t.ipi) {
    const cEnq = tag("cEnq", t.ipi.enquadramento ?? "999");
    if ("aliquota" in t.ipi) {
      r.vIPI = aplicarAliquota(operacao, t.ipi.aliquota);
      ipi = `<IPI>${cEnq}<IPITrib>${tag("CST", t.ipi.cst)}${tag("vBC", dec2(operacao))}${tag("pIPI", dec4(t.ipi.aliquota))}${tag("vIPI", dec2(r.vIPI))}</IPITrib></IPI>`;
    } else {
      ipi = `<IPI>${cEnq}<IPINT>${tag("CST", t.ipi.cst)}</IPINT></IPI>`;
    }
  }
  const baseSt = operacao + r.vIPI;

  /**
   * ICMS próprio (00/10/20/70): base (com redução), valor e FCP. Só o grupo 00 não leva a base
   * do FCP (vBCFCP).
   */
  const proprio = (
    aliquota: number,
    reducao: number,
    aliquotaFcp: number | undefined,
    comBaseFcp = true,
  ) => {
    const cheia = operacao + (opcoes.consumidorFinal ? r.vIPI : 0);
    r.vBC = reducao ? aplicarAliquota(cheia, 100 - reducao) : cheia;
    r.vICMS = aplicarAliquota(r.vBC, aliquota);
    r.vFCP = aliquotaFcp ? aplicarAliquota(r.vBC, aliquotaFcp) : 0;
    return (
      (reducao ? tag("pRedBC", dec4(reducao)) : "") +
      tag("vBC", dec2(r.vBC)) +
      tag("pICMS", dec4(aliquota)) +
      tag("vICMS", dec2(r.vICMS)) +
      (aliquotaFcp
        ? (comBaseFcp ? tag("vBCFCP", dec2(r.vBC)) : "") +
          tag("pFCP", dec4(aliquotaFcp)) +
          tag("vFCP", dec2(r.vFCP))
        : "")
    );
  };
  const aplicarSt = (st: SubstituicaoTributaria, icmsProprio: number) => {
    const s = calcularSt(st, baseSt, icmsProprio);
    r.vBCST = s.vBCST;
    r.vST = s.vST;
    r.vFCPST = s.vFCPST;
    return s.xml;
  };

  const icms = t.icms;
  let grupoIcms: string;
  if ("csosn" in icms) {
    switch (icms.csosn) {
      case "101":
        r.vCredICMSSN = aplicarAliquota(operacao, icms.aliquotaCredito);
        r.pCredSN = icms.aliquotaCredito;
        grupoIcms = `<ICMSSN101><orig>${orig}</orig><CSOSN>101</CSOSN>${tag("pCredSN", dec4(icms.aliquotaCredito))}${tag("vCredICMSSN", dec2(r.vCredICMSSN))}</ICMSSN101>`;
        break;
      case "201": {
        const st = aplicarSt(icms.st, aplicarAliquota(operacao, icms.aliquotaPropria));
        r.vCredICMSSN = aplicarAliquota(operacao, icms.aliquotaCredito);
        r.pCredSN = icms.aliquotaCredito;
        grupoIcms = `<ICMSSN201><orig>${orig}</orig><CSOSN>201</CSOSN>${st}${tag("pCredSN", dec4(icms.aliquotaCredito))}${tag("vCredICMSSN", dec2(r.vCredICMSSN))}</ICMSSN201>`;
        break;
      }
      case "202":
      case "203": {
        const st = aplicarSt(icms.st, aplicarAliquota(operacao, icms.aliquotaPropria));
        grupoIcms = `<ICMSSN202><orig>${orig}</orig><CSOSN>${icms.csosn}</CSOSN>${st}</ICMSSN202>`;
        break;
      }
      case "500":
        grupoIcms = `<ICMSSN500><orig>${orig}</orig><CSOSN>500</CSOSN></ICMSSN500>`;
        break;
      default:
        grupoIcms = `<ICMSSN102><orig>${orig}</orig><CSOSN>${icms.csosn}</CSOSN></ICMSSN102>`;
    }
  } else {
    const abre = `<ICMS${icms.cst === "41" || icms.cst === "50" ? "40" : icms.cst}><orig>${orig}</orig><CST>${icms.cst}</CST>`;
    switch (icms.cst) {
      case "00":
        grupoIcms = `${abre}<modBC>3</modBC>${proprio(icms.aliquota, 0, icms.aliquotaFcp, false)}</ICMS00>`;
        break;
      case "20":
        grupoIcms = `${abre}<modBC>3</modBC>${proprio(icms.aliquota, icms.reducaoBase, icms.aliquotaFcp)}</ICMS20>`;
        break;
      case "10": {
        const p = proprio(icms.aliquota, 0, icms.aliquotaFcp);
        grupoIcms = `${abre}<modBC>3</modBC>${p}${aplicarSt(icms.st, r.vICMS)}</ICMS10>`;
        break;
      }
      case "70": {
        const p = proprio(icms.aliquota, icms.reducaoBase, icms.aliquotaFcp);
        grupoIcms = `${abre}<modBC>3</modBC>${p}${aplicarSt(icms.st, r.vICMS)}</ICMS70>`;
        break;
      }
      case "30":
        grupoIcms = `${abre}${aplicarSt(icms.st, aplicarAliquota(operacao, icms.aliquotaPropria ?? 0))}</ICMS30>`;
        break;
      case "60":
        grupoIcms = `${abre}</ICMS60>`;
        break;
      case "40":
      case "41":
      case "50":
        grupoIcms = `${abre}</ICMS40>`;
        break;
      default:
        throw new ErroFiscal("ICMS_NAO_SUPORTADO", "Tributação de ICMS não suportada.", { icms });
    }
  }

  const basePisCofins = operacao - (opcoes.icmsNaBasePisCofins ? 0 : r.vICMS);
  const pisCofins = (imp: "PIS" | "COFINS", trib: PisCofinsItem | undefined) => {
    if (!trib) return "";
    const cst = trib.cst;
    if ("aliquota" in trib && (CST_PIS_ALIQUOTA as readonly string[]).includes(cst)) {
      const valor = aplicarAliquota(basePisCofins, trib.aliquota);
      if (imp === "PIS") r.vPIS = valor;
      else r.vCOFINS = valor;
      return `<${imp}><${imp}Aliq>${tag("CST", cst)}${tag("vBC", dec2(basePisCofins))}${tag(`p${imp}`, dec4(trib.aliquota))}${tag(`v${imp}`, dec2(valor))}</${imp}Aliq></${imp}>`;
    }
    if ((CST_PIS_NAO_TRIBUTADO as readonly string[]).includes(cst)) {
      return `<${imp}><${imp}NT><CST>${cst}</CST></${imp}NT></${imp}>`;
    }
    return `<${imp}><${imp}Outr><CST>${cst}</CST><vBC>0.00</vBC><p${imp}>0.0000</p${imp}><v${imp}>0.00</v${imp}></${imp}Outr></${imp}>`;
  };
  const pis = pisCofins("PIS", t.pis);
  const cofins = pisCofins("COFINS", t.cofins);

  // DIFAL: a parte do estado de destino
  let difal = "";
  if (t.difal) {
    const d = t.difal;
    const base = r.vBC || operacao + (opcoes.consumidorFinal ? r.vIPI : 0);
    const icmsInter = aplicarAliquota(base, d.aliquotaInterestadual);
    const baseDestino = d.baseDupla ? porDentro(base - icmsInter, d.aliquotaInterna) : base;
    r.vICMSUFDest = Math.max(0, aplicarAliquota(baseDestino, d.aliquotaInterna) - icmsInter);
    r.vFCPUFDest = d.aliquotaFcp ? aplicarAliquota(baseDestino, d.aliquotaFcp) : 0;
    r.temDifal = true;
    difal =
      "<ICMSUFDest>" +
      tag("vBCUFDest", dec2(baseDestino)) +
      tag("vBCFCPUFDest", dec2(baseDestino)) +
      tag("pFCPUFDest", dec4(d.aliquotaFcp ?? 0)) +
      tag("pICMSUFDest", dec4(d.aliquotaInterna)) +
      tag("pICMSInter", formatarDecimal(d.aliquotaInterestadual, 2)) +
      // Desde 2019 o DIFAL é 100% do estado de destino
      tag("pICMSInterPart", "100.0000") +
      tag("vFCPUFDest", dec2(r.vFCPUFDest)) +
      tag("vICMSUFDest", dec2(r.vICMSUFDest)) +
      tag("vICMSUFRemet", "0.00") +
      "</ICMSUFDest>";
  }

  // IBS/CBS (reforma): em 2026 é informativo e não soma no total da nota
  let ibsCbs = "";
  if (t.ibsCbs) {
    const a = t.ibsCbs.aliquotas ?? ALIQUOTAS_IBS_CBS_2026;
    r.vBCIBSCBS = Math.max(
      0,
      operacao - r.vICMS - r.vFCP - r.vICMSUFDest - r.vFCPUFDest - r.vPIS - r.vCOFINS,
    );
    r.vIBSUF = aplicarAliquota(r.vBCIBSCBS, a.ibsUf);
    r.vIBSMun = aplicarAliquota(r.vBCIBSCBS, a.ibsMun);
    r.vCBS = aplicarAliquota(r.vBCIBSCBS, a.cbs);
    r.temIbsCbs = true;
    ibsCbs =
      "<IBSCBS>" +
      tag("CST", t.ibsCbs.cst) +
      tag("cClassTrib", t.ibsCbs.classificacao) +
      "<gIBSCBS>" +
      tag("vBC", dec2(r.vBCIBSCBS)) +
      `<gIBSUF>${tag("pIBSUF", dec4(a.ibsUf))}${tag("vIBSUF", dec2(r.vIBSUF))}</gIBSUF>` +
      `<gIBSMun>${tag("pIBSMun", dec4(a.ibsMun))}${tag("vIBSMun", dec2(r.vIBSMun))}</gIBSMun>` +
      tag("vIBS", dec2(r.vIBSUF + r.vIBSMun)) +
      `<gCBS>${tag("pCBS", dec4(a.cbs))}${tag("vCBS", dec2(r.vCBS))}</gCBS>` +
      "</gIBSCBS></IBSCBS>";
  }

  // Lei da transparência: valor aproximado dos tributos (vai na frente do grupo)
  let totTrib = "";
  if (t.tributosAproximados) {
    const ta = t.tributosAproximados;
    r.vTribFederal = aplicarAliquota(operacao, ta.federal);
    r.vTribEstadual = aplicarAliquota(operacao, ta.estadual);
    r.vTribMunicipal = aplicarAliquota(operacao, ta.municipal ?? 0);
    r.vTotTrib = r.vTribFederal + r.vTribEstadual + r.vTribMunicipal;
    totTrib = tag("vTotTrib", dec2(r.vTotTrib));
  }

  r.xml = `${totTrib}<ICMS>${grupoIcms}</ICMS>${ipi}${pis}${cofins}${difal}${ibsCbs}`;
  return r;
}

/**
 * Campos do <ICMSTot> que dependem dos impostos, na ordem do leiaute (do vBC ao vFCPSTRet),
 * e o grupo <IBSCBSTot> quando algum item tem IBS/CBS.
 */
export function totaisIcms(t: TotaisImpostos, opcoes: { difal: boolean }) {
  const d = dec2;
  return (
    tag("vBC", d(t.vBC)) +
    tag("vICMS", d(t.vICMS)) +
    tag("vICMSDeson", "0.00") +
    (opcoes.difal
      ? tag("vFCPUFDest", d(t.vFCPUFDest)) +
        tag("vICMSUFDest", d(t.vICMSUFDest)) +
        tag("vICMSUFRemet", "0.00")
      : "") +
    tag("vFCP", d(t.vFCP)) +
    tag("vBCST", d(t.vBCST)) +
    tag("vST", d(t.vST)) +
    tag("vFCPST", d(t.vFCPST)) +
    tag("vFCPSTRet", "0.00")
  );
}

/** Grupo <IBSCBSTot> (depois do <ICMSTot>). */
export function totalIbsCbs(t: TotaisImpostos): string {
  const zero = "<vDif>0.00</vDif><vDevTrib>0.00</vDevTrib>";
  return (
    "<IBSCBSTot>" +
    tag("vBCIBSCBS", dec2(t.vBCIBSCBS)) +
    "<gIBS>" +
    `<gIBSUF>${zero}${tag("vIBSUF", dec2(t.vIBSUF))}</gIBSUF>` +
    `<gIBSMun>${zero}${tag("vIBSMun", dec2(t.vIBSMun))}</gIBSMun>` +
    tag("vIBS", dec2(t.vIBSUF + t.vIBSMun)) +
    "<vCredPres>0.00</vCredPres><vCredPresCondSus>0.00</vCredPresCondSus>" +
    "</gIBS>" +
    `<gCBS>${zero}${tag("vCBS", dec2(t.vCBS))}<vCredPres>0.00</vCredPres><vCredPresCondSus>0.00</vCredPresCondSus></gCBS>` +
    "</IBSCBSTot>"
  );
}

/** Texto obrigatório (LC 123/2006, art. 23) quando há crédito de ICMS do Simples (CSOSN 101/201). */
export function textoCreditoSimples(vCredICMSSN: number, pCredSN: number): string {
  return `PERMITE O APROVEITAMENTO DO CREDITO DE ICMS NO VALOR DE R$ ${dec2(vCredICMSSN).replace(".", ",")}; CORRESPONDENTE A ALIQUOTA DE ${formatarDecimal(pCredSN, 2).replace(".", ",")}%, NOS TERMOS DO ART. 23 DA LEI COMPLEMENTAR No 123, DE 2006`;
}

/** Texto da Lei 12.741/2012 (tributos aproximados), para as informações complementares. */
export function textoTributosAproximados(t: TotaisImpostos, fonte = "IBPT"): string {
  const r = (c: number) => `R$ ${dec2(c).replace(".", ",")}`;
  return `Trib aprox: ${r(t.vTribFederal)} Federal, ${r(t.vTribEstadual)} Estadual e ${r(t.vTribMunicipal)} Municipal. Fonte: ${fonte}`;
}
