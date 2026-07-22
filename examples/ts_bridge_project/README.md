## vite-plugin-moonbit TypeScript bridge example

This example uses the current experimental `tsBridge` flow. The generated
package shape is already usable, but the API and emitted glue are still subject
to change while the integration is being hardened.

```bash
$ npx tiged github:mizchi/vite-plugin-moonbit/examples/ts_bridge_project myapp
$ cd myapp
$ pnpm install
$ moon build
$ pnpm vite dev
```

### Hand-written files

- `src/api/math.ts`
  - normal TypeScript entrypoint
- `src/lib.mbt`
  - MoonBit wrapper that calls the generated bridge package
- `src/moon.pkg`
  - imports the generated bridge package as `internal/app/gen/math_bridge`
- `vite.config.ts`
  - enables `tsBridge` when a local `mizchi/ts.mbt` checkout exists

### Generated files

Everything under `src/gen/math_bridge/` is generated:

- `src/gen/math_bridge/moon.pkg`
- `src/gen/math_bridge/bridge.mbti`
- `src/gen/math_bridge/bridge.mbt`
- `src/gen/math_bridge/bridge.js`
- `src/gen/math_bridge/package.json`

The plugin detects `internal/app/gen/math_bridge` from `src/moon.pkg` and
injects the generated bridge bindings automatically when `mbt:internal/app`
is loaded.

If you also have a local `mizchi/ts.mbt` checkout, `vite.config.ts` enables
`tsBridge` automatically and regenerates the bridge package when
`src/api/math.ts` or one of its local TS/TSX dependencies changes.

The same `vite.config.ts` also accepts the experimental `normalizedDts`
integration through an environment flag. When enabled, the plugin rewrites
MoonBit-generated `_build/.../*.d.ts` files in place after each build so the
published TypeScript surface is easier to read. This only happens on the Vite
plugin path. If you run `moon build` directly, run the normalizer yourself
after build.

```bash
TS_MBT_ENABLE_NORMALIZED_DTS=1 \
pnpm vite dev
```

For generated structural runtime validators, opt in explicitly:

```bash
TS_MBT_RUNTIME_VALIDATION=1 pnpm vite dev
```

This makes the plugin invoke `ts2mbt package-validated` and adds public
`validate<Type>(value : JSValue) -> Type?` functions to the generated package.

### npm packages and Node built-ins

`tsBridge.entries` can also resolve a package declaration directly. This keeps
the package name at the Vite boundary while MoonBit imports only the generated,
typed bridge package. A package root uses its `types`/`typings` declaration;
for a package subpath, the plugin resolves that subpath's declaration file.

This example can generate a bridge for Node's `fs` API. (The checked-in
`src/api/math.ts` is the companion example for a hand-written TypeScript
module.) Install the declarations in a standalone copy of the example, then
enable the optional entry:

```bash
pnpm add -D @types/node
TS_MBT_ENABLE_NODE_FS_BRIDGE=1 pnpm vite build
```

The relevant Vite configuration is:

```ts
tsBridge: {
  generatorRoot,
  entries: [
    "./src/api/math.ts",
    {
      package: "@types/node/fs",
      moduleSpec: "node:fs",
      outDir: "src/gen/node_fs_bridge",
    },
  ],
}
```

MoonBit can then import `internal/app/gen/node_fs_bridge` as an ordinary
generated package. Keep the `node:fs` bridge in a Vite SSR or Node-only MoonBit
entrypoint; it cannot run in a browser bundle.

For example, after generation a Node-only MoonBit package can use the emitted
typed API directly:

```moonbit
import "internal/app/gen/node_fs_bridge" @fs

pub fn file_exists(filepath : String) -> Bool {
  @fs.existsSync(@fs.path_like_from_string(filepath))
}
```

This example keeps `normalizedDts` opt-in because it is still experimental.
It reuses the same `generatorRoot` and `command` as `tsBridge`, so the config
can stay as `normalizedDts: {}`. It is useful when your editor or downstream
TypeScript project should see `number` / `string` instead of
`MoonBit.Double` / `MoonBit.String` in the generated declarations.

To normalize generated declarations manually:

```bash
moon -C ../../../ts.mbt run src/cmd/mbt2ts -- normalize \
  "$PWD/_build/js/release/build/app.d.ts" \
  "$PWD/_build/js/release/build/app.d.ts"
```

To regenerate the bridge package manually:

```bash
moon -C ../../../ts.mbt run src/cmd/ts2mbt -- package \
  "$PWD/src/api/math.ts" \
  /src/api/math.ts \
  "$PWD/src/gen/math_bridge"
```

The second argument is the runtime `moduleSpec`. Keep it non-relative if you
can. `/src/api/math.ts` is better than `./src/api/math.ts` here, because
non-relative specs let the generator emit smaller MoonBit FFI with fewer
wrapper bindings. Relative specs still work, but they fall back to more
generated `bridge.js` glue.

### Publish the MoonBit API as npm

Set `TS_MBT_ENABLE_NPM_PACKAGE=1` for the example's Vite build to emit a
publishable package in `dist/npm`. It contains bundled ESM, `index.d.ts`, and
`package.json`; the local TypeScript bridge is bundled into `index.js`, so npm
consumers do not need this MoonBit project or `@tsmbt-bridge/*` at runtime.

```bash
TS_MBT_ENABLE_NPM_PACKAGE=1 \
TS_MBT_GENERATOR_ROOT=/path/to/ts.mbt \
TS_MBT_NPM_NAME=@acme/moonbit-math \
TS_MBT_NPM_VERSION=0.1.0 \
pnpm exec vite build --config vite.config.ts

cd dist/npm
npm pack --dry-run
# npm publish
```

The name and version flags map directly to `npmPackage.name` and
`npmPackage.version`; set them in your real Vite config instead of environment
variables when they are stable for the project.

In the checked-in `vite.config.ts`, this is now the shorthand form:

```ts
tsBridge: {
  generatorRoot,
  runtimeValidation: false, // set true for explicit JS boundary validators
  entries: ["./src/api/math.ts"],
}
```

That infers:

- `moduleSpec`: `/src/api/math.ts`
- `outDir`: `src/gen/math_bridge`
