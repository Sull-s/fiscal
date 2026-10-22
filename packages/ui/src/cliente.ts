/**
 * Cliente da @fiscal/api para o navegador (ou qualquer lugar com fetch).
 *
 * Atenção: a chave de API (fsk_…) dá poder de emitir notas em nome da empresa. Num site aberto ao
 * público, não a coloque no navegador: passe `url` para um backend seu que repassa as chamadas
 * (e põe a chave lá). Chave direto no navegador só em sistema interno, com login.
 */

export interface OpcoesCliente {
  /** Endereço da API (ex.: https://fiscal.minhaempresa.com.br) ou do seu backend que repassa */
  url: string;
  /** Chave de API (fsk_…); omita quando o seu backend acrescenta a chave */
  chave?: string;
  fetch?: typeof fetch;
}

export class ErroApi extends Error {
  constructor(
    readonly status: number,
    readonly codigo: string,
    mensagem: string,
    readonly detalhes?: unknown,
  ) {
    super(mensagem);
    this.name = "ErroApi";
  }
}

export interface NotaResumo {
  modelo: "55" | "65" | "nfse";
  serie: string;
  numero: number;
  dataEmissao: string;
  chave?: string;
  situacao: string;
  valor: number;
}

export interface RelatorioMes {
  periodo: string;
  ambiente: 1 | 2;
  faturamento: number;
  grupos: { modelo: string; situacao: string; quantidade: number; valor: number }[];
  notas: NotaResumo[];
}

export interface ResultadoEmissaoNfce {
  chave: string;
  numero: number;
  serie: string;
  situacao: "autorizada" | "pendente" | "offline" | "rejeitada" | "denegada";
  cStat: string;
  motivo: string;
  protocolo?: string;
  valorTotal: number;
  troco: number;
  qrCode: string;
  urlConsulta: string;
}

export interface NotaRecebida {
  chave: string;
  emitente?: { documento: string; nome: string };
  dataEmissao?: string;
  valor?: number;
  situacaoNfe?: string;
  xmlCompleto: boolean;
  manifestacao?: { tipo: string; protocolo?: string; em: string };
}

export type TipoManifestacao = "ciencia" | "confirmacao" | "desconhecimento" | "nao-realizada";

/** Caminho da nota na API conforme o modelo. */
export const caminhoModelo = (modelo: string) =>
  modelo === "55" ? "nfe" : modelo === "nfse" ? "nfse" : "nfce";

export function criarClienteFiscal(opcoes: OpcoesCliente) {
  const base = opcoes.url.replace(/\/+$/, "");
  const buscar = opcoes.fetch ?? globalThis.fetch.bind(globalThis);

  async function chamar(
    metodo: string,
    caminho: string,
    corpo?: unknown,
    extra: Record<string, string> = {},
  ): Promise<Response> {
    const r = await buscar(`${base}${caminho}`, {
      method: metodo,
      headers: {
        ...(opcoes.chave ? { Authorization: `Bearer ${opcoes.chave}` } : {}),
        ...(corpo !== undefined ? { "Content-Type": "application/json" } : {}),
        ...extra,
      },
      ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}),
    });
    // 422 com corpo de nota (ex.: NFC-e rejeitada) é resposta normal; erro tem { erro }
    if (!r.ok && r.status !== 422) await falhar(r);
    return r;
  }
  async function falhar(r: Response): Promise<never> {
    const dados = (await r.json().catch(() => null)) as {
      erro?: { codigo: string; mensagem: string; detalhes?: unknown };
    } | null;
    throw new ErroApi(
      r.status,
      dados?.erro?.codigo ?? `HTTP_${r.status}`,
      dados?.erro?.mensagem ?? `A API respondeu ${r.status}.`,
      dados?.erro?.detalhes,
    );
  }
  async function json<T>(
    metodo: string,
    caminho: string,
    corpo?: unknown,
    extra?: Record<string, string>,
  ) {
    const r = await chamar(metodo, caminho, corpo, extra);
    const dados = (await r.json()) as T & {
      erro?: { codigo: string; mensagem: string; detalhes?: unknown };
    };
    if (dados && typeof dados === "object" && "erro" in dados && dados.erro) {
      throw new ErroApi(r.status, dados.erro.codigo, dados.erro.mensagem, dados.erro.detalhes);
    }
    return dados as T;
  }
  const arquivo = async (caminho: string) => (await chamar("GET", caminho)).blob();

  return {
    /** Dados da empresa (sem segredos) */
    empresa: () => json<Record<string, unknown>>("GET", "/v1/empresa"),
    relatorioMes: (ano: number, mes: number, ambiente: 1 | 2 = 1) =>
      json<RelatorioMes>(
        "GET",
        `/v1/relatorios/${ano}/${mes}?formato=json${ambiente === 2 ? "&ambiente=2" : ""}`,
      ),
    relatorioPdf: (ano: number, mes: number, ambiente: 1 | 2 = 1) =>
      arquivo(`/v1/relatorios/${ano}/${mes}${ambiente === 2 ? "?ambiente=2" : ""}`),
    zipMes: (ano: number, mes: number, ambiente: 1 | 2 = 1) =>
      arquivo(`/v1/arquivos/${ano}/${mes}${ambiente === 2 ? "?ambiente=2" : ""}`),
    /** Emite NFC-e. `idempotencia`: repetir com a mesma chave não emite duas vezes */
    emitirNfce: (venda: unknown, idempotencia?: string, referencia?: string) =>
      json<ResultadoEmissaoNfce>(
        "POST",
        "/v1/nfce",
        { venda, ...(referencia ? { referencia } : {}) },
        idempotencia ? { "Idempotency-Key": idempotencia } : {},
      ),
    nota: (modelo: string, chave: string) =>
      json<Record<string, unknown>>("GET", `/v1/${caminhoModelo(modelo)}/${chave}`),
    xml: async (modelo: string, chave: string) =>
      (await chamar("GET", `/v1/${caminhoModelo(modelo)}/${chave}/xml`)).text(),
    /** PDF (NF-e: DANFE A4; NFS-e: DANFSE) ou HTML do cupom (NFC-e) */
    documento: (modelo: string, chave: string) =>
      arquivo(
        `/v1/${caminhoModelo(modelo)}/${chave}/${modelo === "nfse" ? "danfse" : "danfe"}${modelo === "65" ? "?formato=html" : ""}`,
      ),
    cancelar: (modelo: string, chave: string, justificativa: string) =>
      json<Record<string, unknown>>(
        "POST",
        `/v1/${caminhoModelo(modelo)}/${chave}/cancelamento`,
        modelo === "nfse" ? { motivo: justificativa } : { justificativa },
      ),
    notasRecebidas: () => json<NotaRecebida[]>("GET", "/v1/dfe/notas"),
    /** XML completo de nota de fornecedor (depois da ciência) */
    xmlRecebida: async (chave: string) =>
      (await chamar("GET", `/v1/dfe/notas/${chave}/xml`)).text(),
    manifestar: (chave: string, tipo: TipoManifestacao, justificativa?: string) =>
      json<{ registrado: boolean; protocolo?: string }>(
        "POST",
        `/v1/dfe/notas/${chave}/manifestacao`,
        { tipo, ...(justificativa ? { justificativa } : {}) },
      ),
    /** SEFAZ do estado em operação? E a diferença do relógio deste computador */
    statusSefaz: () => json<StatusSefaz>("GET", "/v1/sefaz/status"),
    /**
     * Cadastro da empresa e certificado (rotas /v1/admin). No emissor embutido (@fiscal/agente)
     * funcionam direto: ele autentica sozinho. Num servidor exigem o token do administrador.
     */
    configuracao: (empresaId = "principal") => {
      const caminho = `/v1/admin/empresas/${empresaId}`;
      return {
        /** null quando a empresa ainda não foi cadastrada */
        obter: async (): Promise<EmpresaConfigurada | null> => {
          const r = await buscar(`${base}${caminho}`, {
            headers: opcoes.chave ? { Authorization: `Bearer ${opcoes.chave}` } : {},
          });
          if (r.status === 404) return null;
          if (!r.ok) await falhar(r);
          return (await r.json()) as EmpresaConfigurada;
        },
        salvar: (dados: Record<string, unknown>) => json<EmpresaConfigurada>("PUT", caminho, dados),
        /** O .pfx em base64 e a senha vão só para o emissor, que guarda tudo cifrado */
        enviarCertificado: (pfxBase64: string, senha: string) =>
          json<CertificadoInfo & { situacao: string; diasRestantes: number }>(
            "PUT",
            `${caminho}/certificado`,
            { pfxBase64, senha },
          ),
      };
    },
  };
}

export interface StatusSefaz {
  emOperacao: boolean;
  cStat: string;
  xMotivo: string;
  diferencaRelogioSegundos?: number;
}

export interface CertificadoInfo {
  titular: string;
  documento: string;
  validoAte: string;
}

/** Cadastro como o emissor devolve (sem segredos) */
export interface EmpresaConfigurada {
  id: string;
  nome: string;
  cnpj: string;
  ambiente: 1 | 2;
  nfce?: { emitente: EmitenteConfig; serie: string; contingenciaOffline?: boolean };
  nfe?: { emitente: EmitenteConfig; serie: string; contingenciaSvc?: boolean };
  nfse?: {
    prestador: {
      documento: string;
      telefone?: string;
      email?: string;
      regime: { opcaoSimples: number };
    };
    serie: string;
    servicoPadrao?: {
      codigoMunicipioPrestacao?: string;
      codigoTributacaoNacional?: string;
      codigoNbs?: string;
      /** Reforma tributária (NFS-e com competência a partir de 10/2026): códigos do contador */
      ibsCbs?: { cst: string; cClassTrib: string; cIndOp?: string };
    };
  };
  certificado: CertificadoInfo | null;
}

export interface EmitenteConfig {
  cnpj: string;
  inscricaoEstadual: string;
  razaoSocial: string;
  nomeFantasia?: string;
  crt: 1 | 2 | 3 | 4;
  endereco: {
    logradouro: string;
    numero?: string;
    complemento?: string;
    bairro: string;
    codigoMunicipio: string;
    municipio: string;
    uf: string;
    cep?: string;
    telefone?: string;
  };
}

export type ClienteFiscal = ReturnType<typeof criarClienteFiscal>;
