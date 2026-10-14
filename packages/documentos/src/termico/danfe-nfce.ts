import { XMLParser } from "fast-xml-parser";
import { chaveEmGrupos, dataHora, documento, moeda, quantidade } from "../formato";
import { type LinhaTermica, colunas, espaco, separador, texto } from "./modelo";

const FORMAS: Record<string, string> = {
  "01": "Dinheiro",
  "02": "Cheque",
  "03": "Cartão de Crédito",
  "04": "Cartão de Débito",
  "05": "Crédito Loja",
  "10": "Vale Alimentação",
  "11": "Vale Refeição",
  "12": "Vale Presente",
  "13": "Vale Combustível",
  "15": "Boleto",
  "16": "Depósito",
  "17": "PIX",
  "18": "Transferência",
  "19": "Fidelidade/Cashback",
  "90": "Sem pagamento",
  "99": "Outros",
};

export interface DadosDanfeNfce {
  ambiente: 1 | 2;
  /** Emitida em contingência offline (tpEmis 9) */
  contingencia: boolean;
  chave: string;
  numero: string;
  serie: string;
  dataEmissao: string;
  emitente: {
    razaoSocial: string;
    nomeFantasia: string;
    cnpj: string;
    ie: string;
    endereco: string;
  };
  itens: {
    numero: number;
    codigo: string;
    descricao: string;
    quantidade: number;
    unidade: string;
    valorUnitario: number;
    valorTotal: number;
  }[];
  totais: {
    produtos: number;
    desconto: number;
    acrescimos: number;
    aPagar: number;
    troco: number;
    /** Lei 12.741/2012 (vTotTrib); 0 quando a nota não informa */
    tributos: number;
  };
  pagamentos: { forma: string; valor: number }[];
  consumidor?: { documento: string; nome: string; endereco: string };
  protocolo?: { numero: string; data: string };
  qrCode: string;
  urlConsulta: string;
  informacoesComplementares: string;
}

const leitor = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  removeNSPrefix: true,
  parseTagValue: false,
  isArray: (nome) => nome === "det" || nome === "detPag",
});

type No = Record<string, unknown>;
const o = (v: unknown): No => (v && typeof v === "object" ? (v as No) : {});
const s = (v: unknown) => (v === undefined || v === null ? "" : String(v));
const n = (v: unknown) => Number(v ?? 0) || 0;

/**
 * Lê o XML da NFC-e (nfeProc autorizado, ou NFe ainda sem protocolo) e extrai o que o DANFE mostra.
 * O cupom sai do XML, não da venda: imprime exatamente o que a SEFAZ autorizou.
 */
export function lerDanfeNfce(xml: string): DadosDanfeNfce {
  const raiz = leitor.parse(xml) as No;
  const proc = o(raiz.nfeProc);
  const nfe = o(proc.NFe ?? raiz.NFe);
  const inf = o(nfe.infNFe);
  const ide = o(inf.ide);
  const emit = o(inf.emit);
  const end = o(emit.enderEmit);
  const dest = o(inf.dest);
  const endDest = o(dest.enderDest);
  const tot = o(o(inf.total).ICMSTot);
  const pag = o(inf.pag);
  const supl = o(nfe.infNFeSupl);
  const prot = o(o(proc.protNFe).infProt);

  const juntar = (...partes: unknown[]) => partes.map(s).filter(Boolean).join(", ");
  const docDest = s(dest.CPF ?? dest.CNPJ);

  return {
    ambiente: s(ide.tpAmb) === "1" ? 1 : 2,
    contingencia: s(ide.tpEmis) === "9",
    chave: s(inf["@Id"]).replace(/^NFe/, ""),
    numero: s(ide.nNF),
    serie: s(ide.serie),
    dataEmissao: s(ide.dhEmi),
    emitente: {
      razaoSocial: s(emit.xNome),
      nomeFantasia: s(emit.xFant),
      cnpj: s(emit.CNPJ ?? emit.CPF),
      ie: s(emit.IE),
      endereco: juntar(
        end.xLgr,
        end.nro,
        end.xCpl,
        end.xBairro,
        end.xMun && `${s(end.xMun)}/${s(end.UF)}`,
      ),
    },
    itens: ((inf.det as No[] | undefined) ?? []).map((det) => {
      const prod = o(det.prod);
      return {
        numero: n(det["@nItem"]),
        codigo: s(prod.cProd),
        descricao: s(prod.xProd),
        quantidade: n(prod.qCom),
        unidade: s(prod.uCom),
        valorUnitario: n(prod.vUnCom),
        valorTotal: n(prod.vProd),
      };
    }),
    totais: {
      produtos: n(tot.vProd),
      desconto: n(tot.vDesc),
      acrescimos: n(tot.vOutro) + n(tot.vFrete) + n(tot.vSeg),
      aPagar: n(tot.vNF),
      troco: n(pag.vTroco),
      tributos: n(tot.vTotTrib),
    },
    pagamentos: ((pag.detPag as No[] | undefined) ?? []).map((p) => ({
      forma: s(p.xPag) || FORMAS[s(p.tPag)] || "Outros",
      valor: n(p.vPag),
    })),
    ...(docDest
      ? {
          consumidor: {
            documento: docDest,
            nome: s(dest.xNome),
            endereco: juntar(
              endDest.xLgr,
              endDest.nro,
              endDest.xCpl,
              endDest.xBairro,
              endDest.xMun,
            ),
          },
        }
      : {}),
    ...(prot.nProt ? { protocolo: { numero: s(prot.nProt), data: s(prot.dhRecbto) } } : {}),
    qrCode: s(supl.qrCode),
    urlConsulta: s(supl.urlChave),
    informacoesComplementares: s(o(inf.infAdic).infCpl),
  };
}

/**
 * DANFE NFC-e (Manual de Especificações Técnicas do DANFE NFC-e e QR Code) como linhas de cupom.
 * `cancelada`: imprime a faixa NOTA CANCELADA (o XML da nota não diz isso; vem do seu cadastro).
 * `via`: em contingência offline, imprima também a via do estabelecimento e guarde-a até a nota
 * ser autorizada.
 */
export function montarDanfeNfce(
  entrada: string | DadosDanfeNfce,
  opcoes: { cancelada?: boolean; via?: "consumidor" | "estabelecimento" } = {},
): LinhaTermica[] {
  const d = typeof entrada === "string" ? lerDanfeNfce(entrada) : entrada;
  const homologacao = d.ambiente !== 1;
  const avisoHomologacao = texto("EMITIDA EM AMBIENTE DE HOMOLOGAÇÃO - SEM VALOR FISCAL", {
    alinhar: "centro",
    negrito: true,
  });
  const linhas: LinhaTermica[] = [];
  const add = (...l: LinhaTermica[]) => linhas.push(...l);

  // Divisão I: emitente
  add(texto(d.emitente.razaoSocial, { alinhar: "centro", negrito: true }));
  if (d.emitente.nomeFantasia && d.emitente.nomeFantasia !== d.emitente.razaoSocial) {
    add(texto(d.emitente.nomeFantasia, { alinhar: "centro" }));
  }
  add(
    texto(`CNPJ ${documento(d.emitente.cnpj)}${d.emitente.ie ? `  IE ${d.emitente.ie}` : ""}`, {
      alinhar: "centro",
    }),
    texto(d.emitente.endereco, { alinhar: "centro" }),
    separador,
    texto("DANFE NFC-e - Documento Auxiliar da Nota Fiscal de Consumidor Eletrônica", {
      alinhar: "centro",
      negrito: true,
    }),
  );
  if (homologacao) add(avisoHomologacao);
  add(separador);

  // Divisão II: itens
  add(colunas("# CÓD DESCRIÇÃO", "VL TOTAL", { negrito: true }));
  for (const it of d.itens) {
    const codigo = it.codigo && it.codigo !== String(it.numero) ? `${it.codigo} ` : "";
    add(
      texto(`${String(it.numero).padStart(3, "0")} ${codigo}${it.descricao}`),
      colunas(
        `${quantidade(it.quantidade)} ${it.unidade} x ${moeda(it.valorUnitario)}`,
        moeda(it.valorTotal),
      ),
    );
  }
  add(separador);

  // Divisão III: totais e pagamento
  add(
    colunas("Qtd. total de itens", String(d.itens.length)),
    colunas("Valor total R$", moeda(d.totais.produtos)),
  );
  if (d.totais.desconto > 0) add(colunas("Desconto R$", moeda(d.totais.desconto)));
  if (d.totais.acrescimos > 0) add(colunas("Acréscimos R$", moeda(d.totais.acrescimos)));
  add(colunas("Valor a pagar R$", moeda(d.totais.aPagar), { negrito: true, grande: true }), espaco);
  add(colunas("FORMA DE PAGAMENTO", "VALOR PAGO R$", { negrito: true }));
  for (const p of d.pagamentos) add(colunas(p.forma, moeda(p.valor)));
  if (d.totais.troco > 0) add(colunas("Troco R$", moeda(d.totais.troco)));
  // Lei 12.741/2012: valor aproximado dos tributos
  if (d.totais.tributos > 0) {
    add(
      colunas("Tributos totais incidentes (Lei Federal 12.741/2012) R$", moeda(d.totais.tributos)),
    );
  }
  add(separador);

  // Divisão IV: consulta pela chave
  add(
    texto("Consulte pela Chave de Acesso em", { alinhar: "centro", negrito: true }),
    texto(d.urlConsulta, { alinhar: "centro" }),
    texto(chaveEmGrupos(d.chave), { alinhar: "centro" }),
    separador,
  );

  // Divisão V: consumidor
  if (d.consumidor) {
    add(
      texto(
        `CONSUMIDOR - ${d.consumidor.documento.length === 14 ? "CNPJ" : "CPF"} ${documento(d.consumidor.documento)}`,
        { alinhar: "centro", negrito: true },
      ),
    );
    if (d.consumidor.nome && !homologacao) add(texto(d.consumidor.nome, { alinhar: "centro" }));
    if (d.consumidor.endereco) add(texto(d.consumidor.endereco, { alinhar: "centro" }));
  } else {
    add(texto("CONSUMIDOR NÃO IDENTIFICADO", { alinhar: "centro", negrito: true }));
  }
  add(separador);

  // Divisão VI: identificação e protocolo
  add(
    texto(
      `NFC-e nº ${d.numero.padStart(9, "0")}  Série ${d.serie.padStart(3, "0")}  ${dataHora(d.dataEmissao)}`,
      {
        alinhar: "centro",
        negrito: true,
      },
    ),
  );
  if (d.protocolo) {
    add(
      texto(`Protocolo de autorização: ${d.protocolo.numero}`, { alinhar: "centro" }),
      texto(`Data de autorização: ${dataHora(d.protocolo.data)}`, { alinhar: "centro" }),
    );
  } else if (d.contingencia) {
    add(
      texto("EMITIDA EM CONTINGÊNCIA", { alinhar: "centro", negrito: true }),
      texto("Pendente de autorização", { alinhar: "centro" }),
    );
  } else {
    add(texto("NOTA AINDA NÃO AUTORIZADA PELA SEFAZ", { alinhar: "centro", negrito: true }));
  }
  if (opcoes.via) {
    add(
      texto(opcoes.via === "estabelecimento" ? "VIA DO ESTABELECIMENTO" : "VIA DO CONSUMIDOR", {
        alinhar: "centro",
        negrito: true,
      }),
    );
  }
  if (opcoes.cancelada) add(espaco, { tipo: "faixa", texto: "NOTA CANCELADA" });
  if (homologacao) add(espaco, avisoHomologacao);

  // Divisão VII: QR Code
  if (d.qrCode) add(espaco, { tipo: "qrcode", conteudo: d.qrCode }, espaco);
  // Divisão VIII: mensagem de interesse do contribuinte
  if (d.informacoesComplementares) add(texto(d.informacoesComplementares, { alinhar: "centro" }));
  return linhas;
}
