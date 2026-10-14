import { randomBytes } from "node:crypto";
import type { ArmazemArquivos } from "@fiscal/armazenamento";
import { ErroFiscal } from "@fiscal/core";
import type { EmitenteNfce } from "@fiscal/nfce";
import type { EmitenteNfe } from "@fiscal/nfe";
import type { Prestador, Servico } from "@fiscal/nfse-nacional";
import { hashToken, hashesIguais } from "./cofre";

export interface Empresa {
  /** Identificador curto: letras minúsculas, números e hífen (ex.: "rose") */
  id: string;
  nome: string;
  cnpj: string;
  /** 1 produção, 2 homologação */
  ambiente: 1 | 2;
  nfce?: {
    emitente: EmitenteNfce;
    serie: string;
    versaoAplicativo?: string;
    /**
     * SEFAZ fora do ar na hora da venda: emite em contingência offline em vez de falhar.
     * As notas offline precisam ser transmitidas depois (POST /v1/nfce/offline/transmitir).
     */
    contingenciaOffline?: boolean;
  };
  nfse?: {
    prestador: Prestador;
    serie: string;
    versaoAplicativo?: string;
    /**
     * Campos do serviço que quase nunca mudam (códigos de tributação, NBS, local): quem emite
     * manda só o que falta, em geral a descrição
     */
    servicoPadrao?: Partial<Servico>;
  };
  nfe?: {
    emitente: EmitenteNfe;
    serie: string;
    versaoAplicativo?: string;
    /** SEFAZ do estado fora do ar: emite pela SEFAZ virtual de contingência (SVC) em vez de falhar */
    contingenciaSvc?: boolean;
  };
  /** Baixar as notas emitidas contra o CNPJ (distribuição DF-e) de hora em hora */
  dfe?: {
    ativo: boolean;
    /** Manifesta "ciência" de cada nota nova, para o XML completo ser liberado */
    cienciaAutomatica?: boolean;
  };
  certificado?: {
    /** .pfx cifrado pelo cofre */
    pfx: string;
    /** senha cifrada pelo cofre */
    senha: string;
    titular: string;
    documento: string;
    validoAte: string;
  };
  chavesApi: { id: string; hash: string; criadaEm: string }[];
  /** Para onde avisar mudanças de situação das notas. `segredo` cifrado pelo cofre */
  webhook?: { url: string; segredo: string; criadoEm: string };
  criadaEm: string;
  atualizadaEm: string;
}

/** Visão da empresa sem segredos, para devolver pela API. */
export function empresaPublica(e: Empresa) {
  const { certificado, chavesApi, webhook, ...resto } = e;
  return {
    ...resto,
    certificado: certificado
      ? {
          titular: certificado.titular,
          documento: certificado.documento,
          validoAte: certificado.validoAte,
        }
      : null,
    chavesApi: chavesApi.map((c) => ({ id: c.id, criadaEm: c.criadaEm })),
    webhook: webhook ? { url: webhook.url, criadoEm: webhook.criadoEm } : null,
  };
}

const ID_VALIDO = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

export function validarIdEmpresa(id: string): string {
  if (!ID_VALIDO.test(id)) {
    throw new ErroFiscal(
      "EMPRESA_ID_INVALIDO",
      "Id da empresa: letras minúsculas, números e hífen (até 40).",
    );
  }
  return id;
}

export interface RepositorioEmpresas {
  obter(id: string): Promise<Empresa | null>;
  salvar(empresa: Empresa): Promise<void>;
  listar(): Promise<Empresa[]>;
}

/** Empresas como JSON em qualquer armazém de arquivos (disco, Blob…), em `_empresas/{id}.json`. */
export function repositorioEmpresasEmArquivos(armazem: ArmazemArquivos): RepositorioEmpresas {
  const caminho = (id: string) => `_empresas/${validarIdEmpresa(id)}.json`;
  const repo: RepositorioEmpresas = {
    async obter(id) {
      if (!ID_VALIDO.test(id)) return null;
      const bytes = await armazem.ler(caminho(id));
      return bytes ? (JSON.parse(new TextDecoder().decode(bytes)) as Empresa) : null;
    },
    async salvar(empresa) {
      await armazem.gravar(
        caminho(empresa.id),
        new TextEncoder().encode(JSON.stringify(empresa, null, 2)),
        "application/json",
      );
    },
    async listar() {
      const caminhos = await armazem.listar("_empresas/");
      const ids = caminhos.map((c) => c.slice("_empresas/".length, -".json".length));
      return (await Promise.all(ids.map((id) => repo.obter(id)))).filter(
        (e): e is Empresa => e !== null,
      );
    },
  };
  return repo;
}

/**
 * Chave de API da empresa: "fsk_{idEmpresa}.{segredo}". O id na frente permite achar a empresa sem
 * varrer todas; no cadastro só fica o hash SHA-256 (quem lê o arquivo não consegue usar a chave).
 */
export function gerarChaveApi(empresaId: string) {
  const chave = `fsk_${empresaId}.${randomBytes(32).toString("base64url")}`;
  return {
    chave,
    registro: {
      id: randomBytes(4).toString("hex"),
      hash: hashToken(chave),
      criadaEm: new Date().toISOString(),
    },
  };
}

export async function autenticarChaveApi(
  repo: RepositorioEmpresas,
  token: string,
): Promise<Empresa | null> {
  const m = /^fsk_([a-z0-9-]+)\.[A-Za-z0-9_-]{40,}$/.exec(token);
  if (!m?.[1]) return null;
  const empresa = await repo.obter(m[1]);
  if (!empresa) return null;
  const hash = hashToken(token);
  return empresa.chavesApi.some((c) => hashesIguais(c.hash, hash)) ? empresa : null;
}
