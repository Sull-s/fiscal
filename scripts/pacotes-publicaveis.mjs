#!/usr/bin/env node
/**
 * Monta os pacotes que os APPS instalam (GitHub Packages, escopo @sull-s):
 *
 *   @sull-s/fiscal-agente  emissor embutido + API + todos os módulos fiscais num pacote só
 *   @sull-s/fiscal-ui      telas React (ConfigurarEmissor, EmissorNfce, …)
 *
 * Dentro do monorepo os nomes continuam @fiscal/*; aqui os módulos internos são embutidos no
 * pacote (o GitHub Packages exige o escopo da conta e os apps não enxergam o workspace) e só as
 * bibliotecas de terceiros ficam como dependências.
 *
 *   pnpm build && node scripts/pacotes-publicaveis.mjs            → saida/pacotes/*.tgz
 *   node scripts/pacotes-publicaveis.mjs --publicar               → publica (precisa NODE_AUTH_TOKEN)
 */
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "tsup";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const saida = join(raiz, "saida", "pacotes");
const ESCOPO = "@sull-s";
const REGISTRO = "https://npm.pkg.github.com";
const REPOSITORIO = { type: "git", url: "git+https://github.com/Sull-s/fiscal.git" };
const publicar = process.argv.includes("--publicar");

const ler = (arquivo) => JSON.parse(readFileSync(join(raiz, arquivo), "utf8"));

// Dependências de terceiros de todos os módulos internos que o agente usa
function dependenciasExternas() {
  const pastas = [
    "apps/api",
    ...readdirSync(join(raiz, "packages"))
      .filter((p) => p !== "ui")
      .map((p) => `packages/${p}`),
  ];
  const deps = {};
  for (const pasta of pastas) {
    for (const [nome, versao] of Object.entries(ler(`${pasta}/package.json`).dependencies ?? {})) {
      if (!nome.startsWith("@fiscal/")) deps[nome] = versao;
    }
  }
  return Object.fromEntries(Object.entries(deps).sort(([a], [b]) => a.localeCompare(b)));
}

function empacotar(pasta) {
  // npm pack gera o .tgz que um app pode instalar direto (npm i ./arquivo.tgz) para testar
  const r = execFileSync("npm", ["pack", "--silent", "--pack-destination", saida], {
    cwd: pasta,
    shell: true,
  });
  return join(saida, r.toString().trim().split(/\r?\n/).pop());
}

function publicarPacote(pasta) {
  execFileSync("npm", ["publish", "--registry", REGISTRO], {
    cwd: pasta,
    stdio: "inherit",
    shell: true,
  });
}

rmSync(saida, { recursive: true, force: true });
mkdirSync(saida, { recursive: true });

// ---- @sull-s/fiscal-agente
const agente = ler("packages/agente/package.json");
const pastaAgente = join(saida, "fiscal-agente");
await build({
  entry: {
    index: join(raiz, "packages/agente/src/index.ts"),
    electron: join(raiz, "packages/agente/src/electron.ts"),
  },
  outDir: join(pastaAgente, "dist"),
  format: ["esm"],
  platform: "node",
  target: "node20",
  sourcemap: true,
  clean: true,
  // Os módulos @fiscal/* vão dentro; as bibliotecas de terceiros ficam como dependência (o
  // instalador do app precisa delas em node_modules: asarUnpack do PGlite e do pdfkit)
  noExternal: [/^@fiscal\//],
  // O pacote e qualquer subcaminho dele (ex.: "hono" e "hono/cors")
  external: Object.keys(dependenciasExternas()).flatMap((nome) => [nome, `${nome}/*`]),
  outExtension: () => ({ js: ".js", dts: ".d.ts" }),
  dts: { resolve: [/^@fiscal\//], compilerOptions: { composite: false } },
  tsconfig: join(raiz, "packages/agente/tsconfig.json"),
  silent: true,
});
// O tsup gera os tipos como .d.mts; o package.json aponta para .d.ts
for (const nome of readdirSync(join(pastaAgente, "dist"))) {
  if (nome.endsWith(".d.mts")) {
    const de = join(pastaAgente, "dist", nome);
    writeFileSync(
      de.replace(/\.d\.mts$/, ".d.ts"),
      readFileSync(de, "utf8").replaceAll(".mjs'", ".js'"),
    );
    rmSync(de);
  }
}
writeFileSync(
  join(pastaAgente, "package.json"),
  `${JSON.stringify(
    {
      name: `${ESCOPO}/fiscal-agente`,
      version: agente.version,
      description: agente.description,
      license: "UNLICENSED",
      type: "module",
      main: "./dist/index.js",
      types: "./dist/index.d.ts",
      exports: {
        ".": { types: "./dist/index.d.ts", default: "./dist/index.js" },
        "./electron": { types: "./dist/electron.d.ts", default: "./dist/electron.js" },
      },
      files: ["dist", "INTEGRAR.md"],
      engines: { node: ">=20" },
      dependencies: dependenciasExternas(),
      repository: REPOSITORIO,
      publishConfig: { registry: REGISTRO },
    },
    null,
    2,
  )}\n`,
);
cpSync(join(raiz, "INTEGRAR.md"), join(pastaAgente, "INTEGRAR.md"));

// ---- @sull-s/fiscal-ui (não depende de outros módulos internos: é só renomear)
const ui = ler("packages/ui/package.json");
const pastaUi = join(saida, "fiscal-ui");
if (!existsSync(join(raiz, "packages/ui/dist/index.js"))) throw new Error("Rode pnpm build antes.");
cpSync(join(raiz, "packages/ui/dist"), join(pastaUi, "dist"), { recursive: true });
cpSync(join(raiz, "packages/ui/README.md"), join(pastaUi, "README.md"));
const { devDependencies, scripts, ...uiPublico } = ui;
writeFileSync(
  join(pastaUi, "package.json"),
  `${JSON.stringify({ ...uiPublico, name: `${ESCOPO}/fiscal-ui`, repository: REPOSITORIO, publishConfig: { registry: REGISTRO } }, null, 2)}\n`,
);

for (const pasta of [pastaAgente, pastaUi]) {
  const pacote = JSON.parse(readFileSync(join(pasta, "package.json"), "utf8"));
  if (publicar) publicarPacote(pasta);
  else console.log(`${pacote.name}@${pacote.version} → ${empacotar(pasta)}`);
}
if (publicar) console.log("Publicado no GitHub Packages.");
