// Teste REAL em homologação (sem valor fiscal): status → emite uma NFC-e de R$ 1,00 → consulta → cancela.
//
// Uso (PowerShell):
//   $env:FISCAL_PFX = "C:\caminho\certificado.pfx"
//   $env:FISCAL_PFX_SENHA = "..."            # a senha fica só nesta janela do terminal
//   node scripts/homologacao-nfce.mjs caminho\emitente.json [--sem-cancelar]
//
// emitente.json: o EmitenteNfce da empresa dona do certificado (CNPJ, IE e endereço reais), ex.:
//   { "cnpj": "...", "inscricaoEstadual": "...", "razaoSocial": "...", "crt": 4,
//     "endereco": { "logradouro": "...", "numero": "...", "bairro": "...", "codigoMunicipio": "4314902",
//                   "municipio": "Porto Alegre", "uf": "RS", "cep": "..." } }
//
// Antes: pnpm build
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const RAIZ = join(import.meta.dirname, "..");
const requerer = createRequire(join(RAIZ, "packages/nfce/package.json"));
const { abrirCertificadoA1, situacaoCertificado } = requerer("@fiscal/certificado");
const { criarClienteSefaz } = requerer("@fiscal/transporte");
const { emitirNfce, consultarNfce, cancelarNfce } = requerer("@fiscal/nfce");

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

try {
  const status = await cliente.consultarStatus({ uf, modelo: "65", ambiente: 2 });
  console.log("Status:", status);
  if (!status.emOperacao) throw new Error("SEFAZ fora de operação agora.");
  if (Math.abs(status.diferencaRelogioSegundos ?? 0) > 60) {
    console.warn(`ATENÇÃO: relógio do PC difere da SEFAZ em ${status.diferencaRelogioSegundos} s.`);
  }

  // Número aleatório alto numa série só de testes (88) para não colidir com testes anteriores
  let numero = 100_000 + Math.floor(Math.random() * 800_000);
  const emissao = await emitirNfce({
    cliente,
    certificado,
    emitente,
    nota: { ambiente: 2, serie: 88, versaoAplicativo: "fiscal-teste" },
    proximoNumero: async () => numero++,
    venda: {
      itens: [
        {
          descricao: "Produto de teste",
          ncm: "21069090",
          cfop: "5102",
          quantidade: 1,
          valorUnitario: 1,
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

  const consulta = await consultarNfce(cliente, { uf, ambiente: 2, chave: emissao.nota.chave });
  console.log("Consulta:", consulta.situacao, consulta.cStat, consulta.motivo);

  if (!opcoes.includes("--sem-cancelar")) {
    const cancelamento = await cancelarNfce(cliente, {
      uf,
      ambiente: 2,
      chave: emissao.nota.chave,
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
