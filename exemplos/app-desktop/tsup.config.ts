import { copyFileSync, mkdirSync } from "node:fs";
import { defineConfig } from "tsup";

// Só a TELA é empacotada (React + @fiscal/ui num arquivo); o processo principal (principal.mjs)
// roda direto no Node do Electron e importa @fiscal/agente normalmente.
export default defineConfig({
  entry: { tela: "tela/app.tsx" },
  outDir: "tela/dist",
  format: ["iife"],
  platform: "browser",
  noExternal: [/.*/],
  minify: true,
  clean: true,
  define: { "process.env.NODE_ENV": '"production"' },
  async onSuccess() {
    mkdirSync("tela/dist", { recursive: true });
    copyFileSync("node_modules/@fiscal/ui/dist/estilos.css", "tela/dist/fiscal.css");
  },
});
