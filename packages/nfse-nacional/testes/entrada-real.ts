/** Mesmos dados da NFS-e de teste emitida em 28/08/2026 em produção restrita. */
export const entradaReal = () => ({
  prestador: {
    documento: "10440532000101",
    telefone: "51985114242",
    email: "agilizepassaporte@gmail.com",
    regime: { opcaoSimples: 2 as const, regimeEspecial: 0 as const },
  },
  tomador: {
    documento: "45465512000161",
    nome: "VISTO PRATICO LTDA",
    email: "contato@vistopratico.com",
    endereco: {
      codigoMunicipio: "4205407",
      cep: "88015100",
      logradouro: "PREFEITO OSMAR CUNHA",
      numero: "416",
      complemento: "SALA 1108",
      bairro: "CENTRO",
    },
  },
  servico: {
    codigoMunicipioPrestacao: "4314902",
    codigoTributacaoNacional: "090201",
    codigoNbs: "118054000",
    descricao: "Representacao no Consulado Americano",
  },
  valores: { valorServico: 40, tributacaoIssqn: 1 as const, retencaoIss: 1 as const },
  dps: {
    ambiente: 2 as const,
    serie: "900",
    numero: 1,
    competencia: "2026-08-28",
    // 08:10:11 em Brasília; com a margem de 60 s vira 08:09:11, como na DPS aceita
    dataEmissao: new Date("2026-08-28T11:10:11Z"),
    versaoAplicativo: "meusistema-1.0.0",
  },
});
