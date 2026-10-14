// Teste REAL da NFS-e Nacional em produção restrita (homologação, sem valor fiscal):
// emite uma NFS-e de R$ 1,00 → consulta → cancela.
//
// Uso (PowerShell):
//   $env:FISCAL_PFX = "C:\caminho\certificado.pfx"
//   $env:FISCAL_PFX_SENHA = "..."            # a senha fica só nesta janela do terminal
//   node scripts/homologacao-nfse.mjs caminho\nfse.json [--sem-cancelar]
//   node scripts/homologacao-nfse.mjs caminho\nfse.json --cancelar <chave>   (só cancela uma já emitida)
//
// nfse.json: { prestador, tomador?, servico } da empresa dona do certificado, ex.:
//   { "prestador": { "documento": "...", "regime": { "opcaoSimples": 2, "regimeEspecial": 0 } },
//     "servico": { "codigoMunicipioPrestacao": "4314902", "codigoTributacaoNacional": "090201",
//                  "codigoNbs": "118054000", "descricao": "..." } }
//
// Antes: pnpm build
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const RAIZ = join(import.meta.dirname, "..");
const requerer = createRequire(join(RAIZ, "packages/nfse-nacional/package.json"));
const { abrirCertificadoA1, situacaoCertificado } = requerer("@fiscal/certificado");
const { criarClienteNfse, emitirNfse, cancelarNfse } = requerer("@fiscal/nfse-nacional");

const [arquivo, ...opcoes] = process.argv.slice(2);
const { FISCAL_PFX, FISCAL_PFX_SENHA } = process.env;
if (!arquivo || !FISCAL_PFX || FISCAL_PFX_SENHA === undefined) {
  console.error(
    "Defina FISCAL_PFX e FISCAL_PFX_SENHA e passe o caminho do nfse.json (veja o topo do arquivo).",
  );
  process.exit(1);
}

const dados = JSON.parse(readFileSync(arquivo, "utf8"));
const certificado = abrirCertificadoA1(readFileSync(FISCAL_PFX), FISCAL_PFX_SENHA);
console.log(
  `Certificado: ${certificado.titular} (${certificado.documento}), ${JSON.stringify(situacaoCertificado(certificado))}`,
);

const cliente = criarClienteNfse({
  certificado,
  ambiente: 2,
  aoRegistrar: (r) =>
    console.log(
      `  ↳ ${r.metodo} ${r.url.replace(/^https:\/\/[^/]+/, "")} ${r.statusHttp ?? r.erro} em ${r.duracaoMs} ms`,
    ),
});

const versaoAplicativo = "fiscal-teste";
const agora = new Date();
const competencia = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(
  agora,
);

async function cancelar(chave) {
  const cancelamento = await cancelarNfse({
    cliente,
    certificado,
    chave,
    ambiente: 2,
    versaoAplicativo,
    documentoAutor: dados.prestador.documento,
    motivo: "Teste de homologacao do pacote fiscal",
    codigoMotivo: 1,
  });
  console.log("Cancelamento:", {
    registrado: cancelamento.registrado,
    xmlEvento: cancelamento.xmlEvento ? "(ok)" : undefined,
    erros: cancelamento.erros,
  });
}

try {
  const pedido = opcoes.indexOf("--cancelar");
  if (pedido >= 0) {
    await cancelar(opcoes[pedido + 1]);
    process.exit(0);
  }

  // Número aleatório alto numa série só de testes (900) para não colidir com testes anteriores
  const emissao = await emitirNfse({
    cliente,
    certificado,
    prestador: dados.prestador,
    ...(dados.tomador ? { tomador: dados.tomador } : {}),
    servico: dados.servico,
    valores: { valorServico: 1, tributacaoIssqn: 1, retencaoIss: 1 },
    dps: {
      ambiente: 2,
      serie: "900",
      numero: 100_000 + Math.floor(Math.random() * 800_000),
      competencia,
      dataEmissao: agora,
      versaoAplicativo,
    },
  });
  console.log("Emissão:", {
    situacao: emissao.situacao,
    chave: emissao.chave,
    idDps: emissao.dps.id,
    erros: emissao.erros,
    alertas: emissao.alertas,
    xmlNfse: emissao.xmlNfse ? "(ok)" : undefined,
  });
  if (emissao.situacao !== "autorizada" || !emissao.chave) process.exit(2);

  const consulta = await cliente.consultarNfse(emissao.chave);
  console.log("Consulta:", consulta.xmlNfse ? "NFS-e encontrada" : consulta);

  if (!opcoes.includes("--sem-cancelar")) {
    await cancelar(emissao.chave);
  }
} finally {
  cliente.fechar();
}
