import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import forge from "node-forge";

interface Opcoes {
  cn?: string;
  validoDe?: Date;
  validoAte?: Date;
  /** Inclui uma AC intermediária, colocada ANTES da folha no .pfx (como acontece em arquivos reais) */
  comCadeia?: boolean;
  senha?: string;
}

/** Certificado de teste descartável (sem valor fiscal). Chaves de 1024 bits só para os testes serem rápidos. */
export function gerarPfx(opcoes: Opcoes = {}) {
  const senha = opcoes.senha ?? "senha-teste";
  const criar = (
    cn: string,
    chavePublica: forge.pki.PublicKey,
    assinante: forge.pki.rsa.PrivateKey,
    emissorCn: string,
  ) => {
    const c = forge.pki.createCertificate();
    c.publicKey = chavePublica;
    c.serialNumber = String(Math.floor(Math.random() * 1e9).toString(16)).padStart(2, "0");
    c.validity.notBefore = opcoes.validoDe ?? new Date("2026-01-01T00:00:00Z");
    c.validity.notAfter = opcoes.validoAte ?? new Date("2036-01-01T00:00:00Z");
    c.setSubject([
      { name: "commonName", value: cn },
      { name: "countryName", value: "BR" },
    ]);
    c.setIssuer([
      { name: "commonName", value: emissorCn },
      { name: "countryName", value: "BR" },
    ]);
    c.sign(assinante, forge.md.sha256.create());
    return c;
  };

  const titular = forge.pki.rsa.generateKeyPair(1024);
  const cn = opcoes.cn ?? "EMPRESA TESTE LTDA:48618635000183";
  let certs: forge.pki.Certificate[];
  if (opcoes.comCadeia) {
    const ac = forge.pki.rsa.generateKeyPair(1024);
    const certAc = criar("AC TESTE v5", ac.publicKey, ac.privateKey, "AC TESTE v5");
    certs = [certAc, criar(cn, titular.publicKey, ac.privateKey, "AC TESTE v5")];
  } else {
    certs = [criar(cn, titular.publicKey, titular.privateKey, "AC AUTOASSINADA")];
  }

  const p12 = forge.pkcs12.toPkcs12Asn1(titular.privateKey, certs, senha, { algorithm: "3des" });
  return {
    pfx: Buffer.from(forge.asn1.toDer(p12).getBytes(), "binary"),
    senha,
    chavePrivadaPem: forge.pki.privateKeyToPem(titular.privateKey),
    pems: certs.map((c) => forge.pki.certificateToPem(c)),
  };
}

export function opensslDisponivel(): boolean {
  try {
    execFileSync("openssl", ["version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Gera .pfx com o openssl do sistema: padrão moderno (AES-256/SHA-256) ou `-legacy` (RC2-40). */
export function gerarPfxOpenssl(legado: boolean, senha = "senha-teste") {
  const pasta = mkdtempSync(join(tmpdir(), "fiscal-teste-"));
  try {
    const { chavePrivadaPem, pems } = gerarPfx({ senha });
    writeFileSync(join(pasta, "chave.pem"), chavePrivadaPem);
    writeFileSync(join(pasta, "cert.pem"), pems[0] ?? "");
    const saida = join(pasta, "saida.pfx");
    execFileSync("openssl", [
      "pkcs12",
      "-export",
      ...(legado ? ["-legacy"] : []),
      "-inkey",
      join(pasta, "chave.pem"),
      "-in",
      join(pasta, "cert.pem"),
      "-out",
      saida,
      "-passout",
      `pass:${senha}`,
    ]);
    return { pfx: readFileSync(saida), senha };
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
}
