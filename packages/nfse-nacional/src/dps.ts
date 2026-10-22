import {
  ErroFiscal,
  formatarDataHoraSefaz,
  limparCnpj,
  validarCnpj,
  validarCpf,
} from "@fiscal/core";
import { escaparTexto, formatarDecimal, somenteDigitos, tag } from "@fiscal/xml";
import type { DadosDps, DpsMontada, Prestador, Servico, Tomador, Valores } from "./tipos";

export const NS_NFSE = "http://www.sped.fazenda.gov.br/nfse";

const pad = (v: string | number | undefined, n: number) => somenteDigitos(v).padStart(n, "0");
const dec = (v: number, casas = 2) => formatarDecimal(v, casas);

/**
 * Texto livre da NFS-e: diferente da SEFAZ, o leiaute aceita quebras de linha e UTF-8.
 * Só remove caracteres de controle e espaços nas pontas, e corta no tamanho máximo.
 */
function textoLivre(nome: string, valor: string | undefined, maximo?: number): string {
  let s = String(valor ?? "")
    .normalize("NFC")
    // biome-ignore lint/suspicious/noControlCharactersInRegex: remover caracteres de controle é o objetivo
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim();
  if (maximo !== undefined && s.length > maximo) s = s.slice(0, maximo).trim();
  return s ? `<${nome}>${escaparTexto(s)}</${nome}>` : "";
}

/**
 * Id do infDPS, exatamente 45 caracteres:
 * "DPS" + município emissor (7) + tipo de inscrição (1: CPF, 2: CNPJ) + CNPJ/CPF (14) + série (5) + número (15)
 */
export function montarIdDps(dados: {
  codigoMunicipioEmissor: string;
  documentoEmitente: string;
  serie: string;
  numero: number;
}): string {
  const doc = limparCnpj(dados.documentoEmitente);
  const tipo = doc.length === 14 ? "2" : "1";
  const id = `DPS${pad(dados.codigoMunicipioEmissor, 7)}${tipo}${doc.padStart(14, "0")}${pad(dados.serie, 5)}${pad(dados.numero, 15)}`;
  if (id.length !== 45) {
    throw new ErroFiscal(
      "DPS_ID_INVALIDO",
      `Id da DPS ficou com ${id.length} caracteres (esperado 45).`,
      { id },
    );
  }
  return id;
}

function documento(doc: string | undefined): string {
  const limpo = limparCnpj(doc ?? "");
  if (limpo.length === 14) return tag("CNPJ", limpo);
  if (limpo.length === 11) return tag("CPF", limpo);
  return "";
}

function prestadorXml(p: Prestador): string {
  const r = p.regime;
  return (
    "<prest>" +
    documento(p.documento) +
    tag("IM", p.inscricaoMunicipal) +
    textoLivre("xNome", p.nome, 300) +
    tag("fone", somenteDigitos(p.telefone)) +
    textoLivre("email", p.email, 80) +
    "<regTrib>" +
    tag("opSimpNac", r.opcaoSimples) +
    (r.opcaoSimples === 3 ? tag("regApTribSN", r.apuracaoSimples ?? 1) : "") +
    tag("regEspTrib", r.regimeEspecial ?? 0) +
    "</regTrib></prest>"
  );
}

function tomadorXml(t: Tomador | undefined): string {
  if (!t) return "";
  const e = t.endereco;
  const end = e
    ? "<end><endNac>" +
      tag("cMun", pad(e.codigoMunicipio, 7)) +
      tag("CEP", pad(e.cep, 8)) +
      "</endNac>" +
      textoLivre("xLgr", e.logradouro, 255) +
      textoLivre("nro", e.numero, 60) +
      textoLivre("xCpl", e.complemento, 156) +
      textoLivre("xBairro", e.bairro, 60) +
      "</end>"
    : "";
  return (
    "<toma>" +
    documento(t.documento) +
    tag("IM", t.inscricaoMunicipal) +
    textoLivre("xNome", t.nome, 300) +
    end +
    tag("fone", somenteDigitos(t.telefone)) +
    textoLivre("email", t.email, 80) +
    "</toma>"
  );
}

function servicoXml(s: Servico): string {
  return (
    "<serv><locPrest>" +
    tag("cLocPrestacao", pad(s.codigoMunicipioPrestacao, 7)) +
    "</locPrest><cServ>" +
    tag("cTribNac", somenteDigitos(s.codigoTributacaoNacional)) +
    tag("cTribMun", s.codigoTributacaoMunicipal) +
    textoLivre("xDescServ", s.descricao, 2000) +
    tag("cNBS", somenteDigitos(s.codigoNbs)) +
    "</cServ>" +
    (s.informacoesComplementares
      ? `<infoCompl>${textoLivre("xInfComp", s.informacoesComplementares, 2000)}</infoCompl>`
      : "") +
    "</serv>"
  );
}

function valoresXml(v: Valores): string {
  const descontos =
    v.descontoIncondicionado || v.descontoCondicionado
      ? "<vDescCondIncond>" +
        (v.descontoIncondicionado ? tag("vDescIncond", dec(v.descontoIncondicionado)) : "") +
        (v.descontoCondicionado ? tag("vDescCond", dec(v.descontoCondicionado)) : "") +
        "</vDescCondIncond>"
      : "";
  const tribMun =
    "<tribMun>" +
    tag("tribISSQN", v.tributacaoIssqn ?? 1) +
    tag("tpImunidade", v.tipoImunidade) +
    (v.aliquotaIss === undefined ? "" : tag("pAliq", dec(v.aliquotaIss))) +
    tag("tpRetISSQN", v.retencaoIss ?? 1) +
    "</tribMun>";
  const tribFed = v.cstPisCofins
    ? `<tribFed><piscofins>${tag("CST", pad(v.cstPisCofins, 2))}</piscofins></tribFed>`
    : "";
  // totTrib é uma escolha: percentual do Simples OU "não informado" (o certo para MEI)
  const totTrib =
    v.percentualTributosSimples === undefined
      ? `<totTrib>${tag("indTotTrib", 0)}</totTrib>`
      : `<totTrib>${tag("pTotTribSN", dec(v.percentualTributosSimples))}</totTrib>`;
  return (
    `<valores><vServPrest>${tag("vServ", dec(v.valorServico))}</vServPrest>` +
    `${descontos}<trib>${tribMun}${tribFed}${totTrib}</trib></valores>`
  );
}

function validar(entrada: {
  prestador: Prestador;
  tomador?: Tomador;
  servico: Servico;
  valores: Valores;
  dps: DadosDps;
}): void {
  const { prestador, tomador, servico, valores, dps } = entrada;
  const problemas: string[] = [];
  const docPrest = limparCnpj(prestador.documento ?? "");
  if (!(docPrest.length === 14 ? validarCnpj(docPrest) : validarCpf(docPrest))) {
    problemas.push("CNPJ/CPF do prestador inválido.");
  }
  const docToma = limparCnpj(tomador?.documento ?? "");
  if (docToma && !(docToma.length === 14 ? validarCnpj(docToma) : validarCpf(docToma))) {
    problemas.push("CNPJ/CPF do tomador inválido.");
  }
  if (tomador && !tomador.nome?.trim()) problemas.push("Nome do tomador não informado.");
  // Endereço é opcional, mas se for, vai completo: sem a rua o gov.br recusa com E1235
  // ("end ... expected 'xLgr'"), como aconteceu no portal da Agilize em 21/10/2026
  const end = tomador?.endereco;
  if (end) {
    const faltando = [
      !end.logradouro?.trim() && "rua",
      !end.numero?.trim() && "número",
      !end.bairro?.trim() && "bairro",
      somenteDigitos(end.cep).length !== 8 && "CEP",
      somenteDigitos(end.codigoMunicipio).length !== 7 && "município (código IBGE)",
    ].filter(Boolean);
    if (faltando.length)
      problemas.push(
        `Endereço do tomador incompleto: falta ${faltando.join(", ")}. Complete ou não envie o endereço.`,
      );
  }
  if (somenteDigitos(servico.codigoMunicipioPrestacao).length !== 7) {
    problemas.push("Município da prestação deve ter 7 dígitos (código IBGE).");
  }
  if (somenteDigitos(servico.codigoTributacaoNacional).length !== 6) {
    problemas.push("Código de tributação nacional deve ter 6 dígitos (ex.: 010601).");
  }
  if (!servico.descricao?.trim()) problemas.push("Descrição do serviço não informada.");
  if (!(valores.valorServico > 0)) problemas.push("Valor do serviço deve ser maior que zero.");
  if (valores.tributacaoIssqn === 4 && valores.tipoImunidade === undefined) {
    problemas.push("Imunidade (tributação 4) exige o tipo de imunidade.");
  }
  if (!/^\d{1,5}$/.test(dps.serie)) problemas.push("Série da DPS deve ter de 1 a 5 dígitos.");
  if (!(Number.isInteger(dps.numero) && dps.numero >= 1 && dps.numero < 1e15)) {
    problemas.push("Número da DPS deve ser inteiro positivo.");
  }
  if (problemas.length > 0) {
    throw new ErroFiscal("DPS_INVALIDA", problemas.join(" "), { problemas });
  }
}

/**
 * Monta a DPS (leiaute nacional 1.00), pronta para assinar
 * (`assinarXml(xml, { elemento: "infDPS", perfil: "nfse-nacional", certificado })`).
 * A ordem das tags segue o xs:sequence do XSD: não reordene.
 */
export function montarDps(entrada: {
  prestador: Prestador;
  tomador?: Tomador;
  servico: Servico;
  valores: Valores;
  dps: DadosDps;
}): DpsMontada {
  validar(entrada);
  const { prestador, tomador, servico, valores, dps } = entrada;
  const cLocEmi = pad(dps.codigoMunicipioEmissor ?? servico.codigoMunicipioPrestacao, 7);
  const id = montarIdDps({
    codigoMunicipioEmissor: cLocEmi,
    documentoEmitente: prestador.documento,
    serie: dps.serie,
    numero: dps.numero,
  });
  const margem = (dps.margemRelogioSegundos ?? 60) * 1000;
  const instante = new Date((dps.dataEmissao ?? new Date()).getTime() - margem);
  const dhEmi = formatarDataHoraSefaz(instante, dps.fuso);

  const infDps =
    `<infDPS Id="${id}">` +
    tag("tpAmb", dps.ambiente) +
    tag("dhEmi", dhEmi) +
    textoLivre("verAplic", dps.versaoAplicativo, 20) +
    tag("serie", dps.serie) +
    tag("nDPS", dps.numero) +
    tag("dCompet", dps.competencia ?? dhEmi.slice(0, 10)) +
    tag("tpEmit", dps.tipoEmitente ?? 1) +
    tag("cLocEmi", cLocEmi) +
    prestadorXml(prestador) +
    tomadorXml(tomador) +
    servicoXml(servico) +
    valoresXml(valores) +
    "</infDPS>";

  return {
    xml: `<?xml version="1.0" encoding="UTF-8"?><DPS xmlns="${NS_NFSE}" versao="1.00">${infDps}</DPS>`,
    id,
    dataEmissao: dhEmi,
  };
}

/**
 * Pedido de registro do evento de cancelamento (e101101), pronto para assinar (elemento "infPedReg").
 * Motivo: 1 erro na emissão · 2 serviço não prestado · 9 outros.
 */
export function montarCancelamentoNfse(dados: {
  chave: string;
  ambiente: 1 | 2;
  versaoAplicativo: string;
  documentoAutor: string;
  motivo: string;
  codigoMotivo?: 1 | 2 | 9;
  dataEvento?: Date;
  fuso?: string;
  margemRelogioSegundos?: number;
}): string {
  if (!/^\d{50}$/.test(dados.chave)) {
    throw new ErroFiscal("CHAVE_NFSE_INVALIDA", "Chave da NFS-e deve ter 50 dígitos.");
  }
  if (!dados.motivo?.trim()) {
    throw new ErroFiscal("MOTIVO_OBRIGATORIO", "Informe o motivo do cancelamento.");
  }
  const doc = limparCnpj(dados.documentoAutor);
  const autor = doc.length === 14 ? tag("CNPJAutor", doc) : tag("CPFAutor", doc);
  const margem = (dados.margemRelogioSegundos ?? 60) * 1000;
  const dhEvento = formatarDataHoraSefaz(
    new Date((dados.dataEvento ?? new Date()).getTime() - margem),
    dados.fuso,
  );
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    `<pedRegEvento xmlns="${NS_NFSE}" versao="1.00">` +
    `<infPedReg Id="PRE${dados.chave}101101">` +
    tag("tpAmb", dados.ambiente) +
    textoLivre("verAplic", dados.versaoAplicativo, 20) +
    tag("dhEvento", dhEvento) +
    autor +
    tag("chNFSe", dados.chave) +
    "<e101101><xDesc>Cancelamento de NFS-e</xDesc>" +
    tag("cMotivo", dados.codigoMotivo ?? 9) +
    textoLivre("xMotivo", dados.motivo, 255) +
    "</e101101></infPedReg></pedRegEvento>"
  );
}
