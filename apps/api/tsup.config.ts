import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/principal.ts"],
  format: ["esm"],
  sourcemap: true,
  clean: true,
});
