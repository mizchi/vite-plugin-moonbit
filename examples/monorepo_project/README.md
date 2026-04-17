# monorepo_project (moon.work workspace)

MoonBit v0.9+ で追加された `moon work` (workspace / monorepo) 機能の動作確認用サンプル。

## 構成

```
monorepo_project/
├── moon.work              # ワークスペースマニフェスト (TOML 風 DSL)
├── app/                   # メンバー 1: internal/app
│   ├── moon.mod.json      #   deps に path: "../shared"
│   └── src/
│       ├── lib.mbt        #   @shared.banner() を呼び出す
│       └── moon.pkg.json
├── shared/                # メンバー 2: internal/shared
│   ├── moon.mod.json
│   └── src/
│       ├── lib.mbt
│       └── moon.pkg.json
├── main.ts                # mbt:internal/app と mbt:internal/shared を import
├── vite.config.ts
└── package.json
```

## moon.work

```
members = [
  "./app",
  "./shared",
]
preferred_target = "js"
```

`moon work init ./app ./shared` で自動生成される想定のファイル。JSON ではなく TOML 風の mini-DSL である点に注意 (ファイル名も `moon.work`、`moon.work.json` ではない)。

## ビルド成果物レイアウト

workspace モードでは moon の build artifact layout が **multi-root** に切り替わり、モジュール名セグメントが 1 階層挿入される:

| モード | 出力パス (JS バックエンド) |
|---|---|
| 単一モジュール | `_build/js/release/build/<pkg>/<pkg>.js` |
| **workspace** | `_build/js/release/build/<module_name>/<pkg>/<pkg>.js` |

このサンプルでは以下を想定:

- `mbt:internal/app`    → `_build/js/release/build/internal/app/app.js`
- `mbt:internal/shared` → `_build/js/release/build/internal/shared/shared.js`

`.mooncakes/` と `_build/` は **ワークスペースルート直下に 1 つだけ** 生成される (メンバーごとには作られない)。

## 現状の vite-plugin-moonbit との互換性

現行 resolver (`src/index.ts`) は単一モジュール前提のため、このサンプルはそのままでは動かない:

1. `readModuleInfo()` が `root/moon.mod.json` を読もうとするが、ワークスペースルートには無いので `null` になり警告が出る。
2. `resolveModulePath()` のパス組み立てに `<module_name_segments>` の階層が足りず、成果物を発見できない。
3. 複数モジュールに対応するため、`mbt:<user>/<mod>/...` の `<user>/<mod>` 部分を全メンバーの `moon.mod.json` の `name` に対して照合する必要がある。

拡張方針:

- `root` から上方向に `moon.work` を探索し、見つかれば workspace モードに切り替え
- `members` を読んで各メンバーの `moon.mod.json` をロード (name, source のマップ構築)
- インポート `mbt:X/Y/...` を最長一致で該当メンバーに振り分け、出力パスは multi-root レイアウトで解決
- `moon build --watch` はワークスペースルートで起動 (moon が `moon.work` を自動検出)

## 実行

> **注意**: 現行の plugin (0.1.x) ではこのサンプルは resolver エラーで落ちる。拡張実装後に動作する想定。

```bash
# 事前に moon v0.9+ が必要
cd examples/monorepo_project
moon build          # _build/ がワークスペース直下に作られる
pnpm install
pnpm dev
```
