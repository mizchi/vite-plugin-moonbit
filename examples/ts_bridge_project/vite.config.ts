import { existsSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";
import moonbit from "vite-plugin-moonbit";

const generatorRoot = process.env.TS_MBT_GENERATOR_ROOT
  ? path.resolve(process.env.TS_MBT_GENERATOR_ROOT)
  : path.resolve(__dirname, "../../../ts.mbt");
const generatorCommand = process.env.TS_MBT_GENERATOR_COMMAND;
const hasGenerator = existsSync(path.join(generatorRoot, "moon.mod.json"));

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
            entries: ["./src/api/math.ts"],
          }
        : undefined,
    }),
  ],
  server: {
    port: 3456,
  },
});
