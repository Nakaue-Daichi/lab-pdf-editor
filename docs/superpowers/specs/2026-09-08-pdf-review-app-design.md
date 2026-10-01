# lab-pdf-editor — ブラウザ完結の論文 PDF レビュー（コメント）アプリ

> 2026-09-08 に脇田が承認した設計と実装計画。実装中に判明した差分は本文に追記せず、末尾の「実装後の差分」に書く。

## Context（なぜ作るか）

- **困りごと**: 学生の原稿（卒論・修論・投稿原稿）に教員がコメントして返す作業、および複数人で同じ PDF にコメントする作業に、手軽で、原稿を外部に出さず、誰の環境でも開ける道具がない。
- **うれしさ**: ①ブラウザで PDF を開いて文字列を選ぶだけでコメントが付く ②コメントは **PDF 標準注釈として本体に埋め込む** ので Acrobat・macOS プレビュー・Zotero でもそのまま見える ③複数人の注釈入り PDF を1つに統合できる ④コメント一覧を Markdown で書き出して Slack やメールに貼れる。
- **前提として決めたこと（2026-09-08・脇田）**
  - 主用途: 教員→学生の原稿添削、複数人での共同コメント（**ファイル受け渡し＋取り込み統合**で満たす。リアルタイム同時編集は対象外）
  - 保存先: PDF 注釈として書き込み・**ブラウザ内完結**（サーバに PDF を送らない）
  - 公開先: **GitHub Pages（public）**。非公開 Pages は Enterprise Cloud 限定で不可。公開されるのはコードだけで原稿は端末から出ないので問題なし。PDF の受け渡し自体は既存の Slack・Box で行う
  - 実装方式 A: **PDF.js で描画＋自前のコメント層＋pdf-lib で注釈を読み書き**
  - 注釈の種類: 文字列選択→ハイライト＋コメント / 付箋（任意位置） / 返信 / Markdown 一覧書き出し
- **確認済みの外部事実**: pdfjs-dist 6.3.289（2026-08-29・Apache-2.0）は活発。本家 pdf-lib は 2021 年で停止 → 後継フォーク **@cantoo/pdf-lib 2.9.2**（2026-09-07・MIT）を使う。PDF.js 内蔵エディタのコメント機能は「プレビュー版」で Mozilla 本体では未有効のため依存しない。Box プレビューにも標準のハイライト＋コメント機能がある（Box 上の資料に Box ユーザ同士でコメントするだけならそれで足りる。本アプリの独自価値は「Box に置かない原稿・Box 権限のない学生」「注釈が PDF の中に残る」「Markdown 書き出し」）。
- **新リポジトリ**: `OCEANS-UOsaka/lab-pdf-editor`（public・MIT）。ローカルは `42_研究室Github/lab-pdf-editor/`（現在は空）。

## スコープ

**v1 に入れる**
- PDF を開く（ファイル選択・ドラッグ＆ドロップ・「サンプルで試す」）、連続スクロール表示、ズーム（幅合わせ／50–300%）
- 文字列選択 → ハイライト＋コメント。付箋（クリック位置にコメント）。各コメントに返信。編集・削除
- 著者名（初回入力・端末に記憶）、著者ごとの色分け、著者でのフィルタ、カード⇄本文の相互ジャンプ
- 既存の注釈（Acrobat・プレビュー・本アプリで付けたもの）を読み込んでコメントとして表示・編集
- **コメント付き PDF を保存**（`<元名>_reviewed.pdf`。標準注釈 Highlight / Text / Popup / 返信を書き込む）
- **他の人のコメントを取り込む**（同じ原稿の注釈入り PDF を複数選び、重複を除いて統合）
- **Markdown 書き出し**（ページ順・著者・引用・返信。クリップボードへコピー／.md 保存）
- ブラウザ内の下書き自動保存（IndexedDB・PDF のハッシュがキー）。リロードしても消えない
- 画面に「PDF はブラウザ内で処理され、サーバへ送信されません」を明記

**v1 に入れない（割り切り）**
- リアルタイム同時編集・サーバ保存・ログイン
- フリーハンド・図形・下線・取消線（データモデルの `anchor.kind` を増やせば後から足せる形にはしておく）
- 文字層のないスキャン PDF でのハイライト（付箋は使える）。暗号化 PDF は開けない旨を表示
- 既存注釈の外観ストリーム（/AP）の保持。読み込んだ注釈は「著者・日時・本文・座標・色」から作り直す（Highlight/Text/Popup 以外の注釈は触らず保持し、件数だけ通知する）

## アーキテクチャ

```
[ブラウザのみ・静的サイト]
  index.html / src/main.ts
    ├ viewer/   PDF.js (pdfjs-dist) … ページ描画・文字層・座標変換・遅延描画
    ├ model/    コメントのデータモデルと Store（イベント通知）・統合（dedupe）・著者色
    ├ pdf/      @cantoo/pdf-lib … 注釈の読み取り／書き込み（PDF 標準注釈へ往復）・PDF 日付・SHA-256
    ├ ui/       サイドバー・カード・ツールバー・ドロップゾーン（フレームワーク無し・素の DOM）
    ├ export/   Markdown 生成・ダウンロード
    └ storage/  IndexedDB 下書き
```

- **技術スタック**: Vite + TypeScript（strict）、UI フレームワーク無し（学生が保守できる平易さを優先）、`pdfjs-dist ^6.3`、`@cantoo/pdf-lib ^2.9`、テストは Vitest（Node）。依存は実行時この2つだけ。
- **座標系**: コメントの幾何は全て **PDF ユーザ空間（原点左下・pt）** で保持。表示時に `viewport.convertToViewportRectangle`、選択時に `viewport.convertToPdfPoint` で変換（ページ回転にも追随）。
- **描画**: PDF.js の `page.render({ annotationMode: AnnotationMode.DISABLE })` でキャンバス描画（既存注釈の見た目は描かず、自前のオーバーレイで統一的に描く）。文字層は `pdfjs-dist` の `TextLayer` と `pdfjs-dist/web/pdf_viewer.css`。表示中±1ページだけ描画（IntersectionObserver）。
- **注釈の読み書きは pdf-lib 一本**（PDF.js は描画専用）。読み込み・取り込み・書き出しが同じコードを通るので往復が崩れない。

### データモデル（`src/model/types.ts`）

```ts
type Rect = [llx: number, lly: number, urx: number, ury: number];           // PDF ユーザ空間
type Anchor = { kind: 'highlight'; quads: Rect[] } | { kind: 'note'; point: [x: number, y: number] };
interface Reply   { id: string; author: string; text: string; createdAt: string; modifiedAt: string; }
interface Comment { id: string; pageIndex: number; anchor: Anchor; quote?: string; text: string;
                    author: string; color: string; createdAt: string; modifiedAt: string; replies: Reply[]; }
interface ReviewDoc { fileName: string; pageCount: number; comments: Comment[];
                      foreignAnnotations: Record<string, number>; }   // 触らない注釈の件数（Ink: 3 等）
```

### PDF 標準注釈との対応（`src/pdf/annotations.ts`）

| モデル | 書き込む注釈 | 主なキー |
|---|---|---|
| highlight | `/Subtype /Highlight` | `/Rect`(quads の外接) `/QuadPoints` `/C` `/CA 1` `/F 4` `/T` 著者 `/Contents` `/NM` id `/M` `/CreationDate` `/Popup` |
| note | `/Subtype /Text` `/Name /Comment` | `/Rect` 20×20pt（point を左上） `/C` `/F 28` `/T` `/Contents` `/NM` `/M` `/CreationDate` `/Popup` |
| reply | `/Subtype /Text` `/IRT` 親 `/RT /R` | 親と同じ `/Rect`、`/T` `/Contents` `/NM` `/M` `/CreationDate` |
| （付随） | `/Subtype /Popup` `/Parent` | `/Open false` |

- 文字列は `PDFHexString.fromText()`（UTF-16BE）で日本語を通す。日付は `D:YYYYMMDDHHmmSS+09'00'` ⇄ ISO の相互変換をテストで固定。
- QuadPoints の並びは Acrobat 互換（左上・右上・左下・右下）。読み取り時は 8 数値ごとに min/max で Rect 化。
- **書き出しは「作り直し」**: 元バイト列を pdf-lib で開き、各ページの `Annots` から Highlight / Text / Popup を除去 → モデルの全コメントを新規に追加 → `save()`。削除・編集が確実に反映され、重複しない。他の Subtype は触らない。
- **読み取り**: Highlight / Text を走査、`/IRT` を持つものは親に返信として付ける（親が無ければ独立の付箋）。`/NM` があれば id に採用、無ければ UUID を振る。`/T` が無ければ著者「不明」。
- **統合（`src/model/merge.ts`）**: 同一 id は1件に。id が違っても (page, kind, 幾何を 0.5pt で丸め, author, text) が一致すれば同一とみなす。ページ数が違うファイルは取り込みを拒否して理由を表示。

### 選択 → ハイライト（`src/viewer/selection.ts`）

`mouseup` 時に `window.getSelection()` の `getClientRects()` を取り、選択開始ページの文字層内にある矩形だけを採用 → ページ要素基準の CSS 座標 → `convertToPdfPoint` で Rect 化（同一行の隣接矩形は結合）。`selection.toString()` を空白正規化して `quote` に保存。選択直後に小さな「＋ コメント」ボタンを浮かせ、押すとコメントを作成してサイドバーの入力欄にフォーカス。ページをまたぐ選択は開始ページ分のみ採用（仕様として README に書く）。

### 画面（`src/ui/`）

- **ツールバー**: PDF を開く／サンプル／著者名／ズーム／付箋モード切替／他の人のコメントを取り込む／コメント付き PDF を保存（⌘S）／Markdown（コピー・保存）
- **本文**: 連続スクロールのページ列。オーバーレイに著者色のハイライト（`mix-blend-mode: multiply`）と付箋アイコン。クリックで該当カードを選択
- **サイドバー**: ページ順・上から順のカード（著者色ドット・ページ番号・引用・本文 textarea・返信・削除）。著者チップでフィルタ。選択カードは強調し、本文側へスクロール。「この PDF には表示しない注釈が N 件（Ink 3 / FreeText 1）あります。保存時に保持します」の通知
- **空状態**: 全画面ドロップゾーン＋使い方3行＋プライバシー文

### 下書き（`src/storage/drafts.ts`）

IndexedDB `lab-pdf-editor/drafts`、キー = 元 PDF バイト列の SHA-256。変更を 500ms デバウンスで保存。開いたとき「PDF 内の注釈 ∪ 下書き」を id で重複除去して復元。保存（書き出し）成功時にその下書きを消す。著者名は `localStorage`。

## リポジトリ構成

```
lab-pdf-editor/
  .github/workflows/ci.yml        PR（develop/main 宛）: typecheck + test + build
  .github/workflows/deploy.yml    main への push で GitHub Pages へ（actions/configure-pages → upload-pages-artifact → deploy-pages）
  docs/superpowers/specs/2026-09-08-pdf-review-app-design.md   本計画の設計部分を正本として保存
  docs/TESTING.md                 手動 e2e チェックリスト（Acrobat/プレビュー互換確認を含む）
  public/sample/sample.pdf        scripts/make-sample.mjs が生成する3ページの試用 PDF（英文）
  index.html  vite.config.ts(base: '/lab-pdf-editor/')  tsconfig.json  vitest.config.ts  package.json
  src/main.ts  src/app.ts  src/styles.css
  src/model/{types,store,merge,color}.ts
  src/pdf/{annotations,pdfdate,hash}.ts
  src/viewer/{PdfViewer,PageView,OverlayLayer,selection,coords}.ts
  src/ui/{Toolbar,Sidebar,CommentCard,DropZone}.ts
  src/export/{markdown,download}.ts
  src/storage/drafts.ts
  tests/{pdfdate,annotations-roundtrip,merge,markdown,coords}.test.ts
  README.md（概要・使い方・プライバシー・開発）  CONTRIBUTING.md（feature/* → develop → main、lab-home-page と同じ）  CLAUDE.md  LICENSE（MIT, OCEANS-UOsaka）
```

## 実装手順

ブランチ: `main`（LICENSE・README 初期コミット）→ `develop` → `feature/initial-app` で実装。コミットはパス指定（`git add <paths> && git commit -o <paths>`）。他セッションと同居しない新規 repo なので主 worktree で作業する。

**Phase 0 — 人の作業（GitHub 側・実装と並行可）**
1. `OCEANS-UOsaka/lab-pdf-editor` を **空の public リポジトリ**として作成（README・LICENSE は付けない）
2. fine-grained PAT（このリポジトリのみ・Contents / Pull requests / Issues 読み書き・Workflows 無し・30日）を発行し `~/.config/gh-tokens/OCEANS-UOsaka/lab-pdf-editor` に置く（600）
3. Settings → Pages → Source を **GitHub Actions** にする
4. 後述の Phase 6 で、workflow 2ファイルだけは人が反映する（PAT に Workflows 権限を付けない方針のため。GitHub Web UI で「Add file」、または SSH remote から一度 push）

**Phase 1 — 骨格**: `git init`、Vite+TS scaffold、依存追加、Vitest、`npm run typecheck|test|build|dev`、`scripts/make-sample.mjs`、workflow 2本、README 骨子、spec 保存。完了条件 = `npm run build` が通り空画面が出る。

**Phase 2 — 注釈 I/O コア（TDD・UI 無し）**: `pdfdate`（往復）→ `annotations.write/read` の往復（highlight・note・reply・日本語・色・複数ページ、Link 注釈が保持されること、2回書き出しても重複しないこと）→ `merge`（id 一致・指紋一致・ページ数不一致の拒否）→ `markdown`。完了条件 = `npm test` 緑。

**Phase 3 — ビューア**: 開く／ドロップ／サンプル、ページ列、遅延描画、文字層、ズーム、座標変換（`coords.ts` は純関数でテスト）。完了条件 = sample.pdf を表示し文字選択できる。

**Phase 4 — コメント UI**: 選択→「＋コメント」→ハイライト、付箋モード、サイドバー（編集・削除・返信・フィルタ・相互ジャンプ）、著者名と色。

**Phase 5 — 保存・取り込み・下書き**: PDF 書き出し（⌘S・ファイル名 `_reviewed`、二重付与しない）、Markdown コピー／保存、取り込み統合、IndexedDB 下書き、表示しない注釈の通知、暗号化 PDF のエラー表示。

**Phase 6 — 仕上げと公開**: 手動 e2e（下記）、README / CONTRIBUTING / CLAUDE.md / docs/TESTING.md、`develop`・`feature/initial-app` を push、PR（feature→develop、develop→main）、人が workflow を反映、Pages の URL で動作確認。

## 検証

- **自動**: `npm run typecheck && npm test && npm run build`。往復テストは pdf-lib で書いたものを pdf-lib で読み戻すことに加え、`pdfjs-dist`（Node）で `getAnnotations()` が Highlight の `quadPoints`・`titleObj`・`contentsObj` を返すことも確認する（別ライブラリでも読めることの担保）
- **ブラウザ（Browser pane・`npm run dev`）**: サンプルを開く → 文字選択→コメント → 付箋 → 返信 → ⌘S で保存 → 保存した PDF を開き直してコメント・返信・著者が復元される → 別コピーを「取り込む」で統合され重複しない → Markdown コピーの内容 → リロード後に下書きが残る → 回転ページの PDF でハイライト位置が合う
- **人が確認**: 保存した PDF を macOS プレビューと Acrobat Reader で開き、ハイライト・付箋・著者名・返信が見えること。**プレビューが /AP 無しの Highlight を描かない場合**は、書き出し時に簡単な外観ストリーム（quads を著者色で塗る Form XObject）を付ける対応を Phase 5 に追加する（既知の互換リスク）
- **公開**: `https://oceans-uosaka.github.io/lab-pdf-editor/` が開き、サンプルで一連の操作ができる

## リスクと対処

| リスク | 対処 |
|---|---|
| プレビュー等が外観ストリーム無しの注釈を描かない | 上記のとおり検証で判定し、必要なら AP 生成を追加 |
| pdfjs-dist のメジャー更新で `TextLayer` API が変わる | 版を固定（`^6.3`）。CONTRIBUTING に更新時の確認手順 |
| 同一原稿でも再保存でハッシュが変わり下書きが紐付かない | 書き出し成功時に下書きを消す設計で実害を無くす |
| PAT に Workflows 権限が無く workflow を push できない | Phase 0-4 の人手反映で解決（方針どおり権限は足さない） |
| 文字層のない PDF | ハイライト不可を選択時に案内、付箋は可 |

## 実装後の差分

実装しながら判明し、設計から変えた点。理由を添える。

- **統合の指紋は 0.5pt ではなく 1pt 単位で丸める**。0.5pt グリッドでは 100.2 と 100.4 が別のマスに落ち、「0.5pt 未満の差は同じ場所」という意図を満たさなかった。
- **PDF.js 6.x の API 差分**: `PageViewport.convertToViewportRectangle` は削除されているため、矩形は角 2 点を `convertToViewportPoint` で変換して min/max で正規化する。`page.render()` は `canvas` 引数が必須。`PDFDocumentProxy.destroy()` は無く、`loadingTask.destroy()` を使う。
- **文字層の寸法は PDF.js の `TextLayer` 自身が設定する**（`setLayerDimensions`）。その宣言は `round(down, …, var(--scale-round-x))` を使うので、ページ要素に `--scale-round-x/y: 1px` を置かないと無効になり、`/Rotate` 付きページで文字層が本文から下に約 30px・左に約 19px ずれる。`--scale-factor` `--user-unit` `--total-scale-factor` と合わせてページ要素に置く。
- **ハイライトした文字列（quote）は本アプリ独自キー `/LPEQuote` に保存する**。PDF 標準の Highlight には選択文字列を持つ場所が無い。他ツールが付けた Highlight は quote 無しで読み込み、一覧では「（ハイライト）」と表示する。
- **`Contents` の欠けた `/T`（著者）は「不明」**とし、色は著者名から決める。`/NM` が無ければ UUID を振る。
- **本文編集は `text` イベント、それ以外は `comments` イベント**に分けた。入力のたびに一覧を作り直すとフォーカスが飛ぶため。
- **返信欄は Enter で送信、ただし IME 変換中（`isComposing`）は送らない**。
- **`[hidden]` は `display: none !important` で強制**する。`display: grid` を持つ要素の UA 既定が負けていた。
- **PDF.js の補助ファイル（CMap・標準フォント・wasm・ICC）は `public/pdfjs/` に同梱**し、`predev` / `prebuild` でコピーする（`.gitignore` 対象）。外部 CDN に頼らない。
- **取り込みの成功通知が出ないバグを修正**: `<input type=file>` の `FileList` は呼び出し元が `value = ''` で空にすると同時に空になる。非同期処理の後で `files.length` を見ると 0 になるので、先に配列へ写す。
- **「幅に合わせる」は `ResizeObserver` で追従**する。`window.resize` だけだと、非表示（幅 0）のうちに開いたときや表示領域の分割が変わったときに追従できない。
- **ブラウザ検証で分かった環境要因**: Browser pane が非表示だとページが描画されず IntersectionObserver も発火しないため、遅延描画の確認はペインが見えている状態で行う。ダウンロード先が見えないため、保存バイト列は `URL.createObjectURL` をフックして取り出し、Node の `scripts/inspect-annotations.mjs` で検査した。
- **元に戻す／やり直す（⌘Z / ⇧⌘Z・⌘Y）を後から追加**（設計時に無かった機能）。コメントの変更前の状態を `ReviewStore` が複製して積むスナップショット方式で、`HISTORY_LIMIT = 5` 手まで。コメントは高々数百件で複製は軽く、差分（コマンド）方式より取り消しの実装が単純なため。同じコメントへの連続した本文編集は目印（`text:<id>`）でまとめ、1 文字ごとに 1 手にしない。取り消し・やり直しは `comments` イベントを流すので、一覧・本文・下書き保存はそのまま追従する。**入力欄にカーソルがあるときの ⌘Z は横取りしない**（その欄の文字だけを戻すブラウザ標準の動作の方が入力中の期待に合う。標準の取り消しも `input` イベントを出すので Store の本文は一致し続ける）。
- **スマホ・タブレット対応を後から追加**（2026-10-01、設計は [2026-10-01-mobile-design.md](2026-10-01-mobile-design.md)）。あわせて v1 の不具合を 3 つ直した: ツールバーの `overflow: hidden` で「Markdown ▾」のメニューが切れて押せなかった／拡大してページが表示幅より広くなると左側にスクロールで届かなかった（`.pv-pages` の `align-items: center`）／PDF.js の選択補助（`TextLayerBuilder` 側の `.endOfContent`）が無く、Safari で選択がページ先頭へ飛んだ。描画は「表示中 ±1 ページを描く」に加えて、上限を超えたら遠いページを捨てるようにした。
