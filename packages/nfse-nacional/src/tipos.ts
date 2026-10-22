/** Endereço nacional (o Sistema Nacional também aceita exterior; ainda não suportado aqui). */
export interface EnderecoNfse {
  /** Código IBGE do município (7 dígitos) */
  codigoMunicipio: string;
  cep: string;
  logradouro: string;
  numero: string;
  complemento?: string;
  bairro: string;
}

export interface RegimeTributario {
  /** 1 = não optante · 2 = MEI · 3 = Simples Nacional ME/EPP */
  opcaoSimples: 1 | 2 | 3;
  /**
   * Só para opção 3: 1 = tributos federais e municipal pelo SN · 2 = federais pelo SN e ISS fora
   * · 3 = tudo fora do SN. Padrão 1.
   */
  apuracaoSimples?: 1 | 2 | 3;
  /** Regime especial: 0 nenhum (padrão), 1 ato cooperado, 2 estimativa, 3 microempresa municipal, 4 notário, 5 profissional autônomo, 6 sociedade de profissionais */
  regimeEspecial?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
}

export interface Prestador {
  /** CNPJ ou CPF (o mesmo do certificado) */
  documento: string;
  inscricaoMunicipal?: string;
  /** Normalmente não vai quando o próprio prestador emite (o Sistema Nacional usa o cadastro) */
  nome?: string;
  telefone?: string;
  email?: string;
  regime: RegimeTributario;
}

export interface Tomador {
  /** CNPJ ou CPF */
  documento?: string;
  inscricaoMunicipal?: string;
  nome: string;
  endereco?: EnderecoNfse;
  telefone?: string;
  email?: string;
}

/**
 * Grupo IBS/CBS da DPS (reforma tributária). Só existe no leiaute 2026-10, onde é obrigatório
 * para competência a partir de 10/2026 (regra E0855). Os códigos dependem da atividade e do
 * regime: peça ao contador (tabelas oficiais de CST e cClassTrib do IBS/CBS).
 */
export interface IbsCbsNfse {
  /** CST do IBS/CBS, 3 dígitos (ex.: "000" = tributação integral) */
  cst: string;
  /** Código de classificação tributária, 6 dígitos (ex.: "000001") */
  cClassTrib: string;
  /** Código indicador da operação (tabela do Anexo VII da NFS-e), 6 dígitos */
  cIndOp?: string;
  /** 1 = operação de uso ou consumo pessoal (art. 57 da LC 214/2025) */
  indFinal?: 0 | 1;
}

export interface Servico {
  /** Município onde o serviço foi prestado (IBGE, 7 dígitos) */
  codigoMunicipioPrestacao: string;
  /** Código de tributação nacional (item da LC 116 com 6 dígitos, ex.: 010601) */
  codigoTributacaoNacional: string;
  codigoTributacaoMunicipal?: string;
  /** Código NBS (9 dígitos) */
  codigoNbs?: string;
  descricao: string;
  informacoesComplementares?: string;
  /** Grupo IBS/CBS (leiaute 2026-10). Ignorado no leiaute 2026-02 */
  ibsCbs?: IbsCbsNfse;
}

export interface Valores {
  valorServico: number;
  descontoIncondicionado?: number;
  descontoCondicionado?: number;
  /** 1 tributável (padrão) · 2 exportação · 3 não incidência · 4 imunidade */
  tributacaoIssqn?: 1 | 2 | 3 | 4;
  /** Obrigatório com tributacaoIssqn = 4 */
  tipoImunidade?: number;
  /** Alíquota do ISS em % (quando o município exige informar) */
  aliquotaIss?: number;
  /** 1 não retido (padrão) · 2 retido pelo tomador · 3 retido pelo intermediário */
  retencaoIss?: 1 | 2 | 3;
  /** CST de PIS/COFINS (grupo federal opcional) */
  cstPisCofins?: string;
  /**
   * Total aproximado de tributos: percentual do Simples (ME/EPP) OU nada.
   * Sem percentual vai indTotTrib=0 ("não informado"), que é o certo para MEI.
   */
  percentualTributosSimples?: number;
}

/**
 * Leiaute da DPS, pela data dos esquemas oficiais (gov.br/nfse):
 *   "2026-02"  esquemas de produção de 09/02/2026 — o que a PRODUÇÃO aceita hoje
 *   "2026-10"  esquemas da produção restrita de 20/10/2026 (reforma tributária, NT 009):
 *              finNFSe obrigatório depois de tpEmit e cNBS antes da descrição do serviço
 * Os dois são incompatíveis entre si. Sem `leiaute`, vale o padrão de cada ambiente
 * (LEIAUTE_PADRAO) e emitirNfse troca sozinho se o Sistema Nacional recusar por esquema.
 */
export type LeiauteDps = "2026-02" | "2026-10";

export interface DadosDps {
  /** 1 produção · 2 produção restrita (homologação) */
  ambiente: 1 | 2;
  /** Leiaute forçado (normalmente omita: veja LeiauteDps) */
  leiaute?: LeiauteDps;
  /** Até 5 dígitos. Use uma série só para testes (ex.: "900") */
  serie: string;
  numero: number;
  /** Município emissor (IBGE). Padrão: o da prestação */
  codigoMunicipioEmissor?: string;
  /** Competência AAAA-MM-DD. Padrão: a data de emissão */
  competencia?: string;
  /** Padrão: agora */
  dataEmissao?: Date;
  /**
   * Segundos subtraídos da data de emissão (padrão 60). Se o relógio do PC estiver adiantado, o
   * Sistema Nacional rejeita com E0008 (emissão posterior ao processamento); um minuto no passado
   * é inofensivo.
   */
  margemRelogioSegundos?: number;
  /** Padrão America/Sao_Paulo */
  fuso?: string;
  versaoAplicativo: string;
  /** 1 prestador (padrão) · 2 tomador · 3 intermediário */
  tipoEmitente?: 1 | 2 | 3;
}

export interface DpsMontada {
  /** <DPS> completo, ainda sem a <Signature> */
  xml: string;
  /** Id do infDPS (45 caracteres): também serve para consultar a DPS depois */
  id: string;
  dataEmissao: string;
  /** Leiaute em que foi montada */
  leiaute: LeiauteDps;
}
