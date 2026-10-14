import { ErroFiscal, limparCnpj, validarChaveAcesso, validarCnpj, validarCpf } from "@fiscal/core";
import { centavos, problemasTributacao } from "@fiscal/nfe-comum";
import { somenteDigitos } from "@fiscal/xml";
import type { DadosNfe, EmitenteNfe, OperacaoNfe } from "./tipos";

/** 1 interna · 2 interestadual · 3 exterior */
export function destinoDaOperacao(emitente: EmitenteNfe, operacao: OperacaoNfe): 1 | 2 | 3 {
  const uf = operacao.destinatario.endereco.uf;
  if (uf === "EX") return 3;
  return uf === emitente.endereco.uf ? 1 : 2;
}

/**
 * Confere emitente, destinatário, itens e pagamentos antes de montar. Lança ErroFiscal
 * (NFE_INVALIDA) com TODOS os problemas, já explicados para o usuário.
 */
export function validarNfe(emitente: EmitenteNfe, operacao: OperacaoNfe, nota: DadosNfe): void {
  const p: string[] = [];

  // Emitente
  if (!validarCnpj(emitente.cnpj)) p.push("CNPJ do emitente inválido.");
  const ie = somenteDigitos(emitente.inscricaoEstadual);
  if (ie.length < 2 || /^0+$/.test(ie)) p.push("Inscrição estadual do emitente inválida.");
  if (!emitente.razaoSocial?.trim()) p.push("Razão social do emitente não informada.");
  if (![1, 2, 3, 4].includes(emitente.crt)) p.push("CRT do emitente inválido (1, 2, 3 ou 4).");
  if (somenteDigitos(emitente.endereco?.codigoMunicipio).length !== 7)
    p.push("Código IBGE do município do emitente deve ter 7 dígitos.");
  if (emitente.inscricaoMunicipal && !emitente.cnae)
    p.push("Inscrição municipal do emitente exige o CNAE.");

  // A SEFAZ exige pelo menos 2 caracteres em nome, logradouro, bairro e município
  const curtos = (quem: string, campos: Record<string, string | undefined>) => {
    for (const [nome, valor] of Object.entries(campos)) {
      const v = (valor ?? "").trim();
      if (v.length === 1) p.push(`${quem}: ${nome} precisa de pelo menos 2 caracteres.`);
    }
  };
  const ee = emitente.endereco;
  curtos("Emitente", {
    nome: emitente.razaoSocial,
    logradouro: ee?.logradouro,
    bairro: ee?.bairro,
    município: ee?.municipio,
  });
  const de = operacao.destinatario?.endereco;
  curtos("Destinatário", {
    nome: operacao.destinatario?.nome,
    logradouro: de?.logradouro,
    bairro: de?.bairro,
    município: de?.municipio,
  });

  // Nota
  if (!(Number.isInteger(nota.serie) && nota.serie >= 0 && nota.serie <= 889))
    p.push("Série da NF-e deve ser de 0 a 889.");
  if (!(Number.isInteger(nota.numero) && nota.numero >= 1 && nota.numero <= 999_999_999))
    p.push("Número da NF-e deve ser de 1 a 999999999.");
  if (!nota.naturezaOperacao?.trim()) p.push("Informe a natureza da operação.");
  const finalidade = nota.finalidade ?? 1;
  const refs = nota.referencias ?? [];
  if ((finalidade === 2 || finalidade === 4) && refs.length === 0)
    p.push("Devolução e nota complementar precisam da chave da NF-e referenciada.");
  for (const chave of refs) {
    if (!validarChaveAcesso(chave)) p.push(`Chave referenciada inválida: ${chave}.`);
  }

  // Destinatário
  const d = operacao.destinatario;
  const doc = limparCnpj(d?.documento ?? "");
  const exterior = d?.endereco?.uf === "EX";
  if (!d) p.push("NF-e precisa do destinatário.");
  else {
    if (!d.nome?.trim()) p.push("Nome do destinatário não informado.");
    if (exterior) {
      if (doc) p.push("Destinatário no exterior: use idEstrangeiro, não CPF/CNPJ.");
    } else if (!(doc.length === 11 ? validarCpf(doc) : validarCnpj(doc))) {
      p.push("CPF/CNPJ do destinatário inválido.");
    }
    if (d.indicadorIe === 1 && somenteDigitos(d.inscricaoEstadual).length < 2)
      p.push("Destinatário contribuinte (indicadorIe 1) precisa da inscrição estadual.");
    if (d.indicadorIe === 1 && doc.length === 11)
      p.push("Pessoa física (CPF) raramente é contribuinte: confira o indicadorIe.");
    if (d.indicadorIe !== 1 && d.inscricaoEstadual)
      p.push("Inscrição estadual só vai com indicadorIe 1 (contribuinte).");
    const e = d.endereco;
    if (!e?.logradouro?.trim() || !e.bairro?.trim() || !e.municipio?.trim())
      p.push("Endereço do destinatário incompleto (logradouro, bairro e município).");
    if (!exterior && somenteDigitos(e?.codigoMunicipio).length !== 7)
      p.push("Código IBGE do município do destinatário deve ter 7 dígitos.");
  }

  // Itens
  const idDest = d ? destinoDaOperacao(emitente, operacao) : 1;
  const saida = (nota.tipo ?? "saida") === "saida";
  const digitoCfop = String((saida ? 4 : 0) + idDest);
  const itens = operacao.itens ?? [];
  if (itens.length === 0) p.push("A NF-e não tem itens.");
  if (itens.length > 990) p.push("Uma NF-e aceita no máximo 990 itens.");
  itens.forEach((it, i) => {
    const nome = `Item ${i + 1}${it.descricao ? ` (${it.descricao})` : ""}`;
    if (!it.codigo?.trim()) p.push(`${nome}: sem código.`);
    if (!it.descricao?.trim()) p.push(`${nome}: sem descrição.`);
    if (somenteDigitos(it.ncm).length !== 8) p.push(`${nome}: NCM deve ter 8 dígitos.`);
    const cfop = somenteDigitos(it.cfop);
    if (cfop.length !== 4) p.push(`${nome}: CFOP deve ter 4 dígitos.`);
    else if (cfop[0] !== digitoCfop) {
      const tipo = saida ? "saída" : "entrada";
      const destino = ["", "dentro do estado", "para outro estado", "para o exterior"][idDest];
      p.push(`${nome}: CFOP ${cfop} não combina com ${tipo} ${destino} (use ${digitoCfop}xxx).`);
    }
    if (!(Number(it.quantidade) > 0)) p.push(`${nome}: quantidade deve ser maior que zero.`);
    if (!(Number(it.valorUnitario) >= 0)) p.push(`${nome}: valor unitário inválido.`);
    if (it.gtin && !/^(\d{8}|\d{12,14})$/.test(somenteDigitos(it.gtin)))
      p.push(`${nome}: GTIN deve ter 8, 12, 13 ou 14 dígitos.`);
    if (!it.tributacao) p.push(`${nome}: informe a tributação (ICMS, PIS, COFINS).`);
    else for (const x of problemasTributacao(it.tributacao, emitente.crt)) p.push(`${nome}: ${x}`);
  });

  // DIFAL (EC 87/2015): venda interestadual a consumidor final não contribuinte
  const consumidorFinal = nota.consumidorFinal ?? d?.indicadorIe === 9;
  const exigeDifal = idDest === 2 && consumidorFinal && d?.indicadorIe === 9;
  itens.forEach((it, i) => {
    const nome = `Item ${i + 1}${it.descricao ? ` (${it.descricao})` : ""}`;
    // No Simples o DIFAL fica fora da nota (recolhido à parte); no regime normal vai no item
    if (exigeDifal && emitente.crt === 3 && it.tributacao && !it.tributacao.difal)
      p.push(
        `${nome}: venda a consumidor final de outro estado precisa do DIFAL (tributacao.difal com a alíquota interna do destino).`,
      );
    if (!exigeDifal && it.tributacao?.difal)
      p.push(
        `${nome}: DIFAL só vale para venda interestadual a consumidor final não contribuinte.`,
      );
  });

  // Pagamentos
  const pagamentos = operacao.pagamentos ?? [];
  if (pagamentos.length === 0)
    p.push('Informe o pagamento (em devolução, remessa ou bonificação use "sem-pagamento").');
  const semPagamento = pagamentos.some((x) => x.forma === "sem-pagamento");
  if (semPagamento && pagamentos.length > 1)
    p.push('"sem-pagamento" não pode ser combinado com outras formas.');
  if ((finalidade === 3 || finalidade === 4) && !semPagamento)
    p.push('Devolução e nota de ajuste usam pagamento "sem-pagamento".');
  pagamentos.forEach((x, i) => {
    if (x.forma === "sem-pagamento" ? Number(x.valor) !== 0 : !(Number(x.valor) > 0))
      p.push(`Pagamento ${i + 1}: valor inválido ("sem-pagamento" vai com 0).`);
    // Sem isto a SEFAZ recusa com 392 (faltam os dados do pagamento integrado)
    const eletronico = x.forma === "credito" || x.forma === "debito" || x.forma === "pix";
    if (eletronico && x.integrado !== false && !validarCnpj(x.cnpjCredenciadora ?? ""))
      p.push(
        `Pagamento ${i + 1} (${x.forma}): pagamento integrado precisa do CNPJ da credenciadora (ou informe integrado: false).`,
      );
  });

  // Cobrança
  for (const [i, dup] of (operacao.cobranca?.duplicatas ?? []).entries()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dup.vencimento))
      p.push(`Duplicata ${i + 1}: vencimento deve ser AAAA-MM-DD.`);
    if (!(centavos(dup.valor) > 0)) p.push(`Duplicata ${i + 1}: valor deve ser maior que zero.`);
  }

  if (p.length) throw new ErroFiscal("NFE_INVALIDA", p.join(" "), { problemas: p });
}
