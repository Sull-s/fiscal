import { createHash } from "node:crypto";
import { type ArmazemArquivos, criarArquivoFiscal } from "@fiscal/armazenamento";
import { type CertificadoA1, abrirCertificadoA1 } from "@fiscal/certificado";
import { ErroFiscal } from "@fiscal/core";
import { type ClienteNfse, criarClienteNfse } from "@fiscal/nfse-nacional";
import { type ArmazemNumeracao, criarNumeracao } from "@fiscal/numeracao";
import { type ClienteSefaz, criarClienteSefaz } from "@fiscal/transporte";
import type { Cofre } from "./cofre";
import type { Empresa, RepositorioEmpresas } from "./empresas";
import type { EnviarAlertas } from "./monitor";
import { criarRegistros } from "./registros";
import { type EnviarWebhook, criarWebhooks } from "./webhooks";

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
  /** Troca o envio HTTP dos webhooks (testes). Padrão: fetch */
  enviarWebhook?: EnviarWebhook;
  /** Origens que podem chamar a API do navegador (CORS), ex.: ["https://app.cliente.com.br"] */
  origensPermitidas?: string[];
  /** Para onde mandar os alertas do monitoramento (ex.: alertasPorUrl(FISCAL_ALERTA_URL)) */
  enviarAlertas?: EnviarAlertas;
  /** Informações extras no GET /saude (ex.: último backup do agente local) */
  saude?: () => Record<string, unknown>;
}

/** Monta os serviços e guarda em cache, por empresa, o certificado aberto e os clientes. */
export function criarContexto(deps: DependenciasApi) {
  interface EntradaCache {
    marca: string;
    certificado: CertificadoA1;
    sefaz?: ClienteSefaz;
    /** Um cliente por ambiente: a mesma empresa pode testar em homologação estando em produção */
    nfse?: Partial<Record<1 | 2, ClienteNfse>>;
  }
  const cache = new Map<string, EntradaCache>();
  const numeracao = criarNumeracao(deps.numeracao);
  const arquivoFiscal = criarArquivoFiscal(deps.arquivos);
  const webhooks = criarWebhooks({
    armazem: deps.arquivos,
    empresas: deps.empresas,
    cofre: deps.cofre,
    ...(deps.enviarWebhook ? { enviar: deps.enviarWebhook } : {}),
  });
  // Toda mudança de situação de nota vira evento: "nfce.autorizada", "nfse.cancelada"…
  const registros = criarRegistros(deps.arquivos, {
    aoMudarSituacao: async (empresa, r) => {
      await webhooks.publicar(
        empresa,
        `${{ "55": "nfe", "65": "nfce", nfse: "nfse" }[r.modelo]}.${r.situacao}`,
        r,
      );
    },
  });

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
    for (const n of Object.values(atual?.nfse ?? {})) n.fechar();
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
    webhooks,
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
      e.nfse ??= {};
      const cliente =
        e.nfse[empresa.ambiente] ??
        (deps.fabricaNfse
          ? deps.fabricaNfse(e.certificado, empresa.ambiente)
          : criarClienteNfse({
              certificado: e.certificado,
              ambiente: empresa.ambiente,
              aoRegistrar: registrar(empresa.id),
            }));
      e.nfse[empresa.ambiente] = cliente;
      return cliente;
    },
    /** Esquece o cache da empresa (ex.: certificado trocado) */
    esquecer(id: string) {
      const atual = cache.get(id);
      atual?.sefaz?.fechar();
      for (const n of Object.values(atual?.nfse ?? {})) n.fechar();
      cache.delete(id);
    },
  };
}

export type Contexto = ReturnType<typeof criarContexto>;
