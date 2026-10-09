import { readFileSync } from "node:fs";
import { join } from "node:path";
import { abrirCertificadoA1 } from "@fiscal/certificado";
import { ErroFiscal } from "@fiscal/core";
import { describe, expect, it } from "vitest";
import { type PerfilAssinatura, assinarXml, verificarAssinaturas } from "./assinatura";

/**
 * Fixtures geradas por um script único que assinou os documentos com o CÓDIGO ANTIGO (em produção:
 * apis/mp-marketplace-oauth/lib/nfce e apis/nfse-nacional-teste) usando certificado-teste.pfx.
 * RSA PKCS#1 v1.5 é determinístico: mesma chave + mesmo conteúdo canônico = mesma assinatura.
 */
const FIXTURES = join(import.meta.dirname, "..", "testes", "fixtures");
const ler = (nome: string) => readFileSync(join(FIXTURES, nome), "utf8");
const certificado = abrirCertificadoA1(
  readFileSync(join(FIXTURES, "certificado-teste.pfx")),
  "senha-teste",
);

const CASOS: [string, string, PerfilAssinatura][] = [
  ["nfce", "infNFe", "sefaz"],
  ["evento-cancelamento", "infEvento", "sefaz"],
  ["inutilizacao", "infInut", "sefaz"],
  ["dps", "infDPS", "nfse-nacional"],
];

describe("assinarXml: igual ao emissor em produção", () => {
  it.each(CASOS)("%s: XML assinado idêntico byte a byte", (nome, elemento, perfil) => {
    const novo = assinarXml(ler(`${nome}.xml`), { certificado, elemento, perfil });
    expect(novo).toBe(ler(`${nome}.assinado-antigo.xml`));
  });

  it.each(CASOS)("%s: assinatura confere", (nome, elemento, perfil) => {
    const novo = assinarXml(ler(`${nome}.xml`), { certificado, elemento, perfil });
    expect(verificarAssinaturas(novo).valida).toBe(true);
  });

  it("NFC-e: <Signature> fica depois do <infNFeSupl> (QR Code)", () => {
    const novo = assinarXml(ler("nfce.xml"), { certificado, elemento: "infNFe", perfil: "sefaz" });
    expect(novo).toMatch(
      /<\/infNFeSupl><Signature xmlns="http:\/\/www\.w3\.org\/2000\/09\/xmldsig#">/,
    );
    expect(novo.endsWith("</Signature></NFe>")).toBe(true);
  });
});

describe("assinarXml: erros", () => {
  it("recusa quando o elemento não existe", () => {
    expect(() =>
      assinarXml(ler("nfce.xml"), { certificado, elemento: "infCTe", perfil: "sefaz" }),
    ).toThrow(ErroFiscal);
  });

  it("recusa elemento sem Id", () => {
    expect(() =>
      assinarXml("<NFe><infNFe>x</infNFe></NFe>", {
        certificado,
        elemento: "infNFe",
        perfil: "sefaz",
      }),
    ).toThrow(/Id/);
  });

  it("recusa XML mal formado", () => {
    try {
      assinarXml("<NFe><infNFe Id='a'></NFe>", {
        certificado,
        elemento: "infNFe",
        perfil: "sefaz",
      });
      expect.unreachable();
    } catch (e) {
      expect((e as ErroFiscal).codigo).toBe("XML_MAL_FORMADO");
    }
  });
});

describe("verificarAssinaturas", () => {
  it("valida as duas assinaturas reais de uma NFS-e do Sistema Nacional (emitente e Receita)", () => {
    const r = verificarAssinaturas(ler("nfse-real-homologacao.xml"));
    expect(r.valida).toBe(true);
    expect(r.assinaturas).toEqual([
      { referencia: "#DPS431490221044053200010100900000000000000001", valida: true },
      { referencia: "#NFS43149022210440532000101000000000000126089303229430", valida: true },
    ]);
  });

  it("detecta adulteração de um valor depois de assinado", () => {
    const assinado = ler("nfce.assinado-antigo.xml");
    const adulterado = assinado.replace("<vNF>", "<vNF>1");
    expect(adulterado).not.toBe(assinado);
    expect(verificarAssinaturas(adulterado).valida).toBe(false);
  });

  it("detecta adulteração na NFS-e real", () => {
    const real = ler("nfse-real-homologacao.xml");
    const adulterado = real.replace("<xLocEmi>Porto Alegre</xLocEmi>", "<xLocEmi>Canoas</xLocEmi>");
    const r = verificarAssinaturas(adulterado);
    expect(r.valida).toBe(false);
    // A da DPS (emitente) continua válida; a da Receita (que cobre xLocEmi) não
    expect(r.assinaturas.map((a) => a.valida)).toEqual([true, false]);
  });

  it("documento sem assinatura não é válido", () => {
    expect(verificarAssinaturas(ler("nfce.xml"))).toEqual({ valida: false, assinaturas: [] });
  });
});
