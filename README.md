# vite-plugin-moonbit

Vite plugin for MoonBit projects. Supports both JS and WASM-GC backends.

## Features

- Import resolution via `mbt:` prefix
- Auto-starts `moon build --watch`
- HMR on file changes
- JS and WASM-GC backend support
- MoonBit workspace (`moon.work`) / monorepo support

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
      // If you want to bulid manually, set `false` and `moon build`
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

## License

MIT
