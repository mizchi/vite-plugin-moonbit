# overrides_project (virtual / implement / overrides)

MoonBit の「virtual package + 実装の差し替え」機構を Vite から使うサンプル。

## 機能概要

`moon.pkg.json` の 3 つのフィールド:

| フィールド | 役割 |
|---|---|
| `"virtual": { "has-default": bool }` | インタフェースのみ持つ package (実装なし。`pkg.mbti` でシグネチャ宣言) |
| `"implement": "user/mod/iface"` | 指定された virtual package の実装を提供 |
| `"overrides": ["user/mod/impl_x"]` | main/app package が link 時にどの実装を使うか選択 |

link 時に選択が解決されるため、Vite plugin 側は最終的にリンクされた `.js` を
そのまま返すだけで済む(resolver に特別な処理は要らない)。

## 構成

```
overrides_project/
├── moon.work                 # members: iface / impl_a / impl_b / app
├── iface/                    # spec/iface   (virtual, pkg.mbti でシグネチャ宣言)
│   └── src/
│       ├── pkg.mbti          # pub fn greet() -> String
│       ├── moon.pkg.json     # "virtual": { "has-default": false }
│       └── lib.mbt           # 空 (実装なし)
├── impl_a/                   # impls/impl_a (implement: spec/iface)
│   └── src/lib.mbt           # pub fn greet() -> String { "hello from impl_a" }
├── impl_b/                   # impls/impl_b (implement: spec/iface)
│   └── src/lib.mbt           # pub fn greet() -> String { "hello from impl_b" }
└── app/                      # my/app       (overrides: ["impls/impl_a"])
    └── src/
        ├── moon.pkg.json     # overrides: ["impls/impl_a"]
        └── lib.mbt           # pub fn greet_wrapped() -> String { "[" + @iface.greet() + "]" }
```

## ビルド挙動

`moon build --release --target js` の出力は **main の `app.js` 1 つだけ**:

```
_build/js/release/build/my/app/app.js   ← impl_a が inline されている
_build/js/release/build/spec/iface/iface.mi      ← .mi のみ (runtime なし)
_build/js/release/build/impls/impl_a/impl_a.{mi,core}  ← .js 出力なし
```

生成された `app.js`:

```js
function _M0FP22my3app14greet__wrapped() {
  return `[hello from impl_a]`;
}
export { _M0FP22my3app14greet__wrapped as greet_wrapped }
```

`overrides` を `["impls/impl_b"]` に切り替えて `moon build --release` し直せば、
同じパスに `"[hello from impl_b]"` を返す `app.js` が出力される。

## Vite plugin の挙動

- `mbt:my/app` は通常通り resolve される (override 後の成果物)。
- `mbt:spec/iface` や `mbt:impls/impl_a` を直接 import しようとすると、
  plugin が親切なエラーを出す:

```
[moonbit] Could not resolve: mbt:spec/iface -> .../iface/iface.js
[moonbit] hint: mbt:spec/iface is a virtual package (declared in
         iface/src/moon.pkg.json). Virtual packages have no runtime output —
         import the app/main package that selects an implementation via
         `overrides` instead.
```

## 実行

```bash
cd examples/overrides_project
moon build --release --target js
pnpm install
pnpm build    # or `pnpm dev`
```
