import { defineConfig } from "tsup";

export default defineConfig([
  // Biblioteca (para embutir num app ou montar um servidor próprio)
  { entry: ["src/index.ts"], format: ["esm"], dts: true, sourcemap: true, clean: true },
  // Programa de linha de comando (agente local, servidor)
  { entry: ["src/principal.ts"], format: ["esm"], sourcemap: true },
]);
