import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ErroFiscal } from "@fiscal/core";
import forge from "node-forge";

export interface CertificadoA1 {
  /** Chave privada em PEM, para assinar XML */
  chavePrivadaPem: string;
  /** Certificado do titular (folha) em PEM */
  certificadoPem: string;
  /** Folha + intermediárias, nesta ordem: é o que o handshake mTLS precisa */
  cadeiaPem: string;
  /** Certificado do titular em DER/base64, sem quebras: vai no <X509Certificate> da assinatura */
  certificadoBase64: string;
  /** Nome do titular sem o documento: "EMPRESA LTDA" */
  titular: string;
  /** CNPJ (14) ou CPF (11) do titular; vazio se o certificado não trouxer */
  documento: string;
  /** CN de quem emitiu o certificado (a AC) */
  emissor: string;
  numeroSerie: string;
  validoDe: Date;
  validoAte: Date;
}

interface MaterialPem {
  chavePem: string;
  folhaPem: string;
  intermediariasPem: string[];
}

/**
 * Abre um certificado A1 (.pfx / .p12) a partir dos bytes do arquivo.
 *
 * Usa o node-forge (JS puro), que lê os PKCS#12 com RC2-40 e 3DES comuns na ICP-Brasil, coisa que o
 * OpenSSL 3 embutido no Node recusa ("Unsupported PKCS12 PFX data"). Se o forge não conseguir,
 * tenta o binário `openssl` (com `-legacy` se preciso). Por isso o resto do sistema nunca recebe o
 * .pfx cru: só PEMs.
 */
export function abrirCertificadoA1(pfx: Uint8Array, senha: string): CertificadoA1 {
  let material: MaterialPem;
  try {
    material = viaForge(pfx, senha);
  } catch (erroForge) {
    const mensagem = erroForge instanceof Error ? erroForge.message : String(erroForge);
    if (erroForge instanceof ErroFiscal) throw erroForge;
    if (/invalid password|mac could not be verified/i.test(mensagem)) {
      throw new ErroFiscal("CERTIFICADO_SENHA_INCORRETA", "Senha do certificado incorreta.");
    }
    try {
      material = viaOpenssl(pfx, senha);
    } catch (erroOpenssl) {
      throw new ErroFiscal(
        "CERTIFICADO_INVALIDO",
        "Não consegui abrir o certificado: confira o arquivo .pfx e a senha.",
        {
          forge: mensagem,
          openssl: erroOpenssl instanceof Error ? erroOpenssl.message : String(erroOpenssl),
        },
      );
    }
  }
  return descrever(material);
}

function viaForge(pfx: Uint8Array, senha: string): MaterialPem {
  const der = forge.util.createBuffer(Buffer.from(pfx).toString("binary"));
  const p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(der), senha);

  const oids = forge.pki.oids;
  const chaves = [
    ...(p12.getBags({ bagType: oids.pkcs8ShroudedKeyBag })[oids.pkcs8ShroudedKeyBag ?? ""] ?? []),
    ...(p12.getBags({ bagType: oids.keyBag })[oids.keyBag ?? ""] ?? []),
  ];
  const certs = (p12.getBags({ bagType: oids.certBag })[oids.certBag ?? ""] ?? [])
    .map((b) => b.cert)
    .filter((c): c is forge.pki.Certificate => Boolean(c));

  const chave = chaves[0]?.key as forge.pki.rsa.PrivateKey | undefined;
  if (!chave) {
    throw new ErroFiscal(
      "CERTIFICADO_SEM_CHAVE",
      "O arquivo não tem a chave privada do certificado.",
    );
  }
  if (certs.length === 0) {
    throw new ErroFiscal("CERTIFICADO_INVALIDO", "O arquivo não tem nenhum certificado.");
  }

  // O .pfx costuma trazer a cadeia junto; o do titular é o que casa com a chave privada
  const folha =
    certs.find((c) => (c.publicKey as forge.pki.rsa.PublicKey).n?.equals(chave.n)) ?? certs[0];
  if (!folha) throw new ErroFiscal("CERTIFICADO_INVALIDO", "O arquivo não tem nenhum certificado.");

  return {
    chavePem: forge.pki.privateKeyToPem(chave),
    folhaPem: forge.pki.certificateToPem(folha),
    intermediariasPem: certs.filter((c) => c !== folha).map((c) => forge.pki.certificateToPem(c)),
  };
}

const RE_CERT = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g;
const RE_CHAVE = /-----BEGIN (?:RSA )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA )?PRIVATE KEY-----/;

function viaOpenssl(pfx: Uint8Array, senha: string): MaterialPem {
  const pasta = mkdtempSync(join(tmpdir(), "fiscal-pfx-"));
  const arquivo = join(pasta, "certificado.pfx");
  try {
    writeFileSync(arquivo, pfx, { mode: 0o600 });
    // Senha por variável de ambiente do processo filho: não aparece na lista de processos
    const rodar = (args: string[]) =>
      execFileSync(
        "openssl",
        ["pkcs12", "-in", arquivo, "-passin", "env:FISCAL_SENHA_PFX", ...args],
        {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          env: { ...process.env, FISCAL_SENHA_PFX: senha },
        },
      );
    const tentar = (args: string[]) => {
      try {
        return rodar(args);
      } catch {
        return rodar([...args, "-legacy"]);
      }
    };

    const folhaPem = tentar(["-nokeys", "-clcerts"]).match(RE_CERT)?.[0];
    const chavePem = tentar(["-nocerts", "-nodes"]).match(RE_CHAVE)?.[0];
    if (!folhaPem || !chavePem) throw new Error("saída do openssl sem certificado ou chave");

    const semEspacos = (p: string) => p.replace(/\s/g, "");
    const todos = tentar(["-nokeys"]).match(RE_CERT) ?? [];
    return {
      chavePem: `${chavePem}\n`,
      folhaPem: `${folhaPem}\n`,
      intermediariasPem: todos
        .filter((p) => semEspacos(p) !== semEspacos(folhaPem))
        .map((p) => `${p}\n`),
    };
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
}

function campo(nome: forge.pki.Certificate["subject"], chave: string): string {
  const valor = nome.getField(chave)?.value;
  return typeof valor === "string" ? valor : "";
}

function descrever({ chavePem, folhaPem, intermediariasPem }: MaterialPem): CertificadoA1 {
  const cert = forge.pki.certificateFromPem(folhaPem);
  const cn = campo(cert.subject, "CN");
  // e-CNPJ / e-CPF da ICP-Brasil: o CN termina em ":<documento>"
  const documento = /:([0-9A-Z]{12}\d{2}|\d{11})\s*$/.exec(cn)?.[1] ?? "";
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();

  return {
    chavePrivadaPem: chavePem,
    certificadoPem: folhaPem,
    cadeiaPem: [folhaPem, ...intermediariasPem].join(""),
    certificadoBase64: Buffer.from(der, "binary").toString("base64"),
    titular: cn.replace(/:([0-9A-Z]{12}\d{2}|\d{11})\s*$/, "").trim(),
    documento,
    emissor: campo(cert.issuer, "CN"),
    numeroSerie: cert.serialNumber,
    validoDe: cert.validity.notBefore,
    validoAte: cert.validity.notAfter,
  };
}
