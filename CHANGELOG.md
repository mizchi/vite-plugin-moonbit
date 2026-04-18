# Changelog

## [0.2.0](https://github.com/mizchi/vite-plugin-moonbit/compare/vite-plugin-moonbit-v0.1.5...vite-plugin-moonbit-v0.2.0) (2026-04-18)


### Features

* MoonBit-based DSL parser, source maps, ?worker, auto js-builtin-string ([502de7c](https://github.com/mizchi/vite-plugin-moonbit/commit/502de7cd8773e5126ff8a30b70f3e0c2c0473745))
* MoonBit-based DSL parser, source maps, ?worker, auto js-builtin-string ([8c61b13](https://github.com/mizchi/vite-plugin-moonbit/commit/8c61b130b597efe87a9e5052db4a39393341cc94))
* moonc diagnostics in Vite error overlay + migrate examples to moon.pkg DSL ([e1afcaa](https://github.com/mizchi/vite-plugin-moonbit/commit/e1afcaade9162b17b2bc5440e55617ed222a918c))
* support js-string-builtins for wasm-gc target ([3d4b905](https://github.com/mizchi/vite-plugin-moonbit/commit/3d4b9050de5e7c7a187aa78218b4288feea3c822))
* support js-string-builtins for wasm-gc target ([f3ce1c4](https://github.com/mizchi/vite-plugin-moonbit/commit/f3ce1c4a45bb879e03fb73d107fbed081b6ac542))
* support moon.work workspaces (monorepo) ([8c352e9](https://github.com/mizchi/vite-plugin-moonbit/commit/8c352e98d30f481d184c8b7a6f03f6192285bee4))
* support moon.work workspaces (monorepo) ([b36b217](https://github.com/mizchi/vite-plugin-moonbit/commit/b36b217fcf407a706e6226e345762c965cf97edf))
* support moonbit override semantics (virtual / implement / overrides) ([8448e99](https://github.com/mizchi/vite-plugin-moonbit/commit/8448e993ea98e2d654c1824807cee5fd7d69628d))
* support moonbit override semantics (virtual / implement / overrides) ([6e6d048](https://github.com/mizchi/vite-plugin-moonbit/commit/6e6d04825a12c0f0956dbe7393b624f7be119c42))
* surface moonc diagnostics in Vite's error overlay ([3923aea](https://github.com/mizchi/vite-plugin-moonbit/commit/3923aea43be73a2aba44e77bb3ddfd53610b5a66))
* targeted HMR + parser key normalization ([a5ec411](https://github.com/mizchi/vite-plugin-moonbit/commit/a5ec411edc6eead6661d3e57e8c7b2693a088294))
* targeted HMR + parser key normalization ([69fcecc](https://github.com/mizchi/vite-plugin-moonbit/commit/69fcecca4b3c1c86f4cab1acb53cc3f068e06753))


### Bug Fixes

* **hmr,parser:** address Codex review ([39d1dc2](https://github.com/mizchi/vite-plugin-moonbit/commit/39d1dc26907051d4eca21c575c60c3017648dce5))
* **overlay:** buffer stdout/stderr lines across chunk boundaries ([b9390cc](https://github.com/mizchi/vite-plugin-moonbit/commit/b9390cc6103c7a055936278344dd00c2c0bcdab5))
* **parser:** flatten options(...) to top level for DSL / JSON parity ([91de727](https://github.com/mizchi/vite-plugin-moonbit/commit/91de72709cf34eb33f7ca8b0a347ed89b916488d))
* respect workspace membership and single-member layout ([9019324](https://github.com/mizchi/vite-plugin-moonbit/commit/90193248bae5a49630a91ddaa52d53d6913f3de2))
* use Vite root for WASM path resolution in load hook ([a71044c](https://github.com/mizchi/vite-plugin-moonbit/commit/a71044c1564de71efa6e01889047e755bc3ab42d))
* use Vite root for WASM path resolution in load hook ([3179814](https://github.com/mizchi/vite-plugin-moonbit/commit/317981417f160c84fed8db31133a463c32984e64))
