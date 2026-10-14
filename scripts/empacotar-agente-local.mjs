#!/usr/bin/env node
/**
 * Monta o pacote do Agente Fiscal (API rodando no PC do cliente) em saida/AgenteFiscal.zip.
 *
 *   pnpm build && node scripts/empacotar-agente-local.mjs
 *
 * O pacote leva o node.exe deste computador (o cliente não precisa instalar nada), a API com as
 * dependências de produção e os instaladores de apps/agente-local. Não leva certificado, senha
 * nem dado de cliente: a configuração é criada no PC do cliente na instalação.
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

if (process.platform !== "win32") {
  console.error("Rode no Windows: o pacote leva o node.exe deste computador.");
  process.exit(1);
}

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fonte = join(raiz, "apps", "agente-local");
const saida = join(raiz, "saida");
const pacote = join(saida, "AgenteFiscal");
const temporario = join(saida, "_deploy");

if (!existsSync(join(raiz, "apps", "api", "dist", "principal.js"))) {
  console.error("Falta apps/api/dist: rode `pnpm build` antes.");
  process.exit(1);
}

rmSync(saida, { recursive: true, force: true });
mkdirSync(pacote, { recursive: true });

console.log("Juntando a API com as dependências de produção…");
// node-linker=hoisted: node_modules sem atalhos (junções do Windows não sobrevivem ao ZIP)
execFileSync(
  "pnpm",
  ["--filter", "@fiscal/api", "--config.node-linker=hoisted", "deploy", "--prod", temporario],
  {
    cwd: raiz,
    stdio: "inherit",
    shell: true,
  },
);

const app = join(pacote, "programa", "app");
mkdirSync(app, { recursive: true });
// Só o que roda: sem fontes, testes nem o certificado de teste
for (const item of ["dist", "node_modules", "package.json"])
  cpSync(join(temporario, item), join(app, item), { recursive: true });
rmSync(join(app, "node_modules", ".bin"), { recursive: true, force: true });
rmSync(temporario, { recursive: true, force: true });

cpSync(process.execPath, join(pacote, "programa", "node.exe"));

// .bat/.cmd precisam de CRLF (com LF o "goto" falha); .ps1 precisa de BOM para os acentos no
// Windows PowerShell 5.1
const crlf = (texto) => texto.replace(/\r?\n/g, "\r\n");
const copiarTexto = (de, para, bom = false) =>
  writeFileSync(para, (bom ? "﻿" : "") + crlf(readFileSync(de, "utf8")), "utf8");
copiarTexto(join(fonte, "programa", "iniciar.cmd"), join(pacote, "programa", "iniciar.cmd"));
for (const nome of readdirSync(fonte)) {
  if (/\.(bat|cmd)$/i.test(nome)) copiarTexto(join(fonte, nome), join(pacote, nome));
  else if (/\.ps1$/i.test(nome)) copiarTexto(join(fonte, nome), join(pacote, nome), true);
  else if (nome === "LEIA-ME.txt") copiarTexto(join(fonte, nome), join(pacote, nome), true);
}

console.log("Compactando…");
// tar do Windows (bsdtar) grava ZIP e não sofre com caminhos longos como o Compress-Archive
// Caminho fixo: no Git Bash o "tar" do PATH é o GNU, que grava .tar mesmo com nome .zip
const tar = join(process.env.SystemRoot ?? "C:/Windows", "System32", "tar.exe");
execFileSync(tar, ["-a", "-c", "-f", "AgenteFiscal.zip", "AgenteFiscal"], {
  cwd: saida,
  stdio: "inherit",
});
console.log(`Pronto: ${join(saida, "AgenteFiscal.zip")} (node ${process.version})`);
