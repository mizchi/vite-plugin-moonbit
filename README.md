# vite-plugin-moonbit

MoonBit プロジェクトを Vite で使用するためのプラグイン。

## 機能

- `mbt:` プレフィックスによるインポート解決
- `moon build --watch` サブプロセスの自動起動
- ファイル変更時の HMR
- MoonBit 生成の `.d.ts` による TypeScript 型サポート

## インストール

```bash
pnpm add -D vite-plugin-moonbit
```

## 基本的な使い方

### 1. Vite 設定

```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import moonbit from 'vite-plugin-moonbit';

export default defineConfig({
  plugins: [
    moonbit({
      // オプション（すべて省略可能）
      root: process.cwd(),  // MoonBit プロジェクトのルート
      watch: true,          // moon build --watch を起動（dev 時のみ）
      target: 'release',    // 'release' | 'debug'
      showLogs: true,       // ビルドログを表示
    })
  ],
});
```

### 2. MoonBit モジュールのインポート

```typescript
// main.ts
import { my_function } from 'mbt:username/project';
import { sub_function } from 'mbt:username/project/submodule';
```

インポートパスは `moon.mod.json` の `name` に対応します。

## TypeScript 型サポート

MoonBit は `target/js/release/build/` に `.d.ts` ファイルを生成します。
`tsconfig.json` の `paths` でエイリアスを設定することで型チェックが有効になります。

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "mbt:username/project": ["./target/js/release/build/project.d.ts"],
      "mbt:username/project/submodule": ["./target/js/release/build/submodule/submodule.d.ts"]
    }
  }
}
```

## パス解決ルール

| インポート | 解決先 |
|-----------|--------|
| `mbt:user/pkg` | `target/js/release/build/pkg.js` |
| `mbt:user/pkg/sub` | `target/js/release/build/sub/sub.js` |
| `mbt:user/pkg/a/b/c` | `target/js/release/build/a/b/c/c.js` |

## プロジェクト構成例

```
my-project/
├── moon.mod.json          # name: "username/project"
├── src/
│   ├── moon.pkg.json
│   └── main.mbt
├── target/js/release/build/
│   ├── project.js         # ビルド出力
│   └── project.d.ts       # 型定義
├── vite.config.ts
├── tsconfig.json
├── main.ts                 # import from 'mbt:username/project'
└── index.html
```

## オプション

| オプション | 型 | デフォルト | 説明 |
|-----------|-----|-----------|------|
| `root` | `string` | `process.cwd()` | MoonBit プロジェクトのルートディレクトリ |
| `watch` | `boolean` | dev 時 `true` | `moon build --watch` を起動するか |
| `target` | `'release' \| 'debug'` | `'release'` | ビルドターゲット |
| `showLogs` | `boolean` | `true` | MoonBit ビルドログを表示するか |

## 開発

```bash
# ビルド
pnpm build

# 開発（watch モード）
pnpm dev
```

## ライセンス

MIT
