# vite-plugin-moonbit

Vite plugin for MoonBit projects. Supports both JS and WASM-GC backends.

## Features

- Import resolution via `mbt:` prefix
- Auto-starts `moon build --watch`
- HMR on file changes
- JS and WASM-GC backend support

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

| Import | JS Backend | WASM-GC Backend |
|--------|------------|-----------------|
| `mbt:user/pkg` | `_build/js/release/build/pkg.js` | `_build/wasm-gc/release/build/pkg.wasm` |

## License

MIT
