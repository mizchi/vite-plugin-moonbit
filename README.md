# vite-plugin-moonbit

Vite plugin for MoonBit projects. Supports both JS and WASM-GC backends.

## Features

- Import resolution via `mbt:` prefix
- Auto-starts `moon build --watch`
- HMR on file changes
- JS and WASM-GC backend support
- MoonBit workspace (`moon.work`) / monorepo support
- Understands `moon.pkg` / `moon.work` DSL (parsed by a MoonBit-native
  parser built from `moonbitlang/parser`)
- `mbt:` imports support `?worker`, `?url`, `?raw` query suffixes
- Source maps forwarded so `.mbt` sources are debuggable in browser devtools
- Auto-detects `use-js-builtin-string` from `moon.pkg` for `wasm-gc`
- Mix multiple backends in one project (e.g. JS for the main thread,
  wasm-gc inside a Web Worker) by instantiating the plugin twice with
  distinct `prefix` options
- Optional TypeScript bridge package generation via `mizchi/ts.mbt`

## Install

```bash
pnpm add -D vite-plugin-moonbit
```

```js
// vite.config.ts
import { defineConfig } from 'vite';
import { moonbit } from 'vite-plugin-moonbit';

export default defineConfig({
  plugins: [
    moonbit({
      target: "js",
      // run: `moon build --target js --watch` in vite
      // If you want to build manually, set `false` and `moon build`
      watch: true
    })
  ],
});
```

## Quick Start

```bash
npx tiged github:mizchi/vite-plugin-moonbit/examples/js_project myapp
cd myapp && pnpm install
moon build && pnpm dev
```

## Usage

### JS Backend (default)

```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import moonbit from 'vite-plugin-moonbit';

export default defineConfig({
  plugins: [moonbit()]
});
```

```typescript
// main.ts
import { greet } from 'mbt:username/app';
```

Optional: `tsconfig.json`'s paths

```json
{
  "compilerOptions": {
    // ...
    "paths": {
      "mbt:internal/app": [
        "./_build/js/release/build/app.js"
      ]
    }
  }
}
```

See [examples/js_project](./examples/js_project)

Check out: `npx tiged mizchi/vite-plugin-moonbit/examples/wasm_project myapp`

### WASM-GC Backend

```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import moonbit from 'vite-plugin-moonbit';

export default defineConfig({
  plugins: [moonbit({ target: 'wasm-gc' })]
});
```

```typescript
// main.ts
import init from './_build/wasm-gc/release/build/app.wasm?init';

const instance = await init();
const { add } = instance.exports as { add: (a: number, b: number) => number };
add(1, 2);
```

See [examples/wasm_project](./examples/wasm_project)

Check out: `npx tiged mizchi/vite-plugin-moonbit/examples/wasm_project myapp`

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `root` | `string` | `cwd()` | MoonBit project root |
| `watch` | `boolean` | `true` (dev) | Run `moon build --watch` |
| `target` | `'js' \| 'wasm' \| 'wasm-gc'` | `'js'` | Build target |
| `showLogs` | `boolean` | `true` | Show build logs |
| `prefix` | `string` | `'mbt:'` | Import prefix for this plugin instance |
| `tsBridge` | `MoonbitTsBridgeOptions` | `undefined` | Generate MoonBit bridge packages from TS entrypoints before build |

### TypeScript bridge packages

Use `tsBridge` when MoonBit should consume a TypeScript entrypoint through a
generated typed bridge package.

```ts
// vite.config.ts
import { defineConfig } from "vite";
import moonbit from "vite-plugin-moonbit";

export default defineConfig({
  plugins: [
    moonbit({
      root: "./moonbit-app",
      tsBridge: {
        generatorRoot: "../ts.mbt",
        entries: [
          {
            entry: "./src/api/client.ts",
            moduleSpec: "/src/api/client.ts",
            outDir: "src/gen/client_bridge",
          },
        ],
      },
    }),
  ],
});
```

Use a non-relative `moduleSpec` whenever possible, for example
`/src/api/client.ts`, `node:fs`, or a bare package name. The generator can emit
leaner MoonBit FFI for non-relative specifiers. Relative specs like
`./client.ts` still work, but they force more bindings through generated
`bridge.js` wrappers because MoonBit `#module("...")` does not currently accept
relative module paths.

This runs:

```bash
moon -C ../ts.mbt run src -- emit-moonbit-bridge-package \
  /abs/path/to/src/api/client.ts \
  /src/api/client.ts \
  /abs/path/to/moonbit-app/src/gen/client_bridge
```

The generated package contains:

- `moon.pkg.json`
- `bridge.mbti`
- `bridge.mbt`
- `bridge.js`

Everything inside `outDir` is generated. The surrounding MoonBit package that
imports that bridge package remains hand-written.

When a MoonBit package imports the generated bridge package, the plugin reads
that package's `bridge.js` exports and injects the needed bindings into the
compiled MoonBit JS module automatically.

Today `bridge.js` is still needed for some surfaces even with a non-relative
`moduleSpec`, especially static class members, value exports, and namespace-like
exports. Plain exported functions, instance members, and class constructors are
already emitted with less wrapper code when direct `#module("...")` imports are
available.

See [examples/ts_bridge_project](./examples/ts_bridge_project) for a complete
example that checks in the generated bridge package and wraps a TypeScript
entrypoint from MoonBit.

## Path Resolution

The plugin searches upward from `root` for `moon.work` / `moon.work.json`
(workspace) first, then for `moon.mod.json` (single module). The resolved
project root is where `_build/` is expected.

### Single module (legacy layout)

| Import | JS | WASM-GC |
|---|---|---|
| `mbt:user/pkg` | `_build/js/release/build/pkg.js` | `_build/wasm-gc/release/build/pkg.wasm` |
| `mbt:user/pkg/sub` | `_build/js/release/build/sub/sub.js` | `_build/wasm-gc/release/build/sub/sub.wasm` |

### Workspace (`moon.work`, multi-root layout)

Module name segments are inserted before the package path. `mbt:` imports are
matched against every workspace member's `moon.mod.json#name` by longest
prefix, so all members share one resolver.

| Import | JS |
|---|---|
| `mbt:internal/app` | `_build/js/release/build/internal/app/app.js` |
| `mbt:internal/shared` | `_build/js/release/build/internal/shared/shared.js` |
| `mbt:internal/app/util` | `_build/js/release/build/internal/app/util/util.js` |

See [examples/monorepo_project](./examples/monorepo_project) for a full
working workspace with two members (`internal/app` depends on
`internal/shared` via a path `deps`).

```
// moon.work (at the workspace root)
members = [
  "./app",
  "./shared",
]
```

When running in workspace mode, `moon build --watch` is spawned at the
workspace root so all members are built together into a single `_build/`.

### Virtual / implement / overrides

MoonBit's `moon.pkg.json` supports three fields for swappable implementations:

- `"virtual": { "has-default": bool }` — interface-only package (signatures
  declared in `pkg.mbti`)
- `"implement": "user/mod/iface"` — a package that implements the above
- `"overrides": ["user/mod/impl_x"]` — a main/app package selects which
  implementation to link

These are resolved entirely by moon's linker; the plugin serves the final
`.js` output transparently. Virtual and implement-only packages produce only
`.mi`/`.core` intermediates (no runtime `.js`); trying to `import 'mbt:<virtual>'`
directly prints a hint pointing to the app package that owns the `overrides`.

See [examples/overrides_project](./examples/overrides_project).

### Multiple backends in one project

Instantiate the plugin per backend with a unique `prefix`:

```ts
// vite.config.ts
const plugins = [
  moonbit({ target: 'js' }),                        // mbt:*
  moonbit({ target: 'wasm-gc', prefix: 'mbtw:' }),  // mbtw:*
];
export default defineConfig({
  plugins,
  worker: {
    format: 'es',
    plugins: () => [
      moonbit({ target: 'wasm-gc', prefix: 'mbtw:', watch: false }),
    ],
  },
});
```

```ts
// main.ts — runs on JS backend
import { greet } from 'mbt:my';

// worker.ts — runs as a Web Worker using the wasm-gc backend
import init from 'mbtw:my/heavy';
```

See [examples/multi_backend_project](./examples/multi_backend_project) for a
complete setup that offloads CPU-heavy work to a Wasm-GC worker while the
main thread stays on the JS backend.

## License

MIT
