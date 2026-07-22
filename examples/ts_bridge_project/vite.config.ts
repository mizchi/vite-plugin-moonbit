import { existsSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";
import moonbit from "vite-plugin-moonbit";

const generatorRoot = process.env.TS_MBT_GENERATOR_ROOT
  ? path.resolve(process.env.TS_MBT_GENERATOR_ROOT)
  : path.resolve(__dirname, "../../../ts.mbt");
const generatorCommand = process.env.TS_MBT_GENERATOR_COMMAND;
const hasGenerator =
  existsSync(path.join(generatorRoot, "moon.mod")) ||
  existsSync(path.join(generatorRoot, "moon.mod.json"));
const enableNormalizedDts = process.env.TS_MBT_ENABLE_NORMALIZED_DTS === "1";
const enableRuntimeValidation =
  process.env.TS_MBT_RUNTIME_VALIDATION === "1";
const enableNpmPackage = process.env.TS_MBT_ENABLE_NPM_PACKAGE === "1";
const bundleNpmPackage = process.env.TS_MBT_NPM_BUNDLE !== "0";
const npmPackageName = process.env.TS_MBT_NPM_NAME;
const npmPackageVersion = process.env.TS_MBT_NPM_VERSION;

export default defineConfig({
  root: __dirname,
  plugins: [
    moonbit({
      root: __dirname,
      watch: true,
      showLogs: true,
      tsBridge: hasGenerator
        ? {
            generatorRoot,
            command: generatorCommand,
            runtimeValidation: enableRuntimeValidation,
            entries: ["./src/api/math.ts"],
          }
        : undefined,
      normalizedDts: hasGenerator && enableNormalizedDts
        ? {}
        : undefined,
      npmPackage: hasGenerator && enableNpmPackage
        ? {
            entry: "internal/app",
            outDir: "dist/npm",
            facade: true,
            bundle: bundleNpmPackage,
            name: npmPackageName,
            version: npmPackageVersion,
          }
        : undefined,
    }),
  ],
  server: {
    port: 3456,
  },
});
