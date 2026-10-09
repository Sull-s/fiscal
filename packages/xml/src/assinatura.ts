import { ErroFiscal } from "@fiscal/core";
import { DOMParser } from "@xmldom/xmldom";
import { SignedXml } from "xml-crypto";

/**
 * Perfis de assinatura XMLDSig usados nos documentos fiscais.
 *
 * - `sefaz`: NF-e, NFC-e, CT-e, MDF-e, eventos e inutilização. C14N 1.0 inclusiva, RSA-SHA1.
 * - `nfse-nacional`: DPS e eventos da NFS-e Nacional. C14N exclusiva com comentários, RSA-SHA256.
 *
 * Nos dois a <Signature> entra como ÚLTIMO filho do pai do elemento assinado. Na NFC-e isso
 * significa depois do <infNFeSupl> (QR Code), e não logo depois do <infNFe>.
 */
export const PERFIS_ASSINATURA = {
  sefaz: {
    canonicalizacao: "http://www.w3.org/TR/2001/REC-xml-c14n-20010315",
    assinatura: "http://www.w3.org/2000/09/xmldsig#rsa-sha1",
    resumo: "http://www.w3.org/2000/09/xmldsig#sha1",
  },
  "nfse-nacional": {
    canonicalizacao: "http://www.w3.org/2001/10/xml-exc-c14n#WithComments",
    assinatura: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256",
    resumo: "http://www.w3.org/2001/04/xmlenc#sha256",
  },
} as const;

export type PerfilAssinatura = keyof typeof PERFIS_ASSINATURA;

const ENVELOPED = "http://www.w3.org/2000/09/xmldsig#enveloped-signature";

/** O que a assinatura precisa do certificado (compatível com `CertificadoA1` de @fiscal/certificado). */
export interface MaterialAssinatura {
  chavePrivadaPem: string;
  certificadoBase64: string;
}

export interface OpcoesAssinatura {
  certificado: MaterialAssinatura;
  /** Nome local do elemento com o atributo Id a assinar: infNFe, infEvento, infInut, infDPS… */
  elemento: string;
  perfil: PerfilAssinatura;
}

function lerXml(xml: string) {
  const erros: string[] = [];
  let doc: ReturnType<DOMParser["parseFromString"]>;
  try {
    doc = new DOMParser({
      onError: (nivel, msg) => {
        if (nivel !== "warning") erros.push(msg);
      },
    }).parseFromString(xml, "text/xml");
  } catch (e) {
    // Erros fatais (tag sem fechar etc.) são lançados direto pelo parser
    erros.push(e instanceof Error ? e.message : String(e));
  }
  if (erros.length > 0) {
    throw new ErroFiscal("XML_MAL_FORMADO", `XML mal formado: ${erros[0]}`, { erros });
  }
  // biome-ignore lint/style/noNonNullAssertion: sem erros, o parser devolveu o documento
  return doc!;
}

export function assinarXml(xml: string, opcoes: OpcoesAssinatura): string {
  const { certificado, elemento, perfil } = opcoes;
  const algoritmos = PERFIS_ASSINATURA[perfil];

  const alvos = lerXml(xml).getElementsByTagNameNS("*", elemento);
  if (alvos.length !== 1) {
    throw new ErroFiscal(
      "XML_ELEMENTO_ASSINATURA",
      `Esperava exatamente um <${elemento}> para assinar, achei ${alvos.length}.`,
      { elemento, quantidade: alvos.length },
    );
  }
  if (!alvos[0]?.getAttribute("Id")) {
    throw new ErroFiscal("XML_ELEMENTO_ASSINATURA", `<${elemento}> não tem atributo Id.`);
  }

  const xpath = `//*[local-name(.)='${elemento}']`;
  const sig = new SignedXml({
    privateKey: certificado.chavePrivadaPem,
    signatureAlgorithm: algoritmos.assinatura,
    canonicalizationAlgorithm: algoritmos.canonicalizacao,
    getKeyInfoContent: () =>
      `<X509Data><X509Certificate>${certificado.certificadoBase64}</X509Certificate></X509Data>`,
  });
  sig.addReference({
    xpath,
    transforms: [ENVELOPED, algoritmos.canonicalizacao],
    digestAlgorithm: algoritmos.resumo,
  });
  sig.computeSignature(xml, {
    prefix: "",
    location: { reference: `${xpath}/..`, action: "append" },
  });
  const assinado = sig.getSignedXml();
  return perfil === "sefaz" ? expandirTagsVaziasDaAssinatura(assinado) : assinado;
}

/**
 * O xml-crypto escreve <CanonicalizationMethod …/>; o emissor que já roda em produção na SEFAZ
 * escreve <CanonicalizationMethod …></CanonicalizationMethod>. São equivalentes (a assinatura é
 * a mesma), mas mantemos o formato já aceito pela SEFAZ, byte a byte.
 */
function expandirTagsVaziasDaAssinatura(xml: string): string {
  return xml.replace(/<Signature xmlns="[^"]+">[\s\S]*?<\/Signature>/, (assinatura) =>
    assinatura.replace(/<([A-Za-z]+)((?:\s[^>]*?)?)\/>/g, "<$1$2></$1>"),
  );
}

export interface ResultadoAssinatura {
  /** URI da referência assinada, ex.: "#NFe4326…" */
  referencia: string;
  valida: boolean;
  erro?: string;
}

/**
 * Confere TODAS as assinaturas do documento (uma NFS-e autorizada tem a do emitente na DPS e a
 * da Receita na nota). Confere integridade criptográfica com o certificado do próprio KeyInfo;
 * não confere a cadeia ICP-Brasil.
 */
export function verificarAssinaturas(xml: string): {
  valida: boolean;
  assinaturas: ResultadoAssinatura[];
} {
  const doc = lerXml(xml);
  const nos = new SignedXml().findSignatures(doc as unknown as Node);
  if (nos.length === 0) {
    return { valida: false, assinaturas: [] };
  }

  const assinaturas = nos.map((no): ResultadoAssinatura => {
    const verificador = new SignedXml({ getCertFromKeyInfo: SignedXml.getCertFromKeyInfo });
    let referencia = "";
    try {
      verificador.loadSignature(no);
      referencia = verificador.getReferences()[0]?.uri ?? "";
      return { referencia, valida: verificador.checkSignature(xml) };
    } catch (e) {
      return { referencia, valida: false, erro: e instanceof Error ? e.message : String(e) };
    }
  });

  return { valida: assinaturas.every((a) => a.valida), assinaturas };
}
