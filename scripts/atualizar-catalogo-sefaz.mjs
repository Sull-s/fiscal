// Regenera os catálogos de endereços da SEFAZ a partir dos arquivos mantidos pelo projeto sped-nfe
// (https://github.com/nfephp-org/sped-nfe/tree/master/storage), a referência usada pela comunidade.
//
//   node scripts/atualizar-catalogo-sefaz.mjs
//
// Gera:
//   packages/transporte/src/catalogo-oficial.ts   webservices NF-e/NFC-e por autorizador + quem atende cada UF
//   packages/nfce/src/urls-consulta.ts            URL do QR Code e urlChave da NFC-e por UF
//
// Depois: revise o diff e rode `pnpm verificar` (os testes conferem RS com os endereços de produção).
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(RAIZ, "packages/transporte/package.json"));
const { XMLParser } = require("fast-xml-parser");

const BASE = "https://raw.githubusercontent.com/nfephp-org/sped-nfe/master/storage";
const baixar = async (nome) => {
  const r = await fetch(`${BASE}/${nome}`);
  if (!r.ok) throw new Error(`${nome}: HTTP ${r.status}`);
  return r.text();
};

const SERVICOS = {
  NfeAutorizacao: ["autorizacao", "NFeAutorizacao4", "nfeAutorizacaoLote"],
  NfeRetAutorizacao: ["retAutorizacao", "NFeRetAutorizacao4", "nfeRetAutorizacaoLote"],
  NfeStatusServico: ["status", "NFeStatusServico4", "nfeStatusServicoNF"],
  NfeConsultaProtocolo: ["consulta", "NFeConsultaProtocolo4", "nfeConsultaNF"],
  RecepcaoEvento: ["evento", "NFeRecepcaoEvento4", "nfeRecepcaoEvento"],
  NfeInutilizacao: ["inutilizacao", "NFeInutilizacao4", "nfeInutilizacaoNF"],
};
const SIGLA = { SVCAN: "SVC-AN", SVCRS: "SVC-RS" };
const AMBIENTE = { producao: 1, homologacao: 2 };

const leitor = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  isArray: (n) => n === "UF",
});
const enderecos = { 55: {}, 65: {} };
const qrCode = {};
const avisos = [];

/** obj[chave], criando com `inicial` se ainda não existir */
function pegar(obj, chave, inicial) {
  if (!(chave in obj)) obj[chave] = inicial;
  return obj[chave];
}

for (const modelo of ["55", "65"]) {
  const ws = leitor.parse(await baixar(`wsnfe_4.00_mod${modelo}.xml`)).WS.UF;
  for (const uf of ws) {
    const sigla = SIGLA[uf.sigla] ?? uf.sigla;
    for (const [nomeAmb, amb] of Object.entries(AMBIENTE)) {
      for (const [tag, valor] of Object.entries(uf[nomeAmb] ?? {})) {
        const url = String(valor["#text"] ?? "").trim();
        if (tag === "NfeConsultaQR" && modelo === "65") {
          pegar(qrCode, sigla, {})[amb] = url;
          continue;
        }
        const servico = SERVICOS[tag];
        if (!servico || !url) continue;
        const [nome, operacao, metodo] = servico;
        // Algumas UFs (ex.: PR, GO) usam operação/método fora do padrão: guarda junto com a URL
        const foraDoPadrao = valor["@operation"] !== operacao || valor["@method"] !== metodo;
        if (foraDoPadrao)
          avisos.push(
            `${modelo} ${sigla} ${amb} ${tag}: ${valor["@operation"]}/${valor["@method"]}`,
          );
        const porAmbiente = pegar(enderecos[modelo], sigla, { 1: {}, 2: {} });
        pegar(porAmbiente, amb, {})[nome] = foraDoPadrao
          ? { url, wsdl: valor["@operation"], metodo: valor["@method"] }
          : url;
      }
    }
  }
}

const autorizadoresBrutos = JSON.parse(await baixar("autorizadores.json"));
const UFS = [
  "AC",
  "AL",
  "AM",
  "AP",
  "BA",
  "CE",
  "DF",
  "ES",
  "GO",
  "MA",
  "MG",
  "MS",
  "MT",
  "PA",
  "PB",
  "PE",
  "PI",
  "PR",
  "RJ",
  "RN",
  "RO",
  "RR",
  "RS",
  "SC",
  "SE",
  "SP",
  "TO",
];
const autorizadorDaUf = { 55: {}, 65: {} };
for (const modelo of ["55", "65"]) {
  for (const uf of UFS) {
    const aut = autorizadoresBrutos[modelo][uf];
    if (!aut) throw new Error(`Sem autorizador para ${uf} no modelo ${modelo}`);
    if (!enderecos[modelo][aut])
      throw new Error(`Autorizador ${aut} (${uf}, mod ${modelo}) sem endereços`);
    autorizadorDaUf[modelo][uf] = aut;
  }
}

const urlChave = JSON.parse(await baixar("uri_consulta_nfce.json"));
const hoje = new Date().toISOString().slice(0, 10);
const cabecalho = (o) =>
  `// ARQUIVO GERADO por scripts/atualizar-catalogo-sefaz.mjs em ${hoje} — não edite à mão.\n// Fonte: ${o}\n`;

writeFileSync(
  join(RAIZ, "packages/transporte/src/catalogo-oficial.ts"),
  `${cabecalho("sped-nfe storage/wsnfe_4.00_mod55.xml, wsnfe_4.00_mod65.xml e autorizadores.json")}import type { CatalogoWebservices } from "./webservices";\n\nexport const CATALOGO_OFICIAL: CatalogoWebservices = ${JSON.stringify({ autorizadorDaUf, enderecos }, null, 2)};\n`,
);

const urls = {};
for (const uf of UFS) {
  urls[uf] = {
    1: { qrCode: qrCode[uf]?.[1] ?? "", urlChave: urlChave["1"][uf] ?? "" },
    2: { qrCode: qrCode[uf]?.[2] ?? "", urlChave: urlChave["2"][uf] ?? "" },
  };
}
writeFileSync(
  join(RAIZ, "packages/nfce/src/urls-consulta.ts"),
  `${cabecalho("sped-nfe storage/wsnfe_4.00_mod65.xml (NfeConsultaQR) e uri_consulta_nfce.json")}import type { Uf } from "@fiscal/core";\n\n/** Por UF e ambiente (1 produção, 2 homologação): base do QR Code e texto da urlChave. */\nexport const URLS_CONSULTA_NFCE: Record<Uf, Record<1 | 2, { qrCode: string; urlChave: string }>> = ${JSON.stringify(urls, null, 2)};\n`,
);

console.log("Catálogos gerados.");
for (const a of avisos) console.log("Operação fora do padrão (guardada no catálogo):", a);
