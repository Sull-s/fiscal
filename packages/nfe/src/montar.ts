import {
  ErroFiscal,
  anoMesDaEmissao,
  codigoUf,
  formatarDataHoraSefaz,
  gerarCodigoNumerico,
  montarChaveAcesso,
} from "@fiscal/core";
import {
  NS_NFE,
  calcularImpostos,
  centavos,
  formatarValorUnitario,
  montarDetPag,
  reais,
  repartir,
  somarTotais,
  textoCreditoSimples,
  textoTributosAproximados,
  totaisIcms,
  totaisZerados,
  totalDoItemEmCentavos,
  totalIbsCbs,
} from "@fiscal/nfe-comum";
import { CONTINGENCIA_DA_UF } from "@fiscal/transporte";
import {
  escaparTexto,
  formatarDecimal,
  grupo,
  limparTexto,
  somenteDigitos,
  tag,
  texto,
} from "@fiscal/xml";
import type { DadosNfe, EmitenteNfe, EnderecoNfe, NfeMontada, OperacaoNfe } from "./tipos";
import { destinoDaOperacao, validarNfe } from "./validacao";

/** Nome que a SEFAZ exige no destinatário em homologação. */
export const TEXTO_HOMOLOGACAO_DESTINATARIO =
  "NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL";

const dec = (c: number) => formatarDecimal(reais(c), 2);
const soma = (v: number[]) => v.reduce((s, x) => s + x, 0);

function endereco(grupoNome: "enderEmit" | "enderDest", e: EnderecoNfe): string {
  const exterior = e.uf === "EX";
  const cep = somenteDigitos(e.cep);
  const fone = somenteDigitos(e.telefone);
  return (
    `<${grupoNome}>` +
    texto("xLgr", e.logradouro, 60) +
    texto("nro", e.numero || "S/N", 60) +
    texto("xCpl", e.complemento, 60) +
    texto("xBairro", e.bairro, 60) +
    tag("cMun", exterior ? "9999999" : somenteDigitos(e.codigoMunicipio)) +
    texto("xMun", exterior ? "EXTERIOR" : e.municipio, 60) +
    tag("UF", e.uf) +
    tag("CEP", cep.length === 8 ? cep : "") +
    tag("cPais", e.codigoPais ?? "1058") +
    texto("xPais", e.pais ?? "BRASIL", 60) +
    tag("fone", fone.length >= 6 ? fone.slice(0, 14) : "") +
    `</${grupoNome}>`
  );
}

/**
 * Monta a NF-e (modelo 55, leiaute 4.00) pronta para assinar
 * (`assinarXml(xml, { elemento: "infNFe", perfil: "sefaz", certificado })`).
 * Calcula impostos e totais item a item; lança ErroFiscal com todos os problemas de uma vez.
 */
export function montarNfe(entrada: {
  emitente: EmitenteNfe;
  operacao: OperacaoNfe;
  nota: DadosNfe;
}): NfeMontada {
  const { emitente, operacao, nota } = entrada;
  validarNfe(emitente, operacao, nota);

  const uf = emitente.endereco.uf;
  const tpAmb = nota.ambiente;
  const homologacao = tpAmb === 2;
  const dhEmi = formatarDataHoraSefaz(nota.dataEmissao ?? new Date(), nota.fuso);
  const cnpj = somenteDigitos(emitente.cnpj);
  const cNF = nota.codigoNumerico ?? gerarCodigoNumerico(nota.numero);
  const cont = nota.contingencia;
  const svc = cont ? (cont.svc ?? CONTINGENCIA_DA_UF[uf]) : undefined;
  const tpEmis = svc === "SVC-AN" ? 6 : svc === "SVC-RS" ? 7 : 1;
  const xJust = cont ? limparTexto(cont.justificativa, 256) : "";
  if (cont) {
    const problemas: string[] = [];
    if (xJust.length < 15)
      problemas.push("Justificativa da contingência precisa de 15 a 256 caracteres.");
    if (
      Number.isNaN(cont.inicio.getTime()) ||
      cont.inicio.getTime() > (nota.dataEmissao ?? new Date()).getTime() + 1000
    )
      problemas.push("Início da contingência inválido ou depois da emissão.");
    if (problemas.length)
      throw new ErroFiscal("NFE_CONTINGENCIA_INVALIDA", problemas.join(" "), { problemas });
  }
  const chave = montarChaveAcesso({
    uf,
    anoMes: anoMesDaEmissao(dhEmi),
    documentoEmitente: cnpj,
    modelo: "55",
    serie: nota.serie,
    numero: nota.numero,
    tipoEmissao: tpEmis,
    codigoNumerico: cNF,
  });

  const d = operacao.destinatario;
  const idDest = destinoDaOperacao(emitente, operacao);
  const finalidade = nota.finalidade ?? 1;
  const consumidorFinal = nota.consumidorFinal ?? d.indicadorIe === 9;
  const presenca = nota.presenca ?? (finalidade === 1 ? 9 : 0);

  // Valores em centavos; totais da operação repartidos entre os itens
  const brutos = operacao.itens.map((it) => totalDoItemEmCentavos(it.quantidade, it.valorUnitario));
  const reparte = (total: number | undefined, doItem: (i: number) => number | undefined) => {
    const partes = repartir(centavos(total ?? 0), brutos);
    return partes.map((v, i) => v + centavos(doItem(i) ?? 0));
  };
  const descontos = reparte(operacao.desconto, (i) => operacao.itens[i]?.desconto);
  const fretes = reparte(operacao.frete, (i) => operacao.itens[i]?.frete);
  const seguros = reparte(operacao.seguro, (i) => operacao.itens[i]?.seguro);
  const outras = reparte(operacao.outrasDespesas, (i) => operacao.itens[i]?.outras);
  brutos.forEach((b, i) => {
    if ((descontos[i] ?? 0) > b) {
      throw new ErroFiscal("NFE_DESCONTO_MAIOR_QUE_ITEM", `Desconto maior que o item ${i + 1}.`);
    }
  });

  const tot = totaisZerados();
  let pCredSN: number | undefined;
  let temDifal = false;
  let temIbsCbs = false;
  const det = operacao.itens
    .map((it, i) => {
      const imp = calcularImpostos(
        it.tributacao,
        {
          produto: brutos[i] ?? 0,
          desconto: descontos[i] ?? 0,
          frete: fretes[i] ?? 0,
          seguro: seguros[i] ?? 0,
          outras: outras[i] ?? 0,
        },
        {
          consumidorFinal,
          ...(nota.icmsNaBasePisCofins ? { icmsNaBasePisCofins: true } : {}),
        },
      );
      somarTotais(tot, imp);
      pCredSN ??= imp.pCredSN;
      temDifal ||= imp.temDifal;
      temIbsCbs ||= imp.temIbsCbs;
      const unidade = it.unidade || "UN";
      const qtd = formatarDecimal(it.quantidade, 4);
      const vUn = formatarValorUnitario(it.valorUnitario);
      const gtin = somenteDigitos(it.gtin) || "SEM GTIN";
      const opcional = (nomeTag: string, c: number | undefined) => (c ? tag(nomeTag, dec(c)) : "");
      const prod =
        "<prod>" +
        texto("cProd", it.codigo, 60) +
        tag("cEAN", gtin) +
        texto("xProd", it.descricao, 120) +
        tag("NCM", somenteDigitos(it.ncm)) +
        tag("CEST", somenteDigitos(it.cest)) +
        tag("CFOP", somenteDigitos(it.cfop)) +
        texto("uCom", unidade, 6) +
        tag("qCom", qtd) +
        tag("vUnCom", vUn) +
        tag("vProd", dec(brutos[i] ?? 0)) +
        tag("cEANTrib", gtin) +
        texto("uTrib", unidade, 6) +
        tag("qTrib", qtd) +
        tag("vUnTrib", vUn) +
        opcional("vFrete", fretes[i]) +
        opcional("vSeg", seguros[i]) +
        opcional("vDesc", descontos[i]) +
        opcional("vOutro", outras[i]) +
        tag("indTot", "1") +
        texto("xPed", it.pedido?.numero, 15) +
        tag("nItemPed", it.pedido?.item) +
        "</prod>";
      return `<det nItem="${i + 1}">${prod}<imposto>${imp.xml}</imposto>${texto("infAdProd", it.observacao, 500)}</det>`;
    })
    .join("");

  const vProd = soma(brutos);
  const vDesc = soma(descontos);
  const vFrete = soma(fretes);
  const vSeg = soma(seguros);
  const vOutro = soma(outras);
  // ICMS e PIS/COFINS estão "por dentro" do preço; o IPI é somado por fora
  // A ST e o FCP-ST cobrados nesta nota também são somados (IBS/CBS de 2026 não)
  const vNF = vProd - vDesc + vFrete + vSeg + vOutro + tot.vIPI + tot.vST + tot.vFCPST;

  const ide =
    "<ide>" +
    tag("cUF", codigoUf(uf)) +
    tag("cNF", cNF) +
    texto("natOp", nota.naturezaOperacao, 60) +
    tag("mod", "55") +
    tag("serie", nota.serie) +
    tag("nNF", nota.numero) +
    tag("dhEmi", dhEmi) +
    (nota.dataSaida ? tag("dhSaiEnt", formatarDataHoraSefaz(nota.dataSaida, nota.fuso)) : "") +
    tag("tpNF", (nota.tipo ?? "saida") === "saida" ? "1" : "0") +
    tag("idDest", idDest) +
    tag("cMunFG", somenteDigitos(emitente.endereco.codigoMunicipio)) +
    tag("tpImp", "1") +
    tag("tpEmis", tpEmis) +
    tag("cDV", chave.slice(-1)) +
    tag("tpAmb", tpAmb) +
    tag("finNFe", finalidade) +
    tag("indFinal", consumidorFinal ? "1" : "0") +
    tag("indPres", presenca) +
    // Sem intermediador (marketplace): obrigatório informar quando a venda não é presencial
    ([2, 3, 4, 9].includes(presenca) ? tag("indIntermed", "0") : "") +
    tag("procEmi", "0") +
    texto("verProc", nota.versaoAplicativo ?? "@fiscal/nfe", 20) +
    (cont
      ? tag("dhCont", formatarDataHoraSefaz(cont.inicio, nota.fuso)) + texto("xJust", xJust)
      : "") +
    (nota.referencias ?? []).map((ch) => `<NFref>${tag("refNFe", ch)}</NFref>`).join("") +
    "</ide>";

  const end = emitente.endereco;
  const emit =
    "<emit>" +
    tag("CNPJ", cnpj) +
    texto("xNome", emitente.razaoSocial, 60) +
    texto("xFant", emitente.nomeFantasia, 60) +
    endereco("enderEmit", end) +
    tag("IE", somenteDigitos(emitente.inscricaoEstadual)) +
    tag("IM", emitente.inscricaoMunicipal) +
    tag("CNAE", emitente.inscricaoMunicipal ? somenteDigitos(emitente.cnae) : "") +
    tag("CRT", emitente.crt) +
    "</emit>";

  const docDest = somenteDigitos(d.documento);
  const dest =
    "<dest>" +
    (d.endereco.uf === "EX"
      ? `<idEstrangeiro>${escaparTexto(limparTexto(d.idEstrangeiro, 20))}</idEstrangeiro>`
      : tag(docDest.length === 14 ? "CNPJ" : "CPF", docDest)) +
    texto("xNome", homologacao ? TEXTO_HOMOLOGACAO_DESTINATARIO : d.nome, 60) +
    endereco("enderDest", d.endereco) +
    tag("indIEDest", d.indicadorIe) +
    (d.indicadorIe === 1 ? tag("IE", somenteDigitos(d.inscricaoEstadual)) : "") +
    texto("email", d.email, 60) +
    "</dest>";

  const zeros = (...nomes: string[]) => nomes.map((n) => tag(n, "0.00")).join("");
  const total =
    "<total><ICMSTot>" +
    totaisIcms(tot, { difal: temDifal }) +
    tag("vProd", dec(vProd)) +
    tag("vFrete", dec(vFrete)) +
    tag("vSeg", dec(vSeg)) +
    tag("vDesc", dec(vDesc)) +
    zeros("vII") +
    tag("vIPI", dec(tot.vIPI)) +
    zeros("vIPIDevol") +
    tag("vPIS", dec(tot.vPIS)) +
    tag("vCOFINS", dec(tot.vCOFINS)) +
    tag("vOutro", dec(vOutro)) +
    tag("vNF", dec(vNF)) +
    (tot.vTotTrib > 0 ? tag("vTotTrib", dec(tot.vTotTrib)) : "") +
    "</ICMSTot>" +
    (temIbsCbs ? totalIbsCbs(tot) : "") +
    "</total>";

  const t = operacao.transporte ?? {};
  const tr = t.transportadora;
  const docTr = somenteDigitos(tr?.documento);
  const transp =
    "<transp>" +
    tag("modFrete", t.modalidade ?? 9) +
    (tr
      ? grupo(
          "transporta",
          docTr && tag(docTr.length === 14 ? "CNPJ" : "CPF", docTr),
          texto("xNome", tr.nome, 60),
          tag("IE", somenteDigitos(tr.inscricaoEstadual)),
          texto("xEnder", tr.endereco, 60),
          texto("xMun", tr.municipio, 60),
          tag("UF", tr.uf),
        )
      : "") +
    (t.volumes ?? [])
      .map((v) =>
        grupo(
          "vol",
          tag("qVol", v.quantidade),
          texto("esp", v.especie, 60),
          texto("marca", v.marca, 60),
          texto("nVol", v.numeracao, 60),
          v.pesoLiquido !== undefined && tag("pesoL", formatarDecimal(v.pesoLiquido, 3)),
          v.pesoBruto !== undefined && tag("pesoB", formatarDecimal(v.pesoBruto, 3)),
        ),
      )
      .join("") +
    "</transp>";

  const cob = operacao.cobranca;
  const cobr = cob
    ? grupo(
        "cobr",
        cob.fatura &&
          grupo(
            "fat",
            texto("nFat", cob.fatura.numero, 60),
            tag("vOrig", dec(centavos(cob.fatura.valorOriginal))),
            tag("vDesc", dec(centavos(cob.fatura.desconto ?? 0))),
            tag("vLiq", dec(centavos(cob.fatura.valorLiquido))),
          ),
        ...(cob.duplicatas ?? []).map(
          (dup) =>
            `<dup>${texto("nDup", dup.numero, 60)}${tag("dVenc", dup.vencimento)}${tag("vDup", dec(centavos(dup.valor)))}</dup>`,
        ),
      )
    : "";

  // Troco só existe em dinheiro; "sem-pagamento" vai com 0
  const pago = soma(operacao.pagamentos.map((x) => centavos(x.valor)));
  const semPagamento = operacao.pagamentos.some((x) => x.forma === "sem-pagamento");
  if (!semPagamento && pago < vNF) {
    throw new ErroFiscal(
      "NFE_PAGAMENTO_INSUFICIENTE",
      `Pagamentos (R$ ${dec(pago)}) menores que o total da nota (R$ ${dec(vNF)}).`,
      { pago: reais(pago), total: reais(vNF) },
    );
  }
  const troco = semPagamento ? 0 : pago - vNF;
  const pag = `<pag>${operacao.pagamentos.map(montarDetPag).join("")}${troco > 0 ? tag("vTroco", dec(troco)) : ""}</pag>`;

  const complementares = [
    operacao.informacoesComplementares,
    tot.vCredICMSSN > 0 && pCredSN !== undefined
      ? textoCreditoSimples(tot.vCredICMSSN, pCredSN)
      : "",
    tot.vTotTrib > 0 ? textoTributosAproximados(tot) : "",
  ]
    .filter(Boolean)
    .join(" | ");
  const infAdic = grupo(
    "infAdic",
    texto("infAdFisco", operacao.informacoesFisco, 2000),
    texto("infCpl", complementares, 5000),
  );
  const rt = emitente.responsavelTecnico;
  const infRespTec = rt
    ? "<infRespTec>" +
      tag("CNPJ", somenteDigitos(rt.cnpj)) +
      texto("xContato", rt.contato, 60) +
      texto("email", rt.email, 60) +
      tag("fone", somenteDigitos(rt.telefone)) +
      "</infRespTec>"
    : "";

  const corpo = ide + emit + dest + det + total + transp + cobr + pag + infAdic + infRespTec;
  return {
    xml: `<NFe xmlns="${NS_NFE}"><infNFe Id="NFe${chave}" versao="4.00">${corpo}</infNFe></NFe>`,
    chave,
    numero: nota.numero,
    serie: nota.serie,
    dataEmissao: dhEmi,
    ambiente: tpAmb,
    valorTotal: reais(vNF),
    ...(svc ? { contingencia: svc } : {}),
    impostos: {
      icms: reais(tot.vICMS),
      fcp: reais(tot.vFCP),
      st: reais(tot.vST + tot.vFCPST),
      difal: reais(tot.vICMSUFDest + tot.vFCPUFDest),
      ibsCbs: reais(tot.vIBSUF + tot.vIBSMun + tot.vCBS),
      tributosAproximados: reais(tot.vTotTrib),
      ipi: reais(tot.vIPI),
      pis: reais(tot.vPIS),
      cofins: reais(tot.vCOFINS),
    },
  };
}
