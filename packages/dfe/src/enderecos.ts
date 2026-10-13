/** Webservices do Ambiente Nacional (Receita Federal), iguais para todas as UFs. */
export const AMBIENTE_NACIONAL = {
  1: {
    distribuicao: "https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx",
    evento: "https://www.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx",
  },
  2: {
    distribuicao: "https://hom1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx",
    evento: "https://hom1.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx",
  },
} as const;

export const NS_WSDL_DISTRIBUICAO = "http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe";
