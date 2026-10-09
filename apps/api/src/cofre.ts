import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { ErroFiscal } from "@fiscal/core";

/**
 * Cifra segredos (certificado .pfx e senha) com AES-256-GCM. A chave mestra fica só na variável de
 * ambiente FISCAL_CHAVE_MESTRA (32 bytes em base64), nunca no banco/arquivo junto dos dados.
 * O "contexto" (id da empresa) entra como dado autenticado: um segredo copiado para outra empresa
 * não decifra.
 */
export function criarCofre(chaveMestraBase64: string) {
  const chave = Buffer.from(chaveMestraBase64, "base64");
  if (chave.length !== 32) {
    throw new ErroFiscal(
      "CHAVE_MESTRA_INVALIDA",
      "FISCAL_CHAVE_MESTRA deve ter 32 bytes em base64.",
    );
  }
  return {
    cifrar(conteudo: Uint8Array | string, contexto: string): string {
      const iv = randomBytes(12);
      const cifra = createCipheriv("aes-256-gcm", chave, iv);
      cifra.setAAD(Buffer.from(contexto));
      const dados = Buffer.concat([cifra.update(conteudo), cifra.final()]);
      return `v1:${Buffer.concat([iv, cifra.getAuthTag(), dados]).toString("base64")}`;
    },
    decifrar(cifrado: string, contexto: string): Buffer {
      if (!cifrado.startsWith("v1:"))
        throw new ErroFiscal("SEGREDO_INVALIDO", "Formato de segredo desconhecido.");
      const bruto = Buffer.from(cifrado.slice(3), "base64");
      try {
        const decifra = createDecipheriv("aes-256-gcm", chave, bruto.subarray(0, 12));
        decifra.setAAD(Buffer.from(contexto));
        decifra.setAuthTag(bruto.subarray(12, 28));
        return Buffer.concat([decifra.update(bruto.subarray(28)), decifra.final()]);
      } catch {
        throw new ErroFiscal(
          "SEGREDO_INVALIDO",
          "Não foi possível decifrar (chave mestra trocada ou dado adulterado).",
        );
      }
    },
  };
}

export type Cofre = ReturnType<typeof criarCofre>;

export const gerarChaveMestra = () => randomBytes(32).toString("base64");

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Compara hashes em tempo constante (não vaza, pelo tempo de resposta, quantos caracteres batem). */
export function hashesIguais(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && timingSafeEqual(x, y);
}
