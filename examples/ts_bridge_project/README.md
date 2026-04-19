## vite-plugin-moonbit TypeScript bridge example

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

- `src/gen/math_bridge/moon.pkg.json`
- `src/gen/math_bridge/bridge.mbti`
- `src/gen/math_bridge/bridge.mbt`
- `src/gen/math_bridge/bridge.js`

The plugin detects `internal/app/gen/math_bridge` from `src/moon.pkg` and
injects the generated bridge bindings automatically when `mbt:internal/app`
is loaded.

If you also have a local `mizchi/ts.mbt` checkout, `vite.config.ts` enables
`tsBridge` automatically and regenerates the bridge package when
`src/api/math.ts` changes.

To regenerate the bridge package manually:

```bash
moon -C ../../../ts.mbt run src -- emit-moonbit-bridge-package \
  "$PWD/src/api/math.ts" \
  /src/api/math.ts \
  "$PWD/src/gen/math_bridge"
```
