import { formatarDecimal, grupo, somenteDigitos, tag, texto } from "@fiscal/xml";
import { centavos, reais } from "./valores";

export type FormaPagamento =
  | "dinheiro"
  | "cheque"
  | "credito"
  | "debito"
  | "credito-loja"
  | "vale-alimentacao"
  | "vale-refeicao"
  | "boleto"
  | "deposito"
  | "pix"
  | "transferencia"
  /** NF-e sem pagamento (devolução, remessa, bonificação): vPag 0 */
  | "sem-pagamento"
  | "outros";

export interface Pagamento {
  forma: FormaPagamento;
  valor: number;
  /**
   * Cartão/Pix integrado ao sistema (maquininha conectada): exige o CNPJ da credenciadora.
   * Padrão: true para crédito, débito e Pix.
   */
  integrado?: boolean;
  /** CNPJ da credenciadora/instituição de pagamento (ex.: Mercado Pago 10573521000191) */
  cnpjCredenciadora?: string;
  /** Nome da bandeira: visa, mastercard, elo, amex, hipercard… */
  bandeira?: string;
  /** Código de autorização da transação */
  autorizacao?: string;
  /** Descrição quando a forma é "outros" */
  descricao?: string;
  /** Pagamento a prazo (boleto, duplicata). Padrão: à vista */
  aPrazo?: boolean;
}

export const CODIGO_FORMA: Record<FormaPagamento, string> = {
  dinheiro: "01",
  cheque: "02",
  credito: "03",
  debito: "04",
  "credito-loja": "05",
  "vale-alimentacao": "10",
  "vale-refeicao": "11",
  boleto: "15",
  deposito: "16",
  pix: "17",
  transferencia: "18",
  "sem-pagamento": "90",
  outros: "99",
};

const CODIGO_BANDEIRA: Record<string, string> = {
  visa: "01",
  mastercard: "02",
  master: "02",
  amex: "03",
  "american express": "03",
  sorocred: "04",
  diners: "05",
  elo: "06",
  hipercard: "07",
  aura: "08",
  cabal: "09",
  alelo: "10",
};

/** <detPag> de um pagamento (NF-e e NFC-e). */
export function montarDetPag(p: Pagamento): string {
  const tPag = CODIGO_FORMA[p.forma] ?? "99";
  const eletronico = tPag === "03" || tPag === "04" || tPag === "17";
  const integrado = eletronico && p.integrado !== false;
  const card = eletronico
    ? grupo(
        "card",
        tag("tpIntegra", integrado ? "1" : "2"),
        integrado && tag("CNPJ", somenteDigitos(p.cnpjCredenciadora)),
        integrado &&
          tPag !== "17" &&
          tag("tBand", CODIGO_BANDEIRA[String(p.bandeira ?? "").toLowerCase()] ?? "99"),
        integrado && texto("cAut", p.autorizacao, 128),
      )
    : "";
  return grupo(
    "detPag",
    tag("indPag", p.aPrazo ? "1" : "0"),
    tag("tPag", tPag),
    tPag === "99" && texto("xPag", p.descricao || "Outros", 60),
    tag("vPag", formatarDecimal(reais(centavos(p.valor)), 2)),
    card,
  );
}
