// Teste REAL da NF-e (modelo 55) em homologação, sem valor fiscal:
// status → emite uma NF-e de R$ 1,00 → consulta → carta de correção → cancela.
//
// Uso (PowerShell):
//   $env:FISCAL_PFX = "C:\caminho\certificado.pfx"
//   $env:FISCAL_PFX_SENHA = "..."            # a senha fica só nesta janela do terminal
//   node scripts/homologacao-nfe.mjs caminho\emitente.json [--sem-cancelar]
//
// emitente.json: o mesmo usado em homologacao-nfce.mjs (CNPJ, IE, CRT e endereço reais da empresa
// dona do certificado). O destinatário é uma pessoa física fictícia na mesma cidade.
//
// Antes: pnpm build
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const RAIZ = join(import.meta.dirname, "..");
const requerer = createRequire(join(RAIZ, "packages/nfe/package.json"));
const { abrirCertificadoA1, situacaoCertificado } = requerer("@fiscal/certificado");
const { criarClienteSefaz } = requerer("@fiscal/transporte");
const { emitirNfe, consultarNfe, cancelarNfe, enviarCartaCorrecao } = requerer("@fiscal/nfe");

const [arquivoEmitente, ...opcoes] = process.argv.slice(2);
const { FISCAL_PFX, FISCAL_PFX_SENHA } = process.env;
if (!arquivoEmitente || !FISCAL_PFX || FISCAL_PFX_SENHA === undefined) {
  console.error(
    "Defina FISCAL_PFX e FISCAL_PFX_SENHA e passe o caminho do emitente.json (veja o topo do arquivo).",
  );
  process.exit(1);
}

const emitente = JSON.parse(readFileSync(arquivoEmitente, "utf8"));
const certificado = abrirCertificadoA1(readFileSync(FISCAL_PFX), FISCAL_PFX_SENHA);
console.log(
  `Certificado: ${certificado.titular} (${certificado.documento}), ${JSON.stringify(situacaoCertificado(certificado))}`,
);

const cliente = criarClienteSefaz({
  certificado,
  aoRegistrar: (r) =>
    console.log(`  ↳ ${r.servico ?? "?"} ${r.statusHttp ?? r.erro?.codigo} em ${r.duracaoMs} ms`),
});
const uf = emitente.endereco.uf;
const simples = emitente.crt !== 3;

try {
  const status = await cliente.consultarStatus({ uf, modelo: "55", ambiente: 2 });
  console.log("Status:", status);
  if (!status.emOperacao) throw new Error("SEFAZ fora de operação agora.");
  if (Math.abs(status.diferencaRelogioSegundos ?? 0) > 60) {
    console.warn(`ATENÇÃO: relógio do PC difere da SEFAZ em ${status.diferencaRelogioSegundos} s.`);
  }

  // Número aleatório alto numa série só de testes (88) para não colidir com testes anteriores
  let numero = 100_000 + Math.floor(Math.random() * 800_000);
  const emissao = await emitirNfe({
    cliente,
    certificado,
    emitente,
    nota: {
      ambiente: 2,
      serie: 88,
      naturezaOperacao: "Venda de mercadoria",
      presenca: 1,
      versaoAplicativo: "fiscal-teste",
    },
    proximoNumero: async () => numero++,
    operacao: {
      destinatario: {
        documento: "12345678909",
        nome: "Consumidor de teste",
        indicadorIe: 9,
        endereco: { ...emitente.endereco, logradouro: "Rua de teste", numero: "1" },
      },
      itens: [
        {
          codigo: "TESTE",
          descricao: "Produto de teste",
          ncm: "21069090",
          cfop: "5102",
          quantidade: 1,
          valorUnitario: 1,
          tributacao: simples
            ? { icms: { csosn: "102" }, pis: { cst: "99" }, cofins: { cst: "99" } }
            : {
                icms: { cst: "00", aliquota: 17 },
                pis: { cst: "01", aliquota: 0.65 },
                cofins: { cst: "01", aliquota: 3 },
              },
        },
      ],
      pagamentos: [{ forma: "dinheiro", valor: 1 }],
    },
  });
  console.log("Emissão:", {
    chave: emissao.nota.chave,
    numero: emissao.nota.numero,
    ...emissao.autorizacao,
    xmlProcessado: emissao.autorizacao.xmlProcessado ? "(ok)" : undefined,
    xmlProtocolo: undefined,
  });
  if (emissao.autorizacao.situacao !== "autorizada") process.exit(2);
  const chave = emissao.nota.chave;

  const consulta = await consultarNfe(cliente, { uf, ambiente: 2, chave });
  console.log("Consulta:", consulta.situacao, consulta.cStat, consulta.motivo);

  const cce = await enviarCartaCorrecao(cliente, {
    uf,
    ambiente: 2,
    chave,
    sequencia: 1,
    correcao: "Teste de carta de correcao do pacote fiscal",
    documentoEmitente: emitente.cnpj,
    certificado,
  });
  console.log("Carta de correção:", cce.registrado, cce.cStat, cce.motivo);

  if (!opcoes.includes("--sem-cancelar")) {
    const cancelamento = await cancelarNfe(cliente, {
      uf,
      ambiente: 2,
      chave,
      protocolo: emissao.autorizacao.protocolo,
      justificativa: "Teste de homologacao do pacote fiscal",
      documentoEmitente: emitente.cnpj,
      certificado,
    });
    console.log("Cancelamento:", cancelamento.registrado, cancelamento.cStat, cancelamento.motivo);
  }
} finally {
  cliente.fechar();
}
