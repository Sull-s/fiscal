import { ErroFiscal } from "@fiscal/core";
import { describe, expect, it } from "vitest";
import { gerarPfx, gerarPfxOpenssl, opensslDisponivel } from "../testes/gerar-pfx";
import { abrirCertificadoA1 } from "./abrir";
import { opcoesTls } from "./index";

describe("abrirCertificadoA1", () => {
  it("lê titular, CNPJ, emissor e validade", () => {
    const { pfx, senha } = gerarPfx();
    const cert = abrirCertificadoA1(pfx, senha);

    expect(cert.titular).toBe("EMPRESA TESTE LTDA");
    expect(cert.documento).toBe("48618635000183");
    expect(cert.emissor).toBe("AC AUTOASSINADA");
    expect(cert.validoDe.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(cert.validoAte.toISOString()).toBe("2036-01-01T00:00:00.000Z");
    expect(cert.chavePrivadaPem).toMatch(/^-----BEGIN RSA PRIVATE KEY-----/);
    expect(cert.certificadoBase64).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });

  it("lê e-CPF", () => {
    const { pfx, senha } = gerarPfx({ cn: "FULANO DE TAL:52998224725" });
    const cert = abrirCertificadoA1(pfx, senha);
    expect(cert.titular).toBe("FULANO DE TAL");
    expect(cert.documento).toBe("52998224725");
  });

  it("lê CNPJ alfanumérico no CN", () => {
    const { pfx, senha } = gerarPfx({ cn: "EMPRESA NOVA LTDA:12ABC34501DE35" });
    expect(abrirCertificadoA1(pfx, senha).documento).toBe("12ABC34501DE35");
  });

  it("acha o certificado do titular mesmo com a AC antes dele no arquivo", () => {
    const { pfx, senha, pems } = gerarPfx({ comCadeia: true });
    const cert = abrirCertificadoA1(pfx, senha);
    const [pemAc, pemFolha] = pems;
    const normalizar = (p: string | undefined) => (p ?? "").replace(/\s/g, "");

    expect(cert.titular).toBe("EMPRESA TESTE LTDA");
    expect(cert.emissor).toBe("AC TESTE v5");
    expect(normalizar(cert.certificadoPem)).toBe(normalizar(pemFolha));
    // Cadeia para mTLS: folha primeiro, depois a AC
    expect(normalizar(cert.cadeiaPem)).toBe(normalizar(pemFolha) + normalizar(pemAc));
    expect(opcoesTls(cert)).toEqual({ key: cert.chavePrivadaPem, cert: cert.cadeiaPem });
  });

  it("senha errada dá erro específico", () => {
    const { pfx } = gerarPfx();
    try {
      abrirCertificadoA1(pfx, "senha-errada");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ErroFiscal);
      expect((e as ErroFiscal).codigo).toBe("CERTIFICADO_SENHA_INCORRETA");
    }
  });

  it("arquivo que não é certificado dá erro claro", () => {
    try {
      abrirCertificadoA1(Buffer.from("isto não é um pfx"), "x");
      expect.unreachable();
    } catch (e) {
      expect((e as ErroFiscal).codigo).toBe("CERTIFICADO_INVALIDO");
    }
  });

  describe.skipIf(!opensslDisponivel())("arquivos gerados pelo openssl", () => {
    it("abre .pfx moderno (AES-256 / SHA-256, padrão do OpenSSL 3)", () => {
      const { pfx, senha } = gerarPfxOpenssl(false);
      expect(abrirCertificadoA1(pfx, senha).documento).toBe("48618635000183");
    });

    it("abre .pfx legado (RC2-40, comum em certificados ICP-Brasil)", () => {
      const { pfx, senha } = gerarPfxOpenssl(true);
      expect(abrirCertificadoA1(pfx, senha).documento).toBe("48618635000183");
    });
  });
});
