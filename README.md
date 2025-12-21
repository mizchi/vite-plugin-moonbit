# vite-plugin-moonbit

Vite plugin for MoonBit projects.

## Features

- Import resolution via `mbt:` prefix
- Auto-starts `moon build --watch`
- HMR on file changes
- TypeScript support with MoonBit-generated `.d.ts`

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
import { greet } from 'mbt:username/project';
import { helper } from 'mbt:username/project/lib';
```

## TypeScript Support

Add path mappings in `tsconfig.json`:

```json
{
  "compilerOptions": {
    "paths": {
      "mbt:username/project": ["./target/js/release/build/project.d.ts"],
      "mbt:username/project/lib": ["./target/js/release/build/lib/lib.d.ts"]
    }
  }
}
```

## Path Resolution

| Import | Resolves to |
|--------|-------------|
| `mbt:user/pkg` | `target/js/release/build/pkg.js` |
| `mbt:user/pkg/lib` | `target/js/release/build/lib/lib.js` |

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `root` | `string` | `cwd()` | MoonBit project root |
| `watch` | `boolean` | `true` (dev) | Run `moon build --watch` |
| `target` | `'release' \| 'debug'` | `'release'` | Build target |
| `showLogs` | `boolean` | `true` | Show build logs |

## License

MIT
