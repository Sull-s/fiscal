// ARQUIVO GERADO por scripts/atualizar-catalogo-sefaz.mjs em 2026-10-09 — não edite à mão.
// Fonte: sped-nfe storage/wsnfe_4.00_mod55.xml, wsnfe_4.00_mod65.xml e autorizadores.json
import type { CatalogoWebservices } from "./webservices";

export const CATALOGO_OFICIAL: CatalogoWebservices = {
  autorizadorDaUf: {
    "55": {
      AC: "SVRS",
      AL: "SVRS",
      AM: "AM",
      AP: "SVRS",
      BA: "BA",
      CE: "SVRS",
      DF: "SVRS",
      ES: "SVRS",
      GO: "GO",
      MA: "SVAN",
      MG: "MG",
      MS: "MS",
      MT: "MT",
      PA: "SVRS",
      PB: "SVRS",
      PE: "PE",
      PI: "SVRS",
      PR: "PR",
      RJ: "SVRS",
      RN: "SVRS",
      RO: "SVRS",
      RR: "SVRS",
      RS: "RS",
      SC: "SVRS",
      SE: "SVRS",
      SP: "SP",
      TO: "SVRS",
    },
    "65": {
      AC: "SVRS",
      AL: "SVRS",
      AM: "AM",
      AP: "SVRS",
      BA: "SVRS",
      CE: "SVRS",
      DF: "SVRS",
      ES: "SVRS",
      GO: "GO",
      MA: "SVRS",
      MG: "MG",
      MS: "MS",
      MT: "MT",
      PA: "SVRS",
      PB: "SVRS",
      PE: "SVRS",
      PI: "SVRS",
      PR: "PR",
      RJ: "SVRS",
      RN: "SVRS",
      RO: "SVRS",
      RR: "SVRS",
      RS: "RS",
      SC: "SVRS",
      SE: "SVRS",
      SP: "SP",
      TO: "SVRS",
    },
  },
  enderecos: {
    "55": {
      AM: {
        "1": {
          status: "https://nfe.sefaz.am.gov.br/services2/services/NfeStatusServico4",
          autorizacao: "https://nfe.sefaz.am.gov.br/services2/services/NfeAutorizacao4",
          consulta: "https://nfe.sefaz.am.gov.br/services2/services/NfeConsulta4",
          inutilizacao: "https://nfe.sefaz.am.gov.br/services2/services/NfeInutilizacao4",
          retAutorizacao: "https://nfe.sefaz.am.gov.br/services2/services/NfeRetAutorizacao4",
          evento: "https://nfe.sefaz.am.gov.br/services2/services/RecepcaoEvento4",
        },
        "2": {
          status: "https://homnfe.sefaz.am.gov.br/services2/services/NfeStatusServico4",
          autorizacao: "https://homnfe.sefaz.am.gov.br/services2/services/NfeAutorizacao4",
          consulta: "https://homnfe.sefaz.am.gov.br/services2/services/NfeConsulta4",
          inutilizacao: "https://homnfe.sefaz.am.gov.br/services2/services/NfeInutilizacao4",
          retAutorizacao: "https://homnfe.sefaz.am.gov.br/services2/services/NfeRetAutorizacao4",
          evento: "https://homnfe.sefaz.am.gov.br/services2/services/RecepcaoEvento4",
        },
      },
      AN: {
        "1": {
          evento: "https://www.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx",
        },
        "2": {
          evento: "https://hom1.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx",
        },
      },
      BA: {
        "1": {
          status:
            "https://nfe.sefaz.ba.gov.br/webservices/NFeStatusServico4/NFeStatusServico4.asmx",
          autorizacao:
            "https://nfe.sefaz.ba.gov.br/webservices/NFeAutorizacao4/NFeAutorizacao4.asmx",
          consulta:
            "https://nfe.sefaz.ba.gov.br/webservices/NFeConsultaProtocolo4/NFeConsultaProtocolo4.asmx",
          inutilizacao:
            "https://nfe.sefaz.ba.gov.br/webservices/NFeInutilizacao4/NFeInutilizacao4.asmx",
          retAutorizacao:
            "https://nfe.sefaz.ba.gov.br/webservices/NFeRetAutorizacao4/NFeRetAutorizacao4.asmx",
          evento:
            "https://nfe.sefaz.ba.gov.br/webservices/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx",
        },
        "2": {
          status:
            "https://hnfe.sefaz.ba.gov.br/webservices/NFeStatusServico4/NFeStatusServico4.asmx",
          autorizacao:
            "https://hnfe.sefaz.ba.gov.br/webservices/NFeAutorizacao4/NFeAutorizacao4.asmx",
          consulta:
            "https://hnfe.sefaz.ba.gov.br/webservices/NFeConsultaProtocolo4/NFeConsultaProtocolo4.asmx",
          inutilizacao:
            "https://hnfe.sefaz.ba.gov.br/webservices/NFeInutilizacao4/NFeInutilizacao4.asmx",
          retAutorizacao:
            "https://hnfe.sefaz.ba.gov.br/webservices/NFeRetAutorizacao4/NFeRetAutorizacao4.asmx",
          evento:
            "https://hnfe.sefaz.ba.gov.br/webservices/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx",
        },
      },
      GO: {
        "1": {
          status: "https://nfe.sefaz.go.gov.br/nfe/services/NFeStatusServico4",
          autorizacao: "https://nfe.sefaz.go.gov.br/nfe/services/NFeAutorizacao4",
          consulta: "https://nfe.sefaz.go.gov.br/nfe/services/NFeConsultaProtocolo4",
          inutilizacao: "https://nfe.sefaz.go.gov.br/nfe/services/NFeInutilizacao4",
          retAutorizacao: "https://nfe.sefaz.go.gov.br/nfe/services/NFeRetAutorizacao4",
          evento: "https://nfe.sefaz.go.gov.br/nfe/services/NFeRecepcaoEvento4",
        },
        "2": {
          status: "https://homolog.sefaz.go.gov.br/nfe/services/NFeStatusServico4",
          autorizacao: "https://homolog.sefaz.go.gov.br/nfe/services/NFeAutorizacao4",
          consulta: "https://homolog.sefaz.go.gov.br/nfe/services/NFeConsultaProtocolo4",
          inutilizacao: "https://homolog.sefaz.go.gov.br/nfe/services/NFeInutilizacao4",
          retAutorizacao: "https://homolog.sefaz.go.gov.br/nfe/services/NFeRetAutorizacao4",
          evento: "https://homolog.sefaz.go.gov.br/nfe/services/NFeRecepcaoEvento4",
        },
      },
      MG: {
        "1": {
          status: "https://nfe.fazenda.mg.gov.br/nfe2/services/NFeStatusServico4",
          autorizacao: "https://nfe.fazenda.mg.gov.br/nfe2/services/NFeAutorizacao4",
          consulta: "https://nfe.fazenda.mg.gov.br/nfe2/services/NFeConsultaProtocolo4",
          inutilizacao: "https://nfe.fazenda.mg.gov.br/nfe2/services/NFeInutilizacao4",
          retAutorizacao: "https://nfe.fazenda.mg.gov.br/nfe2/services/NFeRetAutorizacao4",
          evento: "https://nfe.fazenda.mg.gov.br/nfe2/services/NFeRecepcaoEvento4",
        },
        "2": {
          status: "https://hnfe.fazenda.mg.gov.br/nfe2/services/NFeStatusServico4",
          autorizacao: "https://hnfe.fazenda.mg.gov.br/nfe2/services/NFeAutorizacao4",
          consulta: "https://hnfe.fazenda.mg.gov.br/nfe2/services/NFeConsultaProtocolo4",
          inutilizacao: "https://hnfe.fazenda.mg.gov.br/nfe2/services/NFeInutilizacao4",
          retAutorizacao: "https://hnfe.fazenda.mg.gov.br/nfe2/services/NFeRetAutorizacao4",
          evento: "https://hnfe.fazenda.mg.gov.br/nfe2/services/NFeRecepcaoEvento4",
        },
      },
      MS: {
        "1": {
          status: "https://nfe.sefaz.ms.gov.br/ws/NFeStatusServico4",
          autorizacao: "https://nfe.sefaz.ms.gov.br/ws/NFeAutorizacao4",
          consulta: "https://nfe.sefaz.ms.gov.br/ws/NFeConsultaProtocolo4",
          inutilizacao: "https://nfe.sefaz.ms.gov.br/ws/NFeInutilizacao4",
          retAutorizacao: "https://nfe.sefaz.ms.gov.br/ws/NFeRetAutorizacao4",
          evento: "https://nfe.sefaz.ms.gov.br/ws/NFeRecepcaoEvento4",
        },
        "2": {
          status: "https://hom.nfe.sefaz.ms.gov.br/ws/NFeStatusServico4",
          autorizacao: "https://hom.nfe.sefaz.ms.gov.br/ws/NFeAutorizacao4",
          consulta: "https://hom.nfe.sefaz.ms.gov.br/ws/NFeConsultaProtocolo4",
          inutilizacao: "https://hom.nfe.sefaz.ms.gov.br/ws/NFeInutilizacao4",
          retAutorizacao: "https://hom.nfe.sefaz.ms.gov.br/ws/NFeRetAutorizacao4",
          evento: "https://hom.nfe.sefaz.ms.gov.br/ws/NFeRecepcaoEvento4",
        },
      },
      MT: {
        "1": {
          status: "https://nfe.sefaz.mt.gov.br/nfews/v2/services/NfeStatusServico4",
          autorizacao: "https://nfe.sefaz.mt.gov.br/nfews/v2/services/NfeAutorizacao4",
          consulta: "https://nfe.sefaz.mt.gov.br/nfews/v2/services/NfeConsulta4",
          inutilizacao: "https://nfe.sefaz.mt.gov.br/nfews/v2/services/NfeInutilizacao4",
          retAutorizacao: "https://nfe.sefaz.mt.gov.br/nfews/v2/services/NfeRetAutorizacao4",
          evento: "https://nfe.sefaz.mt.gov.br/nfews/v2/services/RecepcaoEvento4",
        },
        "2": {
          status: "https://homologacao.sefaz.mt.gov.br/nfews/v2/services/NfeStatusServico4",
          autorizacao: "https://homologacao.sefaz.mt.gov.br/nfews/v2/services/NfeAutorizacao4",
          consulta: "https://homologacao.sefaz.mt.gov.br/nfews/v2/services/NfeConsulta4",
          inutilizacao: "https://homologacao.sefaz.mt.gov.br/nfews/v2/services/NfeInutilizacao4",
          retAutorizacao:
            "https://homologacao.sefaz.mt.gov.br/nfews/v2/services/NfeRetAutorizacao4",
          evento: "https://homologacao.sefaz.mt.gov.br/nfews/v2/services/RecepcaoEvento4",
        },
      },
      PE: {
        "1": {
          status: "https://nfe.sefaz.pe.gov.br/nfe-service/services/NFeStatusServico4",
          autorizacao: "https://nfe.sefaz.pe.gov.br/nfe-service/services/NFeAutorizacao4",
          consulta: "https://nfe.sefaz.pe.gov.br/nfe-service/services/NFeConsultaProtocolo4",
          inutilizacao: "https://nfe.sefaz.pe.gov.br/nfe-service/services/NFeInutilizacao4",
          retAutorizacao: "https://nfe.sefaz.pe.gov.br/nfe-service/services/NFeRetAutorizacao4",
          evento: "https://nfe.sefaz.pe.gov.br/nfe-service/services/NFeRecepcaoEvento4",
        },
        "2": {
          status: "https://nfehomolog.sefaz.pe.gov.br/nfe-service/services/NFeStatusServico4",
          autorizacao: "https://nfehomolog.sefaz.pe.gov.br/nfe-service/services/NFeAutorizacao4",
          consulta: "https://nfehomolog.sefaz.pe.gov.br/nfe-service/services/NFeConsultaProtocolo4",
          inutilizacao: "https://nfehomolog.sefaz.pe.gov.br/nfe-service/services/NFeInutilizacao4",
          retAutorizacao:
            "https://nfehomolog.sefaz.pe.gov.br/nfe-service/services/NFeRetAutorizacao4",
          evento: "https://nfehomolog.sefaz.pe.gov.br/nfe-service/services/NFeRecepcaoEvento4",
        },
      },
      PR: {
        "1": {
          status: "https://nfe.sefa.pr.gov.br/nfe/NFeStatusServico4",
          autorizacao: "https://nfe.sefa.pr.gov.br/nfe/NFeAutorizacao4",
          consulta: "https://nfe.sefa.pr.gov.br/nfe/NFeConsultaProtocolo4",
          inutilizacao: "https://nfe.sefa.pr.gov.br/nfe/NFeInutilizacao4",
          retAutorizacao: {
            url: "https://nfe.sefa.pr.gov.br/nfe/NFeRetAutorizacao4",
            wsdl: "NFeRetAutorizacao4",
            metodo: "nfeRetAutorizacao",
          },
          evento: "https://nfe.sefa.pr.gov.br/nfe/NFeRecepcaoEvento4",
        },
        "2": {
          status: "https://homologacao.nfe.sefa.pr.gov.br/nfe/NFeStatusServico4",
          autorizacao: "https://homologacao.nfe.sefa.pr.gov.br/nfe/NFeAutorizacao4",
          consulta: "https://homologacao.nfe.sefa.pr.gov.br/nfe/NFeConsultaProtocolo4",
          inutilizacao: "https://homologacao.nfe.sefa.pr.gov.br/nfe/NFeInutilizacao4",
          retAutorizacao: {
            url: "https://homologacao.nfe.sefa.pr.gov.br/nfe/NFeRetAutorizacao4",
            wsdl: "NFeRetAutorizacao4",
            metodo: "nfeRetAutorizacao",
          },
          evento: "https://homologacao.nfe.sefa.pr.gov.br/nfe/NFeRecepcaoEvento4",
        },
      },
      RS: {
        "1": {
          status: "https://nfe.sefazrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx",
          autorizacao: "https://nfe.sefazrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx",
          consulta: "https://nfe.sefazrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx",
          inutilizacao: "https://nfe.sefazrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx",
          retAutorizacao:
            "https://nfe.sefazrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx",
          evento: "https://nfe.sefazrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx",
        },
        "2": {
          status:
            "https://nfe-homologacao.sefazrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx",
          autorizacao:
            "https://nfe-homologacao.sefazrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx",
          consulta: "https://nfe-homologacao.sefazrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx",
          inutilizacao:
            "https://nfe-homologacao.sefazrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx",
          retAutorizacao:
            "https://nfe-homologacao.sefazrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx",
          evento:
            "https://nfe-homologacao.sefazrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx",
        },
      },
      SP: {
        "1": {
          status: "https://nfe.fazenda.sp.gov.br/ws/nfestatusservico4.asmx",
          autorizacao: "https://nfe.fazenda.sp.gov.br/ws/nfeautorizacao4.asmx",
          consulta: "https://nfe.fazenda.sp.gov.br/ws/nfeconsultaprotocolo4.asmx",
          inutilizacao: "https://nfe.fazenda.sp.gov.br/ws/nfeinutilizacao4.asmx",
          retAutorizacao: "https://nfe.fazenda.sp.gov.br/ws/nferetautorizacao4.asmx",
          evento: "https://nfe.fazenda.sp.gov.br/ws/nferecepcaoevento4.asmx",
        },
        "2": {
          status: "https://homologacao.nfe.fazenda.sp.gov.br/ws/nfestatusservico4.asmx",
          autorizacao: "https://homologacao.nfe.fazenda.sp.gov.br/ws/nfeautorizacao4.asmx",
          consulta: "https://homologacao.nfe.fazenda.sp.gov.br/ws/nfeconsultaprotocolo4.asmx",
          inutilizacao: "https://homologacao.nfe.fazenda.sp.gov.br/ws/nfeinutilizacao4.asmx",
          retAutorizacao: "https://homologacao.nfe.fazenda.sp.gov.br/ws/nferetautorizacao4.asmx",
          evento: "https://homologacao.nfe.fazenda.sp.gov.br/ws/nferecepcaoevento4.asmx",
        },
      },
      SVAN: {
        "1": {
          status:
            "https://www.sefazvirtual.fazenda.gov.br/NFeStatusServico4/NFeStatusServico4.asmx",
          autorizacao:
            "https://www.sefazvirtual.fazenda.gov.br/NFeAutorizacao4/NFeAutorizacao4.asmx",
          consulta:
            "https://www.sefazvirtual.fazenda.gov.br/NFeConsultaProtocolo4/NFeConsultaProtocolo4.asmx",
          inutilizacao:
            "https://www.sefazvirtual.fazenda.gov.br/NFeInutilizacao4/NFeInutilizacao4.asmx",
          retAutorizacao:
            "https://www.sefazvirtual.fazenda.gov.br/NFeRetAutorizacao4/NFeRetAutorizacao4.asmx",
          evento:
            "https://www.sefazvirtual.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx",
        },
        "2": {
          status:
            "https://hom.sefazvirtual.fazenda.gov.br/NFeStatusServico4/NFeStatusServico4.asmx",
          autorizacao:
            "https://hom.sefazvirtual.fazenda.gov.br/NFeAutorizacao4/NFeAutorizacao4.asmx",
          consulta:
            "https://hom.sefazvirtual.fazenda.gov.br/NFeConsultaProtocolo4/NFeConsultaProtocolo4.asmx",
          inutilizacao:
            "https://hom.sefazvirtual.fazenda.gov.br/NFeInutilizacao4/NFeInutilizacao4.asmx",
          retAutorizacao:
            "https://hom.sefazvirtual.fazenda.gov.br/NFeRetAutorizacao4/NFeRetAutorizacao4.asmx",
          evento:
            "https://hom.sefazvirtual.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx",
        },
      },
      SVRS: {
        "1": {
          status: "https://nfe.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx",
          autorizacao: "https://nfe.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx",
          consulta: "https://nfe.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx",
          inutilizacao: "https://nfe.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx",
          retAutorizacao: "https://nfe.svrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx",
          evento: "https://nfe.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx",
        },
        "2": {
          status:
            "https://nfe-homologacao.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx",
          autorizacao:
            "https://nfe-homologacao.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx",
          consulta: "https://nfe-homologacao.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx",
          inutilizacao:
            "https://nfe-homologacao.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx",
          retAutorizacao:
            "https://nfe-homologacao.svrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx",
          evento: "https://nfe-homologacao.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx",
        },
      },
      "SVC-AN": {
        "1": {
          status:
            "https://www.sefazvirtual.fazenda.gov.br/NFeStatusServico4/NFeStatusServico4.asmx",
          autorizacao:
            "https://www.sefazvirtual.fazenda.gov.br/NFeAutorizacao4/NFeAutorizacao4.asmx",
          consulta:
            "https://www.sefazvirtual.fazenda.gov.br/NFeConsultaProtocolo4/NFeConsultaProtocolo4.asmx",
          inutilizacao:
            "https://www.sefazvirtual.fazenda.gov.br/NFeInutilizacao4/NFeInutilizacao4.asmx",
          retAutorizacao:
            "https://www.sefazvirtual.fazenda.gov.br/NFeRetAutorizacao4/NFeRetAutorizacao4.asmx",
          evento:
            "https://www.sefazvirtual.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx",
        },
        "2": {
          status:
            "https://hom.sefazvirtual.fazenda.gov.br/NFeStatusServico4/NFeStatusServico4.asmx",
          autorizacao:
            "https://hom.sefazvirtual.fazenda.gov.br/NFeAutorizacao4/NFeAutorizacao4.asmx",
          consulta:
            "https://hom.sefazvirtual.fazenda.gov.br/NFeConsultaProtocolo4/NFeConsultaProtocolo4.asmx",
          inutilizacao:
            "https://hom.sefazvirtual.fazenda.gov.br/NFeInutilizacao4/NFeInutilizacao4.asmx",
          retAutorizacao:
            "https://hom.sefazvirtual.fazenda.gov.br/NFeRetAutorizacao4/NFeRetAutorizacao4.asmx",
          evento:
            "https://hom.sefazvirtual.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx",
        },
      },
      "SVC-RS": {
        "1": {
          status: "https://nfe.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx",
          autorizacao: "https://nfe.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx",
          consulta: "https://nfe.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx",
          inutilizacao: "https://nfe.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx",
          retAutorizacao: "https://nfe.svrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx",
          evento: "https://nfe.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx",
        },
        "2": {
          status:
            "https://nfe-homologacao.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx",
          autorizacao:
            "https://nfe-homologacao.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx",
          consulta: "https://nfe-homologacao.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx",
          inutilizacao:
            "https://nfe-homologacao.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx",
          retAutorizacao:
            "https://nfe-homologacao.svrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx",
          evento: "https://nfe-homologacao.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx",
        },
      },
    },
    "65": {
      AM: {
        "1": {
          autorizacao: "https://nfce.sefaz.am.gov.br/nfce-services/services/NfeAutorizacao4",
          retAutorizacao: "https://nfce.sefaz.am.gov.br/nfce-services/services/NfeRetAutorizacao4",
          inutilizacao: "https://nfce.sefaz.am.gov.br/nfce-services/services/NfeInutilizacao4",
          consulta: "https://nfce.sefaz.am.gov.br/nfce-services/services/NfeConsulta4",
          status: "https://nfce.sefaz.am.gov.br/nfce-services/services/NfeStatusServico4",
          evento: "https://nfce.sefaz.am.gov.br/nfce-services/services/RecepcaoEvento4",
        },
        "2": {
          autorizacao: "https://homnfce.sefaz.am.gov.br/nfce-services/services/NfeAutorizacao4",
          retAutorizacao:
            "https://homnfce.sefaz.am.gov.br/nfce-services/services/NfeRetAutorizacao4",
          inutilizacao: "https://homnfce.sefaz.am.gov.br/nfce-services/services/NfeInutilizacao4",
          consulta: "https://homnfce.sefaz.am.gov.br/nfce-services/services/NfeConsulta4",
          status: "https://homnfce.sefaz.am.gov.br/nfce-services/services/NfeStatusServico4",
          evento: "https://homnfce.sefaz.am.gov.br/nfce-services/services/RecepcaoEvento4",
        },
      },
      GO: {
        "1": {
          autorizacao: "https://nfe.sefaz.go.gov.br/nfe/services/NFeAutorizacao4",
          retAutorizacao: "https://nfe.sefaz.go.gov.br/nfe/services/NFeRetAutorizacao4",
          inutilizacao: "https://nfe.sefaz.go.gov.br/nfe/services/NFeInutilizacao4",
          consulta: "https://nfe.sefaz.go.gov.br/nfe/services/NFeConsultaProtocolo4",
          status: "https://nfe.sefaz.go.gov.br/nfe/services/NFeStatusServico4",
          evento: {
            url: "https://nfe.sefaz.go.gov.br/nfe/services/NFeRecepcaoEvento4",
            wsdl: "NFeRecepcaoEvento",
            metodo: "nfeRecepcaoEvento",
          },
        },
        "2": {
          autorizacao: "https://homolog.sefaz.go.gov.br/nfe/services/NFeAutorizacao4",
          retAutorizacao: "https://homolog.sefaz.go.gov.br/nfe/services/NFeRetAutorizacao4",
          inutilizacao: "https://homolog.sefaz.go.gov.br/nfe/services/NFeInutilizacao4",
          consulta: "https://homolog.sefaz.go.gov.br/nfe/services/NFeConsultaProtocolo4",
          status: "https://homolog.sefaz.go.gov.br/nfe/services/NFeStatusServico4",
          evento: {
            url: "https://homolog.sefaz.go.gov.br/nfe/services/NFeRecepcaoEvento4",
            wsdl: "NFeRecepcaoEvento",
            metodo: "nfeRecepcaoEvento",
          },
        },
      },
      MG: {
        "1": {
          autorizacao: "https://nfce.fazenda.mg.gov.br/nfce/services/NFeAutorizacao4",
          retAutorizacao: "https://nfce.fazenda.mg.gov.br/nfce/services/NFeRetAutorizacao4",
          inutilizacao: "https://nfce.fazenda.mg.gov.br/nfce/services/NFeInutilizacao4",
          consulta: "https://nfce.fazenda.mg.gov.br/nfce/services/NFeConsultaProtocolo4",
          status: "https://nfce.fazenda.mg.gov.br/nfce/services/NFeStatusServico4",
          evento: "https://nfce.fazenda.mg.gov.br/nfce/services/NFeRecepcaoEvento4",
        },
        "2": {
          autorizacao: "https://hnfce.fazenda.mg.gov.br/nfce/services/NFeAutorizacao4",
          retAutorizacao: "https://hnfce.fazenda.mg.gov.br/nfce/services/NFeRetAutorizacao4",
          inutilizacao: "https://hnfce.fazenda.mg.gov.br/nfce/services/NFeInutilizacao4",
          consulta: "https://hnfce.fazenda.mg.gov.br/nfce/services/NFeConsultaProtocolo4",
          status: "https://hnfce.fazenda.mg.gov.br/nfce/services/NFeStatusServico4",
          evento: "https://hnfce.fazenda.mg.gov.br/nfce/services/NFeRecepcaoEvento4",
        },
      },
      MT: {
        "1": {
          autorizacao: "https://nfce.sefaz.mt.gov.br/nfcews/services/NfeAutorizacao4",
          retAutorizacao: "https://nfce.sefaz.mt.gov.br/nfcews/services/NfeRetAutorizacao4",
          inutilizacao: "https://nfce.sefaz.mt.gov.br/nfcews/services/NfeInutilizacao4",
          consulta: "https://nfce.sefaz.mt.gov.br/nfcews/services/NfeConsulta4",
          status: "https://nfce.sefaz.mt.gov.br/nfcews/services/NfeStatusServico4",
          evento: "https://nfce.sefaz.mt.gov.br/nfcews/services/RecepcaoEvento4",
        },
        "2": {
          autorizacao: "https://homologacao.sefaz.mt.gov.br/nfcews/services/NfeAutorizacao4",
          retAutorizacao: "https://homologacao.sefaz.mt.gov.br/nfcews/services/NfeRetAutorizacao4",
          inutilizacao: "https://homologacao.sefaz.mt.gov.br/nfcews/services/NfeInutilizacao4",
          consulta: "https://homologacao.sefaz.mt.gov.br/nfcews/services/NfeConsulta4",
          status: "https://homologacao.sefaz.mt.gov.br/nfcews/services/NfeStatusServico4",
          evento: "https://homologacao.sefaz.mt.gov.br/nfcews/services/RecepcaoEvento4",
        },
      },
      MS: {
        "1": {
          autorizacao: "https://nfce.sefaz.ms.gov.br/ws/NFeAutorizacao4",
          retAutorizacao: "https://nfce.sefaz.ms.gov.br/ws/NFeRetAutorizacao4",
          inutilizacao: "https://nfce.sefaz.ms.gov.br/ws/NFeInutilizacao4",
          consulta: "https://nfce.sefaz.ms.gov.br/ws/NFeConsultaProtocolo4",
          status: "https://nfce.sefaz.ms.gov.br/ws/NFeStatusServico4",
          evento: "https://nfce.sefaz.ms.gov.br/ws/NFeRecepcaoEvento4",
        },
        "2": {
          autorizacao: "https://hom.nfce.sefaz.ms.gov.br/ws/NFeAutorizacao4",
          retAutorizacao: "https://hom.nfce.sefaz.ms.gov.br/ws/NFeRetAutorizacao4",
          inutilizacao: "https://hom.nfce.sefaz.ms.gov.br/ws/NFeInutilizacao4",
          consulta: "https://hom.nfce.sefaz.ms.gov.br/ws/NFeConsultaProtocolo4",
          status: "https://hom.nfce.sefaz.ms.gov.br/ws/NFeStatusServico4",
          evento: "https://hom.nfce.sefaz.ms.gov.br/ws/NFeRecepcaoEvento4",
        },
      },
      PR: {
        "1": {
          autorizacao: "https://nfce.sefa.pr.gov.br/nfce/NFeAutorizacao4",
          retAutorizacao: {
            url: "https://nfce.sefa.pr.gov.br/nfce/NFeRetAutorizacao4",
            wsdl: "NFeRetAutorizacao4",
            metodo: "nfeRetAutorizacao",
          },
          inutilizacao: "https://nfce.sefa.pr.gov.br/nfce/NFeInutilizacao4",
          consulta: "https://nfce.sefa.pr.gov.br/nfce/NFeConsultaProtocolo4",
          status: "https://nfce.sefa.pr.gov.br/nfce/NFeStatusServico4",
          evento: {
            url: "https://nfce.sefa.pr.gov.br/nfce/NFeRecepcaoEvento4",
            wsdl: "NFeRecepcaoEvento",
            metodo: "nfeRecepcaoEvento",
          },
        },
        "2": {
          autorizacao: "https://homologacao.nfce.sefa.pr.gov.br/nfce/NFeAutorizacao4",
          retAutorizacao: "https://homologacao.nfce.sefa.pr.gov.br/nfce/NFeRetAutorizacao4",
          inutilizacao: "https://homologacao.nfce.sefa.pr.gov.br/nfce/NFeInutilizacao4",
          consulta: "https://homologacao.nfce.sefa.pr.gov.br/nfce/NFeConsultaProtocolo4",
          status: "https://homologacao.nfce.sefa.pr.gov.br/nfce/NFeStatusServico4",
          evento: {
            url: "https://homologacao.nfce.sefa.pr.gov.br/nfce/NFeRecepcaoEvento4",
            wsdl: "NFeRecepcaoEvento",
            metodo: "nfeRecepcaoEvento",
          },
        },
      },
      RS: {
        "1": {
          autorizacao: "https://nfce.sefazrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx",
          retAutorizacao:
            "https://nfce.sefazrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx",
          inutilizacao: "https://nfce.sefazrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx",
          consulta: "https://nfce.sefazrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx",
          status: "https://nfce.sefazrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx",
          evento: "https://nfce.sefazrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx",
        },
        "2": {
          autorizacao:
            "https://nfce-homologacao.sefazrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx",
          retAutorizacao:
            "https://nfce-homologacao.sefazrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx",
          inutilizacao:
            "https://nfce-homologacao.sefazrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx",
          consulta: "https://nfce-homologacao.sefazrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx",
          status:
            "https://nfce-homologacao.sefazrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx",
          evento:
            "https://nfce-homologacao.sefazrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx",
        },
      },
      SP: {
        "1": {
          autorizacao: "https://nfce.fazenda.sp.gov.br/ws/NFeAutorizacao4.asmx",
          retAutorizacao: "https://nfce.fazenda.sp.gov.br/ws/NFeRetAutorizacao4.asmx",
          inutilizacao: "https://nfce.fazenda.sp.gov.br/ws/NFeInutilizacao4.asmx",
          consulta: "https://nfce.fazenda.sp.gov.br/ws/NFeConsultaProtocolo4.asmx",
          status: "https://nfce.fazenda.sp.gov.br/ws/NFeStatusServico4.asmx",
          evento: "https://nfce.fazenda.sp.gov.br/ws/NFeRecepcaoEvento4.asmx",
        },
        "2": {
          autorizacao: "https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeAutorizacao4.asmx",
          retAutorizacao: "https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeRetAutorizacao4.asmx",
          inutilizacao: "https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeInutilizacao4.asmx",
          consulta: "https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeConsultaProtocolo4.asmx",
          status: "https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeStatusServico4.asmx",
          evento: "https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeRecepcaoEvento4.asmx",
        },
      },
      SVRS: {
        "1": {
          autorizacao: "https://nfce.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx",
          retAutorizacao:
            "https://nfce.svrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx",
          inutilizacao: "https://nfce.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx",
          consulta: "https://nfce.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx",
          status: "https://nfce.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx",
          evento: "https://nfce.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx",
        },
        "2": {
          autorizacao:
            "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx",
          retAutorizacao:
            "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx",
          inutilizacao:
            "https://nfce-homologacao.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx",
          consulta: "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx",
          status:
            "https://nfce-homologacao.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx",
          evento: "https://nfce-homologacao.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx",
        },
      },
    },
  },
};
