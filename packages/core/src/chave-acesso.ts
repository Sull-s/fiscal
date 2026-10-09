import { ErroFiscal } from "./erros";
import { type Uf, codigoUf, siglaUf } from "./uf";

/**
 * Chave de acesso de 44 posições, comum a NF-e, NFC-e, CT-e e MDF-e:
 *
 *   cUF(2) AAMM(4) CNPJ/CPF(14) modelo(2) série(3) número(9) tpEmis(1) cNF(8) DV(1)
 *
 * Com o CNPJ alfanumérico, as posições do CNPJ podem conter letras; o DV usa
 * (código ASCII − 48) para cada caractere, o que dá o mesmo resultado para dígitos.
 */

/** 55 NF-e · 65 NFC-e · 57 CT-e · 58 MDF-e · 67 CT-e OS */
export type ModeloDocumento = "55" | "65" | "57" | "58" | "67";

/**
 * 1 normal · 2 FS-IA · 3 SCAN (extinto) · 4 EPEC · 5 FS-DA · 6 SVC-AN · 7 SVC-RS · 9 offline NFC-e
 */
export type TipoEmissao = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 9;

export interface PartesChaveAcesso {
  uf: Uf;
  /** Ano e mês da emissão no formato AAMM, ex.: "2610" */
  anoMes: string;
  /** CNPJ (14) ou CPF (11) do emitente, sem pontuação */
  documentoEmitente: string;
  modelo: ModeloDocumento;
  serie: number;
  numero: number;
  tipoEmissao: TipoEmissao;
  /** 8 dígitos; use `gerarCodigoNumerico` */
  codigoNumerico: string;
}

export interface ChaveAcessoDecomposta extends PartesChaveAcesso {
  chave: string;
  digitoVerificador: number;
}

const FORMATO_CHAVE = /^\d{6}[0-9A-Z]{12}\d{26}$/;

export function calcularDvChaveAcesso(base43: string): number {
  let soma = 0;
  let peso = 2;
  for (let i = base43.length - 1; i >= 0; i--) {
    soma += (base43.charCodeAt(i) - 48) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

/** Extrai AAMM de uma data/hora no formato SEFAZ ("2026-10-06T12:30:00-03:00"). */
export function anoMesDaEmissao(dataHoraEmissao: string): string {
  const m = /^\d{2}(\d{2})-(\d{2})-/.exec(dataHoraEmissao);
  if (!m) {
    throw new ErroFiscal(
      "DATA_INVALIDA",
      `Data de emissão fora do formato AAAA-MM-DD…: ${dataHoraEmissao}`,
    );
  }
  return `${m[1]}${m[2]}`;
}

/**
 * Código numérico aleatório (cNF). A SEFAZ rejeita se for igual ao número da nota,
 * então sorteia de novo nesse caso.
 */
export function gerarCodigoNumerico(numeroNota: number): string {
  const buffer = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buffer);
    const valor = (buffer[0] ?? 0) % 100_000_000;
    if (valor !== numeroNota) return String(valor).padStart(8, "0");
  }
}

function documentoNaChave(documento: string): string {
  const limpo = documento.replace(/[^0-9a-zA-Z]/g, "").toUpperCase();
  if (limpo.length === 11 && /^\d+$/.test(limpo)) return limpo.padStart(14, "0");
  if (limpo.length === 14) return limpo;
  throw new ErroFiscal("DOCUMENTO_INVALIDO", "Emitente precisa de CNPJ (14) ou CPF (11)", {
    documento,
  });
}

function exigirFaixa(campo: string, valor: number, max: number): void {
  if (!Number.isInteger(valor) || valor < 0 || valor > max) {
    throw new ErroFiscal("CAMPO_INVALIDO", `${campo} deve ser inteiro entre 0 e ${max}`, {
      campo,
      valor,
    });
  }
}

export function montarChaveAcesso(partes: PartesChaveAcesso): string {
  if (!/^\d{4}$/.test(partes.anoMes)) {
    throw new ErroFiscal("CAMPO_INVALIDO", "anoMes deve ter 4 dígitos (AAMM)");
  }
  if (!/^\d{8}$/.test(partes.codigoNumerico)) {
    throw new ErroFiscal("CAMPO_INVALIDO", "codigoNumerico deve ter 8 dígitos");
  }
  exigirFaixa("serie", partes.serie, 999);
  exigirFaixa("numero", partes.numero, 999_999_999);

  const base =
    String(codigoUf(partes.uf)) +
    partes.anoMes +
    documentoNaChave(partes.documentoEmitente) +
    partes.modelo +
    String(partes.serie).padStart(3, "0") +
    String(partes.numero).padStart(9, "0") +
    String(partes.tipoEmissao) +
    partes.codigoNumerico;

  return base + calcularDvChaveAcesso(base);
}

export function validarChaveAcesso(chave: string): boolean {
  const limpa = chave.replace(/^(NFe|NFCe|CTe|MDFe)/, "");
  if (!FORMATO_CHAVE.test(limpa)) return false;
  return Number(limpa[43]) === calcularDvChaveAcesso(limpa.slice(0, 43));
}

/** Aceita a chave pura ou com prefixo do Id do XML ("NFe4326…"). */
export function decomporChaveAcesso(chave: string): ChaveAcessoDecomposta {
  const limpa = chave.replace(/^(NFe|NFCe|CTe|MDFe)/, "");
  if (!validarChaveAcesso(limpa)) {
    throw new ErroFiscal("CHAVE_INVALIDA", "Chave de acesso inválida", { chave });
  }
  return {
    chave: limpa,
    uf: siglaUf(Number(limpa.slice(0, 2))),
    anoMes: limpa.slice(2, 6),
    documentoEmitente: limpa.slice(6, 20),
    modelo: limpa.slice(20, 22) as ModeloDocumento,
    serie: Number(limpa.slice(22, 25)),
    numero: Number(limpa.slice(25, 34)),
    tipoEmissao: Number(limpa[34]) as TipoEmissao,
    codigoNumerico: limpa.slice(35, 43),
    digitoVerificador: Number(limpa[43]),
  };
}
