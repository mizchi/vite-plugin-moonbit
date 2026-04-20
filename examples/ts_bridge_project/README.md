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

The second argument is the runtime `moduleSpec`. Keep it non-relative if you
can. `/src/api/math.ts` is better than `./src/api/math.ts` here, because
non-relative specs let the generator emit smaller MoonBit FFI with fewer
wrapper bindings. Relative specs still work, but they fall back to more
generated `bridge.js` glue.

In the checked-in `vite.config.ts`, this is now the shorthand form:

```ts
tsBridge: {
  generatorRoot,
  entries: ["./src/api/math.ts"],
}
```

That infers:

- `moduleSpec`: `/src/api/math.ts`
- `outDir`: `src/gen/math_bridge`
