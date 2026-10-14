import type { Uf } from "@fiscal/core";
import type { Pagamento, TributacaoItem } from "@fiscal/nfe-comum";

export type { Pagamento, TributacaoItem } from "@fiscal/nfe-comum";

export interface EnderecoNfe {
  logradouro: string;
  /** Vazio vira "S/N" */
  numero?: string;
  complemento?: string;
  bairro: string;
  /** Código IBGE do município (7 dígitos). Exterior: 9999999 */
  codigoMunicipio: string;
  municipio: string;
  /** "EX" para exterior */
  uf: Uf | "EX";
  cep?: string;
  telefone?: string;
  /** Código do país (BACEN). Padrão 1058 (Brasil) */
  codigoPais?: string;
  /** Padrão BRASIL */
  pais?: string;
}

export interface EmitenteNfe {
  cnpj: string;
  inscricaoEstadual: string;
  razaoSocial: string;
  nomeFantasia?: string;
  /** 1 Simples · 2 Simples com excesso de sublimite · 3 regime normal · 4 MEI */
  crt: 1 | 2 | 3 | 4;
  endereco: EnderecoNfe & { uf: Uf };
  /** Inscrição municipal (vai junto com o CNAE) */
  inscricaoMunicipal?: string;
  cnae?: string;
  responsavelTecnico?: {
    cnpj: string;
    contato: string;
    email: string;
    telefone: string;
  };
}

export interface DestinatarioNfe {
  /** CPF ou CNPJ (vazio só para estrangeiro) */
  documento?: string;
  /** Documento do estrangeiro (passaporte etc.) */
  idEstrangeiro?: string;
  nome: string;
  /** 1 contribuinte de ICMS (tem IE) · 2 isento · 9 não contribuinte (pessoa física, por exemplo) */
  indicadorIe: 1 | 2 | 9;
  inscricaoEstadual?: string;
  email?: string;
  endereco: EnderecoNfe;
}

export interface ItemNfe {
  /** Código interno do produto */
  codigo: string;
  descricao: string;
  /** 8 dígitos */
  ncm: string;
  cest?: string;
  /** 4 dígitos, coerente com a operação (5xxx/6xxx/7xxx saída; 1xxx/2xxx/3xxx entrada) */
  cfop: string;
  /** Código de barras (GTIN/EAN). Vazio: "SEM GTIN" */
  gtin?: string;
  /** Padrão "UN" */
  unidade?: string;
  quantidade: number;
  valorUnitario: number;
  /** Valores do próprio item (somam com os do total, que são repartidos) */
  desconto?: number;
  frete?: number;
  seguro?: number;
  outras?: number;
  tributacao: TributacaoItem;
  /** Pedido de compra do cliente (xPed / nItemPed) */
  pedido?: { numero: string; item?: number };
  /** Texto livre do item (infAdProd) */
  observacao?: string;
}

export interface TransporteNfe {
  /**
   * Quem paga o frete: 0 remetente (CIF) · 1 destinatário (FOB) · 2 terceiros ·
   * 3 próprio remetente · 4 próprio destinatário · 9 sem frete. Padrão 9.
   */
  modalidade?: 0 | 1 | 2 | 3 | 4 | 9;
  transportadora?: {
    documento?: string;
    nome?: string;
    inscricaoEstadual?: string;
    endereco?: string;
    municipio?: string;
    uf?: Uf;
  };
  volumes?: {
    quantidade?: number;
    especie?: string;
    marca?: string;
    numeracao?: string;
    /** kg */
    pesoLiquido?: number;
    pesoBruto?: number;
  }[];
}

export interface CobrancaNfe {
  fatura?: { numero: string; valorOriginal: number; desconto?: number; valorLiquido: number };
  /** Parcelas: número (ex.: "001"), vencimento AAAA-MM-DD e valor */
  duplicatas?: { numero: string; vencimento: string; valor: number }[];
}

export interface OperacaoNfe {
  destinatario: DestinatarioNfe;
  itens: ItemNfe[];
  pagamentos: Pagamento[];
  /** Totais repartidos entre os itens, proporcionalmente ao valor de cada um */
  desconto?: number;
  frete?: number;
  seguro?: number;
  outrasDespesas?: number;
  transporte?: TransporteNfe;
  cobranca?: CobrancaNfe;
  informacoesComplementares?: string;
  /** Informações de interesse do fisco (infAdFisco) */
  informacoesFisco?: string;
}

export interface DadosNfe {
  /** 1 produção, 2 homologação */
  ambiente: 1 | 2;
  serie: number;
  numero: number;
  /** Ex.: "Venda de mercadoria", "Devolucao de compra" */
  naturezaOperacao: string;
  /** Padrão "saida" */
  tipo?: "saida" | "entrada";
  /** 1 normal · 2 complementar · 3 ajuste · 4 devolução. Padrão 1 */
  finalidade?: 1 | 2 | 3 | 4;
  /** Padrão: true quando o destinatário não é contribuinte (indicadorIe 9) */
  consumidorFinal?: boolean;
  /**
   * Presença do comprador: 0 não se aplica · 1 presencial · 2 internet · 3 telefone ·
   * 4 entrega em domicílio · 5 presencial fora do estabelecimento · 9 outros. Padrão 9 (0 em
   * devolução, ajuste ou complementar).
   */
  presenca?: 0 | 1 | 2 | 3 | 4 | 5 | 9;
  /** Chaves das NF-e referenciadas (obrigatório em devolução e complementar) */
  referencias?: string[];
  /** Padrão: agora */
  dataEmissao?: Date;
  dataSaida?: Date;
  /** Padrão America/Sao_Paulo */
  fuso?: string;
  /** 8 dígitos; padrão: sorteado */
  codigoNumerico?: string;
  versaoAplicativo?: string;
  /** PIS/COFINS com o ICMS na base (padrão: sem, Lei 14.592/2023) */
  icmsNaBasePisCofins?: boolean;
  /**
   * Emissão em contingência SVC (SEFAZ do estado fora do ar): tpEmis 6 (SVC-AN) ou 7 (SVC-RS).
   * A nota é autorizada pela SEFAZ virtual e vale normalmente; não precisa transmitir de novo.
   */
  contingencia?: ContingenciaSvc;
}

export interface ContingenciaSvc {
  /** Padrão: a SVC da UF do emitente (RS usa SVC-AN; SP, PR, BA… usam SVC-RS) */
  svc?: "SVC-AN" | "SVC-RS";
  /** Quando entrou em contingência (dhCont); não pode ser depois da emissão */
  inicio: Date;
  /** Motivo, 15 a 256 caracteres */
  justificativa: string;
}

export interface NfeMontada {
  /** <NFe> completo, ainda sem a <Signature> */
  xml: string;
  chave: string;
  numero: number;
  serie: number;
  dataEmissao: string;
  ambiente: 1 | 2;
  valorTotal: number;
  /** SVC usada, quando emitida em contingência */
  contingencia?: "SVC-AN" | "SVC-RS";
  /** Totais dos impostos destacados, em reais */
  impostos: {
    icms: number;
    fcp: number;
    /** ICMS-ST + FCP-ST cobrados nesta nota (somados ao total) */
    st: number;
    /** DIFAL + FCP do destino */
    difal: number;
    ipi: number;
    pis: number;
    cofins: number;
    /** IBS + CBS (informativo em 2026) */
    ibsCbs: number;
    tributosAproximados: number;
  };
}
