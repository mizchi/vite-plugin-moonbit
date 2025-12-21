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

## Quick Start

```bash
npx tiged github:mizchi/vite-plugin-moonbit/example myapp
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
        "./target/js/release/build/app.js"
      ]
    }
  }
}
```



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
import init from './target/wasm-gc/release/build/app.wasm?init';

const instance = await init();
const { add } = instance.exports as { add: (a: number, b: number) => number };
add(1, 2);
```

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
| `mbt:user/pkg` | `target/js/release/build/pkg.js` | `target/wasm-gc/release/build/pkg.wasm` |

## License

MIT
