import { ErroFiscal, limparCnpj, validarCnpj, validarCpf } from "@fiscal/core";
import { problemasTributacao } from "@fiscal/nfe-comum";
import { somenteDigitos } from "@fiscal/xml";
import type { EmitenteNfce, Venda } from "./tipos";
import { URLS_CONSULTA_NFCE } from "./urls-consulta";

export const CSOSN_ACEITOS = ["102", "103", "300", "400", "500"];
/**
 * CST de PIS/COFINS para empresa do Simples (o imposto é pago no DAS, não na nota):
 *   04 a 09 = não tributado (04 = monofásico, ex.: refrigerante e água) → PISNT/COFINSNT
 *   49 e 99 = outras saídas → PISOutr/COFINSOutr com valores zerados
 */
export const CST_PIS_NAO_TRIBUTADO = ["04", "05", "06", "07", "08", "09"];
export const CST_PIS_OUTRAS = ["49", "99"];

export const cstPisCofins = (cst?: string) => (cst ? somenteDigitos(cst).padStart(2, "0") : "");

/** Confere o cadastro do emitente; lança ErroFiscal com TODOS os problemas encontrados. */
export function validarEmitente(e: EmitenteNfce): void {
  const problemas: string[] = [];
  if (!validarCnpj(e.cnpj)) problemas.push("CNPJ da empresa inválido.");
  const ie = somenteDigitos(e.inscricaoEstadual);
  if (ie.length < 2 || /^0+$/.test(ie)) {
    problemas.push("Inscrição estadual inválida: sem IE a empresa não pode emitir NFC-e.");
  }
  if (!e.razaoSocial?.trim()) problemas.push("Razão social não informada.");
  if (![1, 2, 3, 4].includes(e.crt)) {
    problemas.push("Regime tributário inválido: use CRT 1 (Simples), 2, 3 (normal) ou 4 (MEI).");
  }
  const end = e.endereco ?? {};
  if (!end.logradouro?.trim()) problemas.push("Endereço da empresa sem logradouro.");
  if (!end.bairro?.trim()) problemas.push("Endereço da empresa sem bairro.");
  if (!end.municipio?.trim()) problemas.push("Endereço da empresa sem município.");
  if (somenteDigitos(end.codigoMunicipio).length !== 7) {
    problemas.push("Código IBGE do município deve ter 7 dígitos (Porto Alegre = 4314902).");
  }
  if (!end.uf || !URLS_CONSULTA_NFCE[end.uf]?.[1].qrCode) {
    problemas.push(`UF ${end.uf ?? "(vazia)"} sem endereço de QR Code da NFC-e.`);
  }
  if (problemas.length > 0) {
    throw new ErroFiscal("NFCE_EMITENTE_INVALIDO", problemas.join(" "), { problemas });
  }
}

/** Confere a venda antes de montar; lança ErroFiscal com TODOS os problemas encontrados. */
export function validarVenda(venda: Venda, crt: 1 | 2 | 3 | 4 = 1): void {
  const problemas: string[] = [];
  const itens = venda.itens ?? [];
  if (itens.length === 0) problemas.push("A venda não tem itens.");
  if (itens.length > 990) problemas.push("Uma NFC-e aceita no máximo 990 itens.");

  itens.forEach((it, i) => {
    const nome = `Item ${i + 1}${it.descricao ? ` (${it.descricao})` : ""}`;
    if (!it.descricao?.trim()) problemas.push(`${nome}: sem descrição.`);
    if (somenteDigitos(it.ncm).length !== 8) problemas.push(`${nome}: NCM deve ter 8 dígitos.`);
    if (somenteDigitos(it.cfop).length !== 4) problemas.push(`${nome}: CFOP deve ter 4 dígitos.`);
    if (!(Number(it.quantidade) > 0))
      problemas.push(`${nome}: quantidade deve ser maior que zero.`);
    if (!(Number(it.valorUnitario) >= 0)) problemas.push(`${nome}: valor unitário inválido.`);
    if (it.tributacao) {
      for (const p of problemasTributacao(it.tributacao, crt)) problemas.push(`${nome}: ${p}`);
      const ic = it.tributacao.icms as { cst?: string; csosn?: string };
      if (["10", "30", "70", "201", "202", "203"].includes(ic.cst ?? ic.csosn ?? ""))
        problemas.push(
          `${nome}: NFC-e não calcula ST na nota; para produto com ST já cobrada use CST 60 ou CSOSN 500.`,
        );
      if (it.tributacao.difal) problemas.push(`${nome}: NFC-e não tem DIFAL (venda presencial).`);
      const icms = it.tributacao.icms;
      if (
        (("csosn" in icms && icms.csosn === "500") || ("cst" in icms && icms.cst === "60")) &&
        !it.cest
      ) {
        problemas.push(`${nome}: produto com ST precisa do CEST.`);
      }
    } else if (crt === 3) {
      problemas.push(
        `${nome}: no regime normal (CRT 3) informe a tributacao do item (CST de ICMS).`,
      );
    } else {
      const csosn = it.csosn ?? "102";
      if (!CSOSN_ACEITOS.includes(csosn)) {
        problemas.push(`${nome}: CSOSN ${csosn} não é aceito (use 102, 103, 300, 400 ou 500).`);
      }
      if (it.csosn === "500" && !it.cest) {
        problemas.push(`${nome}: produto com ST (CSOSN 500) precisa do CEST.`);
      }
      const cst = cstPisCofins(it.cstPisCofins);
      if (cst && ![...CST_PIS_NAO_TRIBUTADO, ...CST_PIS_OUTRAS].includes(cst)) {
        problemas.push(
          `${nome}: CST PIS/COFINS ${cst} não é usado pelo Simples (use 04 a 09, 49 ou 99).`,
        );
      }
    }
  });

  const pagamentos = venda.pagamentos ?? [];
  if (pagamentos.length === 0) problemas.push("Informe a forma de pagamento.");
  if (pagamentos.length > 100) problemas.push("No máximo 100 formas de pagamento por nota.");
  pagamentos.forEach((p, i) => {
    const eletronico = p.forma === "credito" || p.forma === "debito" || p.forma === "pix";
    if (!(Number(p.valor) > 0))
      problemas.push(`Pagamento ${i + 1}: valor deve ser maior que zero.`);
    if (p.forma === "sem-pagamento")
      problemas.push(`Pagamento ${i + 1}: NFC-e não aceita "sem-pagamento" (só NF-e).`);
    if (eletronico && p.integrado !== false && !validarCnpj(p.cnpjCredenciadora ?? "")) {
      problemas.push(
        `Pagamento ${i + 1} (${p.forma}): pagamento integrado precisa do CNPJ da credenciadora (ou informe integrado: false).`,
      );
    }
  });

  const doc = limparCnpj(venda.destinatario?.documento ?? "");
  if (doc && !(doc.length === 11 ? validarCpf(doc) : validarCnpj(doc))) {
    problemas.push("CPF/CNPJ do destinatário inválido.");
  }
  if (venda.entrega) {
    // Rejeições 787 e 788: entrega em domicílio exige identificar quem recebe e onde
    const end = venda.destinatario?.endereco ?? {};
    if (!doc)
      problemas.push(
        "Nota de entrega precisa do CPF (ou CNPJ) de quem recebe: é regra da SEFAZ para delivery.",
      );
    if (!venda.destinatario?.nome?.trim())
      problemas.push("Nota de entrega precisa do nome de quem recebe.");
    if (!end.logradouro || !end.numero || !end.bairro) {
      problemas.push("Nota de entrega precisa do endereço de entrega: rua, número e bairro.");
    }
  }

  if (problemas.length > 0) {
    throw new ErroFiscal("NFCE_VENDA_INVALIDA", problemas.join(" "), { problemas });
  }
}
