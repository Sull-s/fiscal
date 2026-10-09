import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { DadosNota, EmitenteNfce, Venda } from "../src/tipos";

export const PASTA_FIXTURES = join(import.meta.dirname, "fixtures");
const PASTA_ANTIGO = join(PASTA_FIXTURES, "antigo");

/* Formato de entrada do emissor antigo (apis/mp-marketplace-oauth/lib/nfce/montar.js) */
interface EnderecoAntigo {
  xLgr?: string;
  nro?: string;
  xCpl?: string;
  xBairro?: string;
  cMun?: string;
  xMun?: string;
  uf?: string;
  cep?: string;
  fone?: string;
}
interface FixtureAntiga {
  emitente: {
    cnpj: string;
    ie: string;
    razao: string;
    fantasia?: string;
    crt: 1 | 2 | 4;
    versao_app: string;
    endereco: EnderecoAntigo;
    respTec?: { cnpj: string; contato: string; email: string; fone: string };
  };
  nota: { ambiente: 1 | 2; serie: number; numero: number };
  venda: {
    itens: Record<string, unknown>[];
    pagamentos: Record<string, unknown>[];
    desconto?: number;
    outras?: number;
    entrega?: boolean;
    cpf?: string;
    destinatario?: { cpf?: string; nome?: string; endereco?: EnderecoAntigo };
    informacoes?: string;
  };
  quando: string;
  cNF: string;
  resultado: { chave: string; vNF: number; troco: number; qrCode: string };
}

const endereco = (e: EnderecoAntigo = {}) => ({
  logradouro: e.xLgr ?? "",
  numero: e.nro,
  complemento: e.xCpl,
  bairro: e.xBairro ?? "",
  codigoMunicipio: e.cMun ?? "",
  municipio: e.xMun ?? "",
  uf: (e.uf ?? "RS") as "RS",
  cep: e.cep,
  telefone: e.fone,
});

/** Converte a entrada do emissor antigo para o formato de @fiscal/nfce. */
function converter(f: FixtureAntiga): { emitente: EmitenteNfce; venda: Venda; nota: DadosNota } {
  const e = f.emitente;
  const v = f.venda;
  return {
    emitente: {
      cnpj: e.cnpj,
      inscricaoEstadual: e.ie,
      razaoSocial: e.razao,
      ...(e.fantasia ? { nomeFantasia: e.fantasia } : {}),
      crt: e.crt,
      endereco: endereco(e.endereco),
      ...(e.respTec
        ? {
            responsavelTecnico: {
              cnpj: e.respTec.cnpj,
              contato: e.respTec.contato,
              email: e.respTec.email,
              telefone: e.respTec.fone,
            },
          }
        : {}),
    } as EmitenteNfce,
    venda: {
      itens: v.itens.map((i) => ({
        codigo: i.codigo,
        descricao: i.descricao,
        ncm: i.ncm,
        cest: i.cest,
        cfop: i.cfop,
        csosn: i.csosn,
        origem: i.origem,
        cstPisCofins: i.pis_cofins_cst,
        unidade: i.unidade,
        quantidade: i.quantidade,
        valorUnitario: i.valor_unitario,
        observacao: i.observacao,
      })) as Venda["itens"],
      pagamentos: v.pagamentos.map((p) => ({
        forma: p.forma,
        valor: p.valor,
        integrado: p.integrado,
        cnpjCredenciadora: p.cnpj_credenciadora,
        bandeira: p.bandeira,
        autorizacao: p.autorizacao,
        descricao: p.descricao,
      })) as Venda["pagamentos"],
      desconto: v.desconto,
      outrasDespesas: v.outras,
      entrega: v.entrega,
      destinatario: {
        documento: v.destinatario?.cpf ?? v.cpf,
        nome: v.destinatario?.nome,
        endereco: endereco(v.destinatario?.endereco),
      },
      informacoesComplementares: v.informacoes,
    } as Venda,
    nota: {
      ...f.nota,
      dataEmissao: new Date(f.quando),
      codigoNumerico: f.cNF,
      versaoAplicativo: e.versao_app,
    },
  };
}

export function carregarFixturesAntigas() {
  return readdirSync(PASTA_ANTIGO)
    .filter((n) => n.endsWith(".json"))
    .map((n) => {
      const nome = n.replace(/\.json$/, "");
      const bruto = JSON.parse(readFileSync(join(PASTA_ANTIGO, n), "utf8")) as FixtureAntiga;
      return {
        nome,
        entrada: converter(bruto),
        esperado: {
          xml: readFileSync(join(PASTA_ANTIGO, `${nome}.xml`), "utf8"),
          ...bruto.resultado,
        },
      };
    });
}
