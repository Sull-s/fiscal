// ARQUIVO GERADO por scripts/atualizar-catalogo-sefaz.mjs em 2026-10-09 — não edite à mão.
// Fonte: sped-nfe storage/wsnfe_4.00_mod65.xml (NfeConsultaQR) e uri_consulta_nfce.json
import type { Uf } from "@fiscal/core";

/** Por UF e ambiente (1 produção, 2 homologação): base do QR Code e texto da urlChave. */
export const URLS_CONSULTA_NFCE: Record<Uf, Record<1 | 2, { qrCode: string; urlChave: string }>> = {
  AC: {
    "1": {
      qrCode: "http://www.sefaznet.ac.gov.br/nfce/qrcode",
      urlChave: "www.sefaznet.ac.gov.br/nfce/consulta",
    },
    "2": {
      qrCode: "http://www.hml.sefaznet.ac.gov.br/nfce/qrcode",
      urlChave: "www.sefaznet.ac.gov.br/nfce/consulta",
    },
  },
  AL: {
    "1": {
      qrCode: "http://nfce.sefaz.al.gov.br/QRCode/consultarNFCe.jsp",
      urlChave: "www.sefaz.al.gov.br/nfce/consulta",
    },
    "2": {
      qrCode: "http://nfce.sefaz.al.gov.br/QRCode/consultarNFCe.jsp",
      urlChave: "www.sefaz.al.gov.br/nfce/consulta",
    },
  },
  AM: {
    "1": {
      qrCode: "https://sistemas.sefaz.am.gov.br/nfceweb/consultarNFCe.jsp",
      urlChave: "www.sefaz.am.gov.br/nfce/consulta",
    },
    "2": {
      qrCode: "https://sistemas.sefaz.am.gov.br/nfceweb-hom/consultarNFCe.jsp",
      urlChave: "www.sefaz.am.gov.br/nfce/consulta",
    },
  },
  AP: {
    "1": {
      qrCode: "https://www.sefaz.ap.gov.br/nfce/nfcep.php",
      urlChave: "www.sefaz.ap.gov.br/nfce/consulta",
    },
    "2": {
      qrCode: "https://www.sefaz.ap.gov.br/nfcehml/nfce.php",
      urlChave: "www.sefaz.ap.gov.br/nfce/consulta",
    },
  },
  BA: {
    "1": {
      qrCode: "http://nfe.sefaz.ba.gov.br/servicos/nfce/qrcode.aspx",
      urlChave: "http://www.sefaz.ba.gov.br/nfce/consulta",
    },
    "2": {
      qrCode: "http://hnfe.sefaz.ba.gov.br/servicos/nfce/qrcode.aspx",
      urlChave: "http://hinternet.sefaz.ba.gov.br/nfce/consulta",
    },
  },
  CE: {
    "1": {
      qrCode: "http://nfce.sefaz.ce.gov.br/pages/ShowNFCe.html",
      urlChave: "www.sefaz.ce.gov.br/nfce/consulta",
    },
    "2": {
      qrCode: "http://nfceh.sefaz.ce.gov.br/pages/ShowNFCe.html",
      urlChave: "www.sefaz.ce.gov.br/nfce/consulta",
    },
  },
  DF: {
    "1": {
      qrCode: "http://www.fazenda.df.gov.br/nfce/qrcode",
      urlChave: "www.fazenda.df.gov.br/nfce/consulta",
    },
    "2": {
      qrCode: "http://dec.fazenda.df.gov.br/ConsultarNFCe.aspx",
      urlChave: "www.fazenda.df.gov.br/nfce/consulta",
    },
  },
  ES: {
    "1": {
      qrCode: "http://app.sefaz.es.gov.br/ConsultaNFCe/qrcode.aspx",
      urlChave: "www.sefaz.es.gov.br/nfce/consulta",
    },
    "2": {
      qrCode: "http://homologacao.sefaz.es.gov.br/ConsultaNFCe/qrcode.aspx",
      urlChave: "www.sefaz.es.gov.br/nfce/consulta",
    },
  },
  GO: {
    "1": {
      qrCode: "https://nfeweb.sefaz.go.gov.br/nfeweb/sites/nfce/danfeNFCe",
      urlChave: "www.sefaz.go.gov.br/nfce/consulta",
    },
    "2": {
      qrCode: "https://nfewebhomolog.sefaz.go.gov.br/nfeweb/sites/nfce/danfeNFCe",
      urlChave: "www.nfce.go.gov.br/post/ver/214413/consulta-nfc-e-homologacao",
    },
  },
  MA: {
    "1": {
      qrCode: "http://www.nfce.sefaz.ma.gov.br/portal/consultarNFCe.jsp",
      urlChave: "www.sefaz.ma.gov.br/nfce/consulta",
    },
    "2": {
      qrCode: "http://www.hom.nfce.sefaz.ma.gov.br/portal/consultarNFCe.jsp",
      urlChave: "www.sefaz.ma.gov.br/nfce/consulta",
    },
  },
  MG: {
    "1": {
      qrCode: "https://portalsped.fazenda.mg.gov.br/portalnfce/sistema/qrcode.xhtml",
      urlChave: "https://portalsped.fazenda.mg.gov.br/portalnfce",
    },
    "2": {
      qrCode: "https://portalsped.fazenda.mg.gov.br/portalnfce/sistema/qrcode.xhtml",
      urlChave: "https://hportalsped.fazenda.mg.gov.br/portalnfce",
    },
  },
  MS: {
    "1": {
      qrCode: "http://www.dfe.ms.gov.br/nfce/qrcode",
      urlChave: "http://www.dfe.ms.gov.br/nfce/consulta",
    },
    "2": {
      qrCode: "http://www.dfe.ms.gov.br/nfce/qrcode",
      urlChave: "http://www.dfe.ms.gov.br/nfce/consulta",
    },
  },
  MT: {
    "1": {
      qrCode: "http://www.sefaz.mt.gov.br/nfce/consultanfce",
      urlChave: "http://www.sefaz.mt.gov.br/nfce/consultanfce",
    },
    "2": {
      qrCode: "http://homologacao.sefaz.mt.gov.br/nfce/consultanfce",
      urlChave: "http://homologacao.sefaz.mt.gov.br/nfce/consultanfce",
    },
  },
  PA: {
    "1": {
      qrCode: "https://appnfc.sefa.pa.gov.br/portal/view/consultas/nfce/nfceForm.seam",
      urlChave: "www.sefa.pa.gov.br/nfce/consulta",
    },
    "2": {
      qrCode: "https://appnfc.sefa.pa.gov.br/portal-homologacao/view/consultas/nfce/nfceForm.seam",
      urlChave: "www.sefa.pa.gov.br/nfce/consulta",
    },
  },
  PB: {
    "1": {
      qrCode: "http://www.sefaz.pb.gov.br/nfce",
      urlChave: "www.sefaz.pb.gov.br/nfce/consulta",
    },
    "2": {
      qrCode: "http://www.sefaz.pb.gov.br/nfcehom",
      urlChave: "www.sefaz.pb.gov.br/nfcehom",
    },
  },
  PE: {
    "1": {
      qrCode: "http://nfce.sefaz.pe.gov.br/nfce/consulta",
      urlChave: "nfce.sefaz.pe.gov.br/nfce/consulta",
    },
    "2": {
      qrCode: "http://nfcehomolog.sefaz.pe.gov.br/nfce/consulta",
      urlChave: "nfce.sefaz.pe.gov.br/nfce/consulta",
    },
  },
  PI: {
    "1": {
      qrCode: "http://www.sefaz.pi.gov.br/nfce/qrcode",
      urlChave: "www.sefaz.pi.gov.br/nfce/consulta",
    },
    "2": {
      qrCode: "http://www.sefaz.pi.gov.br/nfce/qrcode",
      urlChave: "www.sefaz.pi.gov.br/nfce/consulta",
    },
  },
  PR: {
    "1": {
      qrCode: "http://www.fazenda.pr.gov.br/nfce/qrcode",
      urlChave: "http://www.fazenda.pr.gov.br/nfce/consulta",
    },
    "2": {
      qrCode: "http://www.fazenda.pr.gov.br/nfce/qrcode",
      urlChave: "http://www.fazenda.pr.gov.br/nfce/consulta",
    },
  },
  RJ: {
    "1": {
      qrCode: "https://consultadfe.fazenda.rj.gov.br/consultaNFCe/QRCode",
      urlChave: "www.fazenda.rj.gov.br/nfce/consulta",
    },
    "2": {
      qrCode: "http://www4.fazenda.rj.gov.br/consultaNFCe/QRCode",
      urlChave: "www.fazenda.rj.gov.br/nfce/consulta",
    },
  },
  RN: {
    "1": {
      qrCode: "http://nfce.set.rn.gov.br/consultarNFCe.aspx",
      urlChave: "www.set.rn.gov.br/nfce/consulta",
    },
    "2": {
      qrCode: "http://hom.nfce.set.rn.gov.br/consultarNFCe.aspx",
      urlChave: "www.set.rn.gov.br/nfce/consulta",
    },
  },
  RO: {
    "1": {
      qrCode: "http://www.nfce.sefin.ro.gov.br/consultanfce/consulta.jsp",
      urlChave: "www.sefin.ro.gov.br/nfce/consulta",
    },
    "2": {
      qrCode: "http://www.nfce.sefin.ro.gov.br/consultanfce/consulta.jsp",
      urlChave: "www.sefin.ro.gov.br/nfce/consulta",
    },
  },
  RR: {
    "1": {
      qrCode: "https://www.sefaz.rr.gov.br/servlet/qrcode",
      urlChave: "www.sefaz.rr.gov.br/nfce/consulta",
    },
    "2": {
      qrCode: "http://200.174.88.103:8080/nfce/servlet/qrcode",
      urlChave: "www.sefaz.rr.gov.br/nfce/consulta",
    },
  },
  RS: {
    "1": {
      qrCode: "https://www.sefaz.rs.gov.br/NFCE/NFCE-COM.aspx",
      urlChave: "www.sefaz.rs.gov.br/nfce/consulta",
    },
    "2": {
      qrCode: "https://www.sefaz.rs.gov.br/NFCE/NFCE-COM.aspx",
      urlChave: "www.sefaz.rs.gov.br/nfce/consulta",
    },
  },
  SC: {
    "1": {
      qrCode: "https://sat.sef.sc.gov.br/nfce/consulta",
      urlChave: "https://sat.sef.sc.gov.br/nfce/consulta",
    },
    "2": {
      qrCode: "https://hom.sat.sef.sc.gov.br/nfce/consulta",
      urlChave: "https://hom.sat.sef.sc.gov.br/nfce/consulta",
    },
  },
  SE: {
    "1": {
      qrCode: "http://www.nfce.se.gov.br/nfce/qrcode",
      urlChave: "http://www.nfce.se.gov.br/nfce/consulta",
    },
    "2": {
      qrCode: "http://www.hom.nfe.se.gov.br/nfce/qrcode",
      urlChave: "http://www.hom.nfe.se.gov.br/nfce/consulta",
    },
  },
  SP: {
    "1": {
      qrCode: "https://www.nfce.fazenda.sp.gov.br/qrcode",
      urlChave: "https://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica",
    },
    "2": {
      qrCode: "https://www.homologacao.nfce.fazenda.sp.gov.br/qrcode",
      urlChave: "https://www.homologacao.nfce.fazenda.sp.gov.br/NFCeConsultaPublica",
    },
  },
  TO: {
    "1": {
      qrCode: "http://www.sefaz.to.gov.br/nfce/qrcode",
      urlChave: "www.sefaz.to.gov.br/nfce/consulta",
    },
    "2": {
      qrCode: "http://homologacao.sefaz.to.gov.br/nfce/qrcode",
      urlChave: "http://homologacao.sefaz.to.gov.br/nfce/consulta.jsf",
    },
  },
};
