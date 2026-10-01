# CLAUDE.md

このリポジトリで AI（Claude Code）が作業するときの前提。手順の正典は各文書。

| 文書 | 役割 |
|---|---|
| [README.md](README.md) | 何のためのツールか・使い方・構成 |
| [CONTRIBUTING.md](CONTRIBUTING.md) | ブランチ・PR・CI・リリース・PDF.js 更新時の確認（**作業手順の正典**） |
| [docs/superpowers/specs/2026-09-08-pdf-review-app-design.md](docs/superpowers/specs/2026-09-08-pdf-review-app-design.md) | 設計の正本。変えたら末尾「実装後の差分」に理由を書く |
| [docs/superpowers/specs/2026-10-01-mobile-design.md](docs/superpowers/specs/2026-10-01-mobile-design.md) | スマホ・タブレット対応の設計（同じく末尾に実装後の差分） |
| [docs/TESTING.md](docs/TESTING.md) | 手動テストの手順と実施記録 |

## 守ること

- **PDF をサーバへ送る機能を入れない**。ブラウザ内完結がこのツールの前提（README「プライバシー」）
- 実行時依存は `pdfjs-dist`（描画専用）と `@cantoo/pdf-lib`（注釈の読み書き専用）の 2 つ。役割を混ぜない。UI フレームワークは入れない
- コメントの幾何は **PDF ユーザ空間**で持つ。CSS 座標への変換は `src/viewer/coords.ts` に集める
- 注釈の書き出しは **作り直し**（既存の Highlight / Text / Popup を外して全部書く）。差分更新にしない
- Store のイベントは `comments`（一覧の作り直し）と `text`（本文編集のみ）を分ける。入力中に一覧を作り直すとフォーカスが飛ぶ
- ロジックの変更はテストを先に書く（`tests/`）。DOM の変更はブラウザで確かめ、`docs/TESTING.md` に記録する

## スマホ・タブレット

- スマホ用画面の条件は `src/styles.css` の `@media` と `src/ui/viewport.ts` の `COMPACT_QUERY` の 2 か所にある。変えるときは両方
- 選択範囲の矩形に `range.getClientRects()` を使わない。選択補助の `.endOfContent`（文字層と同じ大きさ）が範囲に入ると、ページ全体の矩形が混ざる。`selection.ts` の `textRects` を使う
- iOS はタップの処理の中で同期的に `focus()` しないとキーボードを出さない。入力欄を開くまでの間に `await` を挟まない
- キャンバスは `PageView` が `renderBudget.ts` の上限の中で描き、遠いページは `release()` で捨てる。描画を足すときもこの仕組みを通す（iOS はキャンバスの総量が多いとタブが落ちる）
- アイコンは `src/ui/icons.ts`（Lucide）から使う。先頭のライセンス文は消さない（`vite.config.ts` で配信物にも残している）
- Browser pane が非表示だと描画・IntersectionObserver・transition が止まる。スマホの確かめは Playwright のモバイル文脈（`isMobile`・`hasTouch`）と CDP の `Input.dispatchTouchEvent` が確実

## よく使うコマンド

```bash
npm run dev        # 開発サーバ http://localhost:5173/lab-pdf-editor/
npm run check      # typecheck + test + build
node scripts/inspect-annotations.mjs <file.pdf>   # PDF の注釈を一覧
```
