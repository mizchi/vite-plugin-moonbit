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

`moon work init ./app ./shared` で実際に生成されるファイルと同じ形式 (空行を挟む)。
JSON ではなく TOML 風の mini-DSL であり、ファイル名は `moon.work` (`moon.work.json` も受理される、`moon work --help` の `--manifest-path` 参照)。

## 確認したビルド成果物レイアウト

`moon build --target js` 実行後 (実環境で確認済み):

```
_build/
├── .moon-lock
└── js/
    ├── debug/build/
    │   ├── all_pkgs.json
    │   ├── build.moon_db
    │   ├── internal/app/
    │   │   ├── app.js
    │   │   ├── app.mi
    │   │   ├── app.core
    │   │   ├── app.d.ts
    │   │   └── ...
    │   └── internal/shared/
    │       ├── shared.js
    │       ├── shared.mi
    │       └── ...
    └── release/build/
        ├── internal/app/app.js
        └── internal/shared/shared.js
```

ポイント:

- `_build/` と `.mooncakes/` は **ワークスペースルート直下に 1 つだけ**。メンバーごとには作られない。
- 成果物は **multi-root layout**: `_build/<backend>/<mode>/build/<module_name_segments>/<pkg_segments>/<short_alias>.<ext>`
- モジュール名のセグメント (例: `internal/app`) が 1 階層挿入されるため、単一モジュール時の `_build/js/release/build/app.js` とは **パスが異なる**。
- `moon build` のデフォルトは `debug` (単一モジュールと同様)。release は `--release` で明示指定。
- JS バックエンドでは依存モジュールの関数はインライン化されてエントリの `.js` に取り込まれる (`app.js` の中に `banner` の本体が展開される)。

## 現行 vite-plugin-moonbit (0.1.5) との互換性

実際に `pnpm vite build` を実行すると以下のエラー (実測):

```
[moonbit] Could not find moon.mod.json in /.../examples/monorepo_project
[moonbit] Could not resolve: mbt:internal/app -> unknown
[moonbit] Could not resolve: mbt:internal/shared -> unknown
Error: [vite]: Rolldown failed to resolve import "mbt:internal/app" from "main.ts".
```

原因 (`src/index.ts`):

1. `readModuleInfo()` が `root/moon.mod.json` を直接読むため、`moon.work` しかないルートでは `null`。
2. `resolveModulePath()` の出力パス計算に `<module_name_segments>` の階層が足りない (現行: `_build/js/release/build/app.js`、正: `_build/js/release/build/internal/app/app.js`)。
3. 複数モジュールのマッチングが無い (`moduleInfo` は 1 つだけ)。

## 拡張方針 (検討)

- `root` から上方向に `moon.work` / `moon.work.json` を探索し、見つかれば **workspace モード** に切り替え。
- `moon.work` の `members` を読み、各メンバーの `moon.mod.json` をロードして `{ name, source, dir }[]` を構築。
- `mbt:<user>/<mod>/...` を全メンバーの `name` と最長一致でルーティング。
- 出力パスは workspace モード時: `_build/<backend>/<mode>/build/<moduleNameSegs>/<pkgSegs>/<shortAlias>.<ext>`。
- `moon build --target <t> --watch` はワークスペースルートで起動 (moon 側が `moon.work` を自動検出して全メンバーをビルド)。
- `preferred_target` が `moon.work` にあればプラグインオプションのデフォルトに使う (任意)。

## 実行

```bash
# 要 moon v0.9+ (moon work コマンドが存在すること)
cd examples/monorepo_project
moon build --target js   # -> _build/js/debug/build/internal/{app,shared}/*.js
pnpm install
pnpm dev                 # 現状の plugin では resolver エラーで失敗する
```
