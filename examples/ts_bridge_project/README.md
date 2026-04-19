## vite-plugin-moonbit TypeScript bridge example

```bash
$ npx tiged github:mizchi/vite-plugin-moonbit/examples/ts_bridge_project myapp
$ cd myapp
$ npm install
$ moon build
$ pnpm vite dev
```

`src/api/math.ts` is a normal TypeScript entrypoint.
`src/gen/math_bridge` is the generated MoonBit bridge package committed to this example.
The plugin detects `internal/app/gen/math_bridge` from `src/moon.pkg` and
injects the generated bridge bindings automatically when `mbt:internal/app`
is loaded.

If you also have a local `mizchi/ts.mbt` checkout, `vite.config.ts` enables
`tsBridge` automatically and regenerates the bridge package when
`src/api/math.ts` changes.
