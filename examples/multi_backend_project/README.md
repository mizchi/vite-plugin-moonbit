# multi_backend_project

Single MoonBit module with two packages targeting **different backends**:

- `my` (root package, `supported_targets = "js"`) — `greet()` runs on the
  JS backend and powers the main thread.
- `my/heavy` (`supported_targets = "wasm-gc"`) — `fibonacci()` is compiled
  to Wasm and loaded inside a Web Worker.

The Vite plugin is instantiated twice, once per backend, using distinct
import prefixes:

```ts
// vite.config.ts
export default defineConfig({
  plugins: [
    moonbit({ target: 'js' }),                       // mbt:*
    moonbit({ target: 'wasm-gc', prefix: 'mbtw:' }), // mbtw:*
  ],
});
```

```ts
// main.ts (runs in the browser main thread, JS backend)
import { greet } from 'mbt:my';

// worker.ts (runs in a Web Worker, wasm-gc backend)
import init from 'mbtw:my/heavy';
```

Each plugin instance spawns its own `moon build --watch --target <t>`, so
both backends are rebuilt incrementally during `pnpm dev`.

## Layout

```
multi_backend_project/
├── moon.mod.json
├── src/
│   ├── moon.pkg           # js package
│   ├── app.mbt            # pub fn greet()
│   └── heavy/
│       ├── moon.pkg       # wasm-gc package
│       └── heavy.mbt      # pub fn fibonacci(n : Int) -> Int
├── main.ts
├── worker.ts
├── vite.config.ts
└── package.json
```

## Run

```bash
cd examples/multi_backend_project
moon build --release --target js
moon build --release --target wasm-gc
pnpm install
pnpm dev
```
