import type { Uf } from "@fiscal/core";

export interface Endereco {
  logradouro: string;
  /** Vazio vira "S/N" */
  numero?: string;
  complemento?: string;
  bairro: string;
  /** Código IBGE do município (7 dígitos). Porto Alegre = 4314902 */
  codigoMunicipio: string;
  municipio: string;
  uf: Uf;
  cep?: string;
  telefone?: string;
}

export interface EmitenteNfce {
  cnpj: string;
  /** Inscrição estadual: sem ela a SEFAZ recusa NFC-e */
  inscricaoEstadual: string;
  razaoSocial: string;
  nomeFantasia?: string;
  /**
   * Regime tributário: 1 Simples Nacional · 2 Simples com excesso de sublimite · 4 MEI.
   * (3, regime normal, ainda não é suportado por este pacote.)
   */
  crt: 1 | 2 | 4;
  endereco: Endereco;
  responsavelTecnico?: {
    cnpj: string;
    contato: string;
    email: string;
    telefone: string;
  };
}

/** CSOSN do Simples aceitos nesta versão: 102/103/300/400 (sem ST) e 500 (ST cobrada antes). */
export type Csosn = "102" | "103" | "300" | "400" | "500";

export interface ItemVenda {
  /** Código interno do produto (padrão: número do item) */
  codigo?: string;
  descricao: string;
  /** 8 dígitos */
  ncm: string;
  cest?: string;
  /** 4 dígitos, ex.: 5102 (venda), 5405 (venda com ST) */
  cfop: string;
  /** Padrão "102" */
  csosn?: Csosn;
  /** Origem da mercadoria (0 nacional … 8). Padrão 0 */
  origem?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  /**
   * CST de PIS/COFINS. No Simples: 04 a 09 (não tributado, ex.: 04 monofásico) ou 49/99 (outras).
   * Vazio: o grupo não vai na nota (é opcional na NFC-e).
   */
  cstPisCofins?: string;
  /** Padrão "UN" */
  unidade?: string;
  quantidade: number;
  valorUnitario: number;
  /** Texto livre do item (infAdProd) */
  observacao?: string;
}

export type FormaPagamento = "dinheiro" | "credito" | "debito" | "pix" | "outros";

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
}

export interface Destinatario {
  /** CPF ou CNPJ */
  documento?: string;
  nome?: string;
  /** Obrigatório na entrega em domicílio */
  endereco?: Partial<Endereco>;
}

export interface Venda {
  itens: ItemVenda[];
  pagamentos: Pagamento[];
  /** Desconto no total da venda; é repartido entre os itens */
  desconto?: number;
  /** Outras despesas (ex.: taxa de entrega); repartidas entre os itens */
  outrasDespesas?: number;
  /** Entrega em domicílio (delivery): exige documento, nome e endereço do destinatário */
  entrega?: boolean;
  destinatario?: Destinatario;
  informacoesComplementares?: string;
}

export interface DadosNota {
  /** 1 produção, 2 homologação */
  ambiente: 1 | 2;
  serie: number;
  numero: number;
  /** Padrão: agora */
  dataEmissao?: Date;
  /** Fuso do emitente para a data de emissão. Padrão America/Sao_Paulo */
  fuso?: string;
  /** 8 dígitos; padrão: sorteado */
  codigoNumerico?: string;
  /** Nome e versão do sistema emissor (verProc) */
  versaoAplicativo?: string;
}

export interface NfceMontada {
  /** <NFe> completo, ainda sem a <Signature> */
  xml: string;
  chave: string;
  numero: number;
  serie: number;
  dataEmissao: string;
  ambiente: 1 | 2;
  valorTotal: number;
  troco: number;
  qrCode: string;
  urlConsulta: string;
}
