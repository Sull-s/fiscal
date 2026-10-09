import { createHash } from "node:crypto";
import { type ArmazemArquivos, criarArquivoFiscal } from "@fiscal/armazenamento";
import { type CertificadoA1, abrirCertificadoA1 } from "@fiscal/certificado";
import { ErroFiscal } from "@fiscal/core";
import { type ClienteNfse, criarClienteNfse } from "@fiscal/nfse-nacional";
import { type ArmazemNumeracao, criarNumeracao } from "@fiscal/numeracao";
import { type ClienteSefaz, criarClienteSefaz } from "@fiscal/transporte";
import type { Cofre } from "./cofre";
import type { Empresa, RepositorioEmpresas } from "./empresas";
import { criarRegistros } from "./registros";

export interface DependenciasApi {
  cofre: Cofre;
  empresas: RepositorioEmpresas;
  /** Onde ficam XMLs, PDFs, índice e respostas idempotentes */
  arquivos: ArmazemArquivos;
  numeracao: ArmazemNumeracao;
  /** Token do administrador (cadastro de empresas). Sem ele, as rotas /v1/admin ficam desligadas */
  tokenAdmin?: string;
  /** Troca os clientes reais (testes) */
  fabricaSefaz?: (certificado: CertificadoA1) => ClienteSefaz;
  fabricaNfse?: (certificado: CertificadoA1, ambiente: 1 | 2) => ClienteNfse;
  /** Recebe cada chamada à SEFAZ/Sistema Nacional (log/auditoria) */
  aoRegistrar?: (evento: Record<string, unknown>) => void;
}

/** Monta os serviços e guarda em cache, por empresa, o certificado aberto e os clientes. */
export function criarContexto(deps: DependenciasApi) {
  interface EntradaCache {
    marca: string;
    certificado: CertificadoA1;
    sefaz?: ClienteSefaz;
    nfse?: ClienteNfse;
  }
  const cache = new Map<string, EntradaCache>();
  const numeracao = criarNumeracao(deps.numeracao);
  const arquivoFiscal = criarArquivoFiscal(deps.arquivos);
  const registros = criarRegistros(deps.arquivos);

  function entrada(empresa: Empresa): EntradaCache {
    const cert = empresa.certificado;
    if (!cert) {
      throw new ErroFiscal(
        "CERTIFICADO_NAO_CADASTRADO",
        "A empresa ainda não tem certificado digital cadastrado.",
      );
    }
    // A marca muda quando o certificado é trocado: aí o cache é refeito e as conexões fechadas
    const marca = createHash("sha256").update(cert.pfx).digest("hex");
    const atual = cache.get(empresa.id);
    if (atual?.marca === marca) return atual;
    atual?.sefaz?.fechar();
    atual?.nfse?.fechar();
    const certificado = abrirCertificadoA1(
      deps.cofre.decifrar(cert.pfx, empresa.id),
      deps.cofre.decifrar(cert.senha, empresa.id).toString("utf8"),
    );
    const novo: EntradaCache = { marca, certificado };
    cache.set(empresa.id, novo);
    return novo;
  }

  const registrar = (empresa: string) => (r: object) => deps.aoRegistrar?.({ empresa, ...r });

  return {
    deps,
    numeracao,
    arquivoFiscal,
    registros,
    certificado: (empresa: Empresa) => entrada(empresa).certificado,
    sefaz(empresa: Empresa): ClienteSefaz {
      const e = entrada(empresa);
      e.sefaz ??= deps.fabricaSefaz
        ? deps.fabricaSefaz(e.certificado)
        : criarClienteSefaz({ certificado: e.certificado, aoRegistrar: registrar(empresa.id) });
      return e.sefaz;
    },
    nfse(empresa: Empresa): ClienteNfse {
      const e = entrada(empresa);
      e.nfse ??= deps.fabricaNfse
        ? deps.fabricaNfse(e.certificado, empresa.ambiente)
        : criarClienteNfse({
            certificado: e.certificado,
            ambiente: empresa.ambiente,
            aoRegistrar: registrar(empresa.id),
          });
      return e.nfse;
    },
    /** Esquece o cache da empresa (ex.: certificado trocado) */
    esquecer(id: string) {
      const atual = cache.get(id);
      atual?.sefaz?.fechar();
      atual?.nfse?.fechar();
      cache.delete(id);
    },
  };
}

export type Contexto = ReturnType<typeof criarContexto>;
