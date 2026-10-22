import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/electron.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
});
