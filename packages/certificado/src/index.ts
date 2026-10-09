export { type CertificadoA1, abrirCertificadoA1 } from "./abrir";
export {
  type LimitesAlerta,
  type SituacaoCertificado,
  certificadoServeParaEmitente,
  exigirCertificadoValido,
  situacaoCertificado,
} from "./validade";

import type { CertificadoA1 } from "./abrir";

/** Opções para `https.Agent` / `tls.connect` com autenticação mútua (SEFAZ, NFS-e Nacional). */
export function opcoesTls(cert: Pick<CertificadoA1, "chavePrivadaPem" | "cadeiaPem">) {
  return { key: cert.chavePrivadaPem, cert: cert.cadeiaPem };
}
