import { ErroFiscal } from "@fiscal/core";
import { formatarDecimal, tag } from "@fiscal/xml";
import { reais } from "./valores";

/**
 * Impostos do item (grupo <imposto>) para NF-e e NFC-e, com os valores calculados em centavos
 * inteiros (sem erro de ponto flutuante) e somados depois no <ICMSTot>.
 *
 * Cobre o dia a dia de comércio e pequena indústria:
 *  - Simples Nacional (CRT 1/2/4): CSOSN 101 (com crédito), 102, 103, 300, 400, 500;
 *  - Regime normal (CRT 3): CST 00, 20 (base reduzida), 40, 41, 50, 60, com FCP opcional;
 *  - IPI tributado (50/99) ou não tributado (51 a 55);
 *  - PIS/COFINS por alíquota (01/02), não tributados (04 a 09) e outras (49 a 99, zerados).
 * Ainda não: substituição tributária calculada na nota (CST 10/30/70, CSOSN 201/202/203/900),
 * DIFAL (ICMSUFDest), II e IBS/CBS da reforma.
 */

export type Origem = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export type IcmsItem =
  /** Simples com permissão de crédito: informe a alíquota do crédito (Anexo do Simples) */
  | { csosn: "101"; aliquotaCredito: number }
  | { csosn: "102" | "103" | "300" | "400" }
  /** ST já cobrada antes (produto revendido) */
  | { csosn: "500" }
  /** Tributada integralmente */
  | { cst: "00"; aliquota: number; aliquotaFcp?: number }
  /** Base de cálculo reduzida em `reducaoBase` % */
  | { cst: "20"; aliquota: number; reducaoBase: number; aliquotaFcp?: number }
  /** 40 isenta · 41 não tributada · 50 suspensão */
  | { cst: "40" | "41" | "50" }
  /** ST já cobrada antes */
  | { cst: "60" };

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

export interface TributacaoItem {
  /** Origem da mercadoria. Padrão 0 (nacional) */
  origem?: Origem;
  icms: IcmsItem;
  pis?: PisCofinsItem;
  cofins?: PisCofinsItem;
  ipi?: IpiItem;
}

/** Valores do item em centavos (desconto, frete, seguro e outras já repartidos). */
export interface ValoresItem {
  produto: number;
  desconto?: number;
  frete?: number;
  seguro?: number;
  outras?: number;
}

export interface ImpostosItem {
  /** Conteúdo do <imposto> (sem a tag externa) */
  xml: string;
  /** Centavos */
  vBC: number;
  vICMS: number;
  vFCP: number;
  vIPI: number;
  vPIS: number;
  vCOFINS: number;
  /** Crédito de ICMS que o Simples permite ao comprador (CSOSN 101) */
  vCredICMSSN: number;
  /** Alíquota do crédito, para o texto obrigatório nas informações complementares */
  pCredSN?: number;
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

const dec2 = (c: number) => formatarDecimal(reais(c), 2);
const dec4 = (p: number) => formatarDecimal(p, 4);
const pct = (p: number) => Number.isFinite(p) && p >= 0 && p <= 100;

/** Problemas da tributação de um item (para juntar com as outras validações). */
export function problemasTributacao(t: TributacaoItem, crt: 1 | 2 | 3 | 4): string[] {
  const p: string[] = [];
  const icms = t.icms as Partial<Record<string, unknown>>;
  const simples = crt !== 3;
  if ("csosn" in icms && !simples) p.push("CSOSN é só para o Simples; no regime normal use CST.");
  if ("cst" in icms && simples) p.push("Empresa do Simples usa CSOSN, não CST de ICMS.");
  if ("csosn" in icms && !["101", "102", "103", "300", "400", "500"].includes(String(icms.csosn)))
    p.push(`CSOSN ${String(icms.csosn)} ainda não suportado (use 101, 102, 103, 300, 400 ou 500).`);
  if ("cst" in icms && !["00", "20", "40", "41", "50", "60"].includes(String(icms.cst)))
    p.push(`CST de ICMS ${String(icms.cst)} ainda não suportado (use 00, 20, 40, 41, 50 ou 60).`);
  for (const campo of ["aliquota", "aliquotaCredito", "reducaoBase", "aliquotaFcp"] as const) {
    if (campo in icms && !pct(Number(icms[campo])))
      p.push(`ICMS: ${campo} deve ser um percentual de 0 a 100.`);
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
  return p;
}

/**
 * Calcula e monta os impostos do item.
 *
 * Bases: valor da operação = produto − desconto + frete + seguro + outras.
 *  - IPI sobre o valor da operação;
 *  - ICMS sobre o valor da operação, mais o IPI quando o comprador é consumidor final;
 *  - PIS/COFINS sobre o valor da operação sem o ICMS destacado (Lei 14.592/2023), salvo
 *    `icmsNaBasePisCofins: true`.
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
    vBC: 0,
    vICMS: 0,
    vFCP: 0,
    vIPI: 0,
    vPIS: 0,
    vCOFINS: 0,
    vCredICMSSN: 0,
  };

  // IPI primeiro: entra na base do ICMS quando a venda é para consumidor final
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

  const icms = t.icms;
  let grupoIcms: string;
  if ("csosn" in icms) {
    if (icms.csosn === "101") {
      r.vCredICMSSN = aplicarAliquota(operacao, icms.aliquotaCredito);
      r.pCredSN = icms.aliquotaCredito;
      grupoIcms = `<ICMSSN101><orig>${orig}</orig><CSOSN>101</CSOSN>${tag("pCredSN", dec4(icms.aliquotaCredito))}${tag("vCredICMSSN", dec2(r.vCredICMSSN))}</ICMSSN101>`;
    } else if (icms.csosn === "500") {
      grupoIcms = `<ICMSSN500><orig>${orig}</orig><CSOSN>500</CSOSN></ICMSSN500>`;
    } else {
      grupoIcms = `<ICMSSN102><orig>${orig}</orig><CSOSN>${icms.csosn}</CSOSN></ICMSSN102>`;
    }
  } else if (icms.cst === "00" || icms.cst === "20") {
    const cheia = operacao + (opcoes.consumidorFinal ? r.vIPI : 0);
    const reducao = icms.cst === "20" ? icms.reducaoBase : 0;
    // Base reduzida: base × (100 − redução)%
    r.vBC = icms.cst === "20" ? aplicarAliquota(cheia, 100 - reducao) : cheia;
    r.vICMS = aplicarAliquota(r.vBC, icms.aliquota);
    const fcp = icms.aliquotaFcp ? aplicarAliquota(r.vBC, icms.aliquotaFcp) : 0;
    r.vFCP = fcp;
    const grupoFcp = icms.aliquotaFcp
      ? (icms.cst === "20" ? tag("vBCFCP", dec2(r.vBC)) : "") +
        tag("pFCP", dec4(icms.aliquotaFcp)) +
        tag("vFCP", dec2(fcp))
      : "";
    grupoIcms =
      `<ICMS${icms.cst}><orig>${orig}</orig><CST>${icms.cst}</CST><modBC>3</modBC>` +
      (icms.cst === "20" ? tag("pRedBC", dec4(reducao)) : "") +
      tag("vBC", dec2(r.vBC)) +
      tag("pICMS", dec4(icms.aliquota)) +
      tag("vICMS", dec2(r.vICMS)) +
      grupoFcp +
      `</ICMS${icms.cst}>`;
  } else if (icms.cst === "60") {
    grupoIcms = `<ICMS60><orig>${orig}</orig><CST>60</CST></ICMS60>`;
  } else if (icms.cst === "40" || icms.cst === "41" || icms.cst === "50") {
    grupoIcms = `<ICMS40><orig>${orig}</orig><CST>${icms.cst}</CST></ICMS40>`;
  } else {
    throw new ErroFiscal("ICMS_NAO_SUPORTADO", "Tributação de ICMS não suportada.", { icms });
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

  r.xml = `<ICMS>${grupoIcms}</ICMS>${ipi}${pisCofins("PIS", t.pis)}${pisCofins("COFINS", t.cofins)}`;
  return r;
}

/** Texto obrigatório (LC 123/2006, art. 23) quando há crédito de ICMS do Simples (CSOSN 101). */
export function textoCreditoSimples(vCredICMSSN: number, pCredSN: number): string {
  return `PERMITE O APROVEITAMENTO DO CREDITO DE ICMS NO VALOR DE R$ ${dec2(vCredICMSSN).replace(".", ",")}; CORRESPONDENTE A ALIQUOTA DE ${formatarDecimal(pCredSN, 2).replace(".", ",")}%, NOS TERMOS DO ART. 23 DA LEI COMPLEMENTAR No 123, DE 2006`;
}
