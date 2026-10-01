# スマホ・タブレット対応 — 設計

> 2026-10-01 中植。研究室で出た「スマホでも使えるようにしてほしい」という要望への対応。
> v1 の設計（[2026-09-08-pdf-review-app-design.md](2026-09-08-pdf-review-app-design.md)）の上に足す差分。v1 の「守ること」（PDF をサーバへ送らない・依存は 2 つ・座標は PDF ユーザ空間・注釈は作り直し・Store のイベント分離）はそのまま守る。
> 実装中に判明した差分は本文に追記せず、末尾の「実装後の差分」に書く。

## Context（なぜ）

**困りごと**: スマホで開くと画面が崩れて使えない。develop（511d2ab）を Chrome のモバイル表示（375×812）で測った:

| 項目 | 実測 | 原因 |
|---|---|---|
| 本文の幅 | **75px**（ページは 149px に縮み、左右が切れる） | サイドバー 300px 固定が画面の 80% を取る |
| ツールバー | 内容 1,310px に対し表示 375px。「PDF を開く」以外の 11 個が画面外（**保存も押せない**） | 折り返しも退避も無い `overflow: hidden` |
| ボタンの高さ | 27〜31px | 指で押す目安（44px）を想定していない |
| 入力欄の文字 | 12.5〜13px | iOS は 16px 未満の欄にフォーカスすると画面ごと拡大する |
| 文字選択 | 「＋ コメント」が出ない | 出す合図が `mouseup`。タッチの選択では来ない |

**同じ原因でデスクトップでも起きていたもの**（一緒に直す）:

- ツールバーは幅 1,310px 未満で右端が切れる。1,280px で保存ボタンが 16px 欠け、ファイル名は幅 0。iPad（768〜1,024px）では保存・取り込み・Markdown が画面外
- 表示倍率を上げてページが表示幅より広くなると、**左側が画面外に出てスクロールでも届かない**（1,280px・200% で左 351px）。`.pv-pages` の `align-items: center` が、はみ出した子を左右均等に押し出すため
- 文字層の**選択補助が無い**。PDF.js の選択補助（`.endOfContent` を選択の端へ動かす仕組み）は `TextLayer` ではなくビューア部品 `TextLayerBuilder` 側にあり、`TextLayer` を直接使う本アプリには入っていない。Safari（iOS は全ブラウザが該当）と古い Chrome では余白に指やマウスが掛かると選択がページ先頭まで飛ぶ

**うれしさ**: 移動中や会議の合間にスマホで原稿を開き、文字を選んでその場でコメント・返信し、保存した PDF を共有シートから Slack へそのまま送れる。学生は受け取った PDF のコメントを、スマホで 1 件ずつ送りながら読める。

## 決めたこと（2026-10-01）

依頼は「スマホでも編集できるように。UX・機能も考えて」。調査（末尾）から次のように決めた。

1. **画面幅で 3 段に分ける**。〜767px（と、高さ 500px 以下のタッチ端末＝横向きのスマホ）は**スマホ用の画面**、768〜1,439px は今の画面のままツールバーだけ畳む、1,440px 以上は今と同じ
2. スマホ用の画面は **上部バー（ファイル名・その他メニュー）＋本文＋下部バー（よく使う操作）＋コメント一覧のボトムシート**。よく使う操作は親指の届く画面下へ、まれな操作は上部の「…」へ
3. コメント一覧は**非モーダルのボトムシート**（半分／全高の 2 段＋閉じる）。PDF を動かしながら一覧を見られる。**書くときは全高**（キーボードの上に入力欄が残る）
4. タッチの文字選択は `selectionchange` が止まったら確定とみなし、「＋ コメント」は**選択の近くでなく下部バーの上に固定**して出す（OS の選択メニューとぶつけない）
5. **ピンチで拡大縮小**する（論文の本文 10pt は幅合わせで 6px 前後になり、拡大しないと読めない）。ページ全体の拡大は止め、本文だけを拡大して描き直す
6. スマホの保存は**共有シート**（Slack・LINE・「ファイルに保存」・AirDrop）。使えないブラウザでは今まで通りダウンロード。PDF を外へ送るのは利用者が選んだアプリだけで、サーバは介さない（v1 のプライバシーの約束は変わらない）
7. 長い原稿（修論 100 ページ級）で iPhone のタブが落ちないよう、**キャンバスの画素数に上限**を設け、**遠いページの描画を捨てる**
8. 機能は削らない。取り込み・Markdown・著者名・表示倍率はスマホでは「…」メニューに入れる

## スコープ

**入れる**
- 3 段のレイアウト（スマホ用画面・ツールバーの畳み込み・今の画面）、セーフエリア、動的ビューポート高さ
- タッチの文字選択 →「＋ コメント」→ ハイライト＋入力欄。付箋（下部バーの「付箋」→ タップで置く）。返信・削除・著者フィルタ
- コメント一覧のボトムシート（グラバーのドラッグ・タップで段を切替・閉じる）、前後のコメントへ移動（‹ ›）
- ハイライト・付箋をタップして選ぶ（指向けに当たり判定を広げる）。一覧のカードから本文へ移動（シートに隠れない位置へ）
- ピンチズーム（指の間の点を固定）、「幅に合わせる」
- ソフトウェアキーボードへの追従（`visualViewport`）、入力欄 16px
- 共有シートでの保存（使えなければダウンロード）
- キャンバスの画素数上限・遠いページの解放、ページ位置の表示（「3 / 12」）
- PDF.js の選択補助（`TextLayerBuilder` の `.endOfContent` 制御）の移植。デスクトップの Safari・Firefox にも効く
- デスクトップの不具合 2 件（ツールバーの欠け・拡大時に左が届かない）

**入れない（今回は割り切る）**
- ダブルタップでの拡大、トラックパッドのピンチ（⌘＋ホイール）、長押しで付箋
- 手書き・図形（v1 と同じ）
- PWA 化（ホーム画面に追加・共有メニューから受け取る Web Share Target）。iOS は受け取りに対応していない
- iOS Safari の選択そのものの癖（複数行で範囲が広がる等、PDF.js でも未解決）の根治。選んだ文字列をカードに出して確かめられるようにするところまで

## 画面

### 幅による切り替え

| 幅（とポインタ） | 画面 | ツールバー |
|---|---|---|
| 1,440px 以上 | 今と同じ（右サイドバー 380px） | 今と同じ |
| 1,100〜1,439px | 右サイドバー 380px | 「サンプル」「取り込む」「Markdown」を「…」へ |
| 768〜1,099px | 右サイドバー 300px | さらにロゴの文字を消し、保存は「保存」の 2 文字 |
| 〜767px、または高さ 500px 以下かつ `pointer: coarse` | **スマホ用画面** | 上部バー＋下部バー |

判定は CSS の media query が正本。JS が知る必要があるもの（シートかサイドバーか）は `src/ui/viewport.ts` の同じ query 文字列から引く。

### スマホ用画面

```
┌─────────────────────────────┐
│ ■ 原稿.pdf · 12 ページ    ⋯ │ 上部バー 48px（+ セーフエリア）
├─────────────────────────────┤
│        ┌──────────┐         │
│        │  PDF     │  3 / 12 │ ページ位置（スクロール中だけ）
│        │ （幅合わせ）│         │
│        └──────────┘         │
│      ［ ＋ コメント ］        │ 文字を選んでいる間だけ
├─────────────────────────────┤
│  ↶     ↷    付箋  コメント 5 保存│ 下部バー 56px（+ セーフエリア）
└─────────────────────────────┘
```

- **上部バー**: ロゴ、ファイル名とページ数（省略記号で切る）、「…」メニュー（PDF を開く／サンプルで試す／著者名／幅に合わせる／コメントを取り込む／Markdown をコピー／.md を保存）
- **下部バー**: 元に戻す・やり直す・付箋・コメント（件数）・保存。アイコン＋短いラベル、各 44px 以上
- **「＋ コメント」**: 高さ 48px の丸いボタン。下部バー（シートが開いていればシート）の 12px 上、左右中央
- **付箋モード**: 本文の上端に「置きたい場所をタップ」「やめる」の帯。付箋ボタンは押された見た目
- **空状態**: 大きな「PDF を開く」「サンプルで試す」と、タッチ向けの説明（「文字を長押しして範囲を選ぶ」）

### コメントのボトムシート（スマホ用画面）

- 段: **閉じる / 半分（見えている高さの 50%）/ 全高（上部バーの下まで）**。初めて開くと半分
- 上端にグラバー（4×36px の棒、触れる範囲は 48px）。ドラッグで高さを変え、離すと近い段へ吸い付く（速く払ったら払った向きの段へ）。タップで半分⇄全高。✕ で閉じる
- 見出し: 「コメント N」、前後のコメントへ移動（‹ ›）、✕。その下に著者チップ（2 人以上のとき）と「表示しない注釈」の通知
- 半分のときは本文の下にシート分の余白を足し、最後のページもシートの上まで送れるようにする
- **書く**: 「＋ コメント」・付箋を置いた直後、カードの入力欄にフォーカスしたときは全高にする。シートの下端はキーボードの上に合わせる（`visualViewport`）
- **選ぶ**: 本文のハイライト・付箋をタップ → 閉じていれば半分で開き、そのカードへスクロール。ハイライトがシートに隠れる位置なら本文を送る
- **移動する**: カードをタップ → 全高なら半分に下げ、本文をそのコメントの位置へ（見えている部分の上から 25%）

### タブレット・デスクトップ（768px 以上）

右サイドバーのまま。タッチ端末（iPad）では、タッチで選んだときの「＋ コメント」を本文の下端中央に固定して出し（マウスのときは今まで通り選択のそば）、ボタン類はタッチの大きさにする（`pointer: coarse`）。

## 操作の作り

### タッチの文字選択（`src/viewer/selection.ts`）

- いま: `mouseup`・`keyup(shift)` で確定を見る。`selectionchange` は空になったときだけ
- 足す: `selectionchange` が **300ms 止まったら**確定とみなす（マウスのボタンが押されている間は待つ。デスクトップの動きは変えない）
- iOS は選択の外のボタンをタップすると click の前に選択が消える。**確定のたびに選択の中身（ページ・矩形・引用）を保持**し、ボタンは保持した値で作る。ボタンを `pointerdown` した時点の値を握り、選択が消えた通知が来てもタップ中は隠さない
- どちらに出すか: 直前の `pointerdown` の `pointerType` が `touch`/`pen` なら下に固定、`mouse` なら選択のそば

### 選択補助（`src/viewer/textSelectionAssist.ts`）

PDF.js `web/text_layer_builder.js`（v6.3.289、Apache-2.0）の `#bindMouse` と `#enableGlobalSelectionListener` を移植する。描画の終わった文字層の末尾に `.endOfContent` を足し、選択の動いている端の `<span>` の隣へ動かす。CSS は読み込み済みの `pdf_viewer.css` の `.textLayer .endOfContent` / `.selecting` をそのまま使う。ページを捨てるときに登録を外す。

### ピンチズーム（`src/viewer/pinch.ts`・`src/viewer/zoom.ts`）

- 本文（`.pv-viewer`）で `touchstart`/`touchmove` を `passive: false` で取り、**指 2 本のときだけ** `preventDefault`。1 本はブラウザに任せる（スクロール・選択を邪魔しない）。`touch-action: pan-x pan-y` も付ける
- 動かしている間は `.pv-pages` を CSS の `scale` で伸縮・平行移動するだけ（描き直さない）。指を離したら倍率を確定してページの寸法を変え、**指の間にあった点（ページ番号とページ内の割合）が同じ画面位置に来る**ようスクロールを合わせ、見えているページだけ描き直す
- 倍率の範囲は今の下限（scale 0.25）〜 300%（scale 4.0）。確定した倍率はツールバーの表示倍率に「137%」のように出す
- 表示倍率の切替（デスクトップのセレクト）も、今の「スクロール量の比」ではなく「表示中央の点」を保つ方式に揃える

### 描画の上限（`src/viewer/renderBudget.ts`）

- キャンバス 1 枚の画素数上限: タッチ端末 5,242,880（PDF.js がモバイルで使う値）、それ以外 33,554,432（PDF.js の既定）。超えるときは devicePixelRatio を下げて描き、CSS で伸ばす（少しぼやけるが落ちない）
- 描画済みページの上限: タッチ端末 6、それ以外 10。超えたら、表示中のページから遠い順に、表示付近でないページのキャンバスと文字層を解放する（戻ってきたら描き直す）
- ページ位置（「3 / 12」）: スクロールのたびに、見えている範囲の上から 40% の位置にあるページを求めて表示し、1.2 秒止まったら消す

### 当たり判定（`src/viewer/hittest.ts`）

`hitTestHighlight(comments, pageIndex, point, tolerance = 0)`。tolerance（PDF の pt）以内に近いハイライトも拾う。中に入っているものを優先し、次に近いもの、同じなら小さいもの。タッチでは 12px 相当（12 / scale pt）を渡す。付箋アイコンはタッチでは触れる範囲を 44px に広げる（見た目は 22px のまま）。

### 保存と共有（`src/export/share.ts`）

`deliverFile(bytes, fileName, mime, { preferShare, nav, download })` → `'shared' | 'downloaded' | 'cancelled'`。
`preferShare`（タッチ端末）かつ `nav.canShare({ files })` が真なら `nav.share({ files })`。利用者が閉じた（`AbortError`）なら `'cancelled'` で下書きを消さない。共有できない・許可されない（`NotAllowedError` 等）ならダウンロードに切り替える。デスクトップは今まで通りダウンロード。

### キーボードとビューポート（`src/ui/viewport.ts`）

`visualViewport` の `resize`/`scroll` で `--vvh`（見えている高さ）と `--kb`（キーボードで隠れた高さ）を `<html>` に置く。シートは `bottom: var(--kb)`、全高は `--vvh` から上部バーを引いた高さ。`<meta name="viewport">` に `viewport-fit=cover, interactive-widget=resizes-content` を足す（Android Chrome はレイアウトごと縮み、`--kb` は 0 のまま）。

## 実装（ファイルとインターフェース）

| ファイル | 変更 |
|---|---|
| `index.html` | viewport meta |
| `src/styles.css` | 3 段のレイアウト、ボトムシート、下部バー、タッチの大きさ、入力欄 16px、`.pv-pages` のはみ出し修正、`overscroll-behavior` |
| `src/ui/viewport.ts`（新） | `COMPACT_QUERY`・`isCompact()`・`onCompactChange()`・`lastPointerType()`・`trackVisualViewport()` |
| `src/ui/icons.ts`（新） | Lucide（ISC）のアイコンをインライン SVG 文字列で持つ。出典とライセンス文を先頭に |
| `src/ui/Toolbar.ts` | 「…」メニュー、下部バー、コメント件数、任意倍率の表示 |
| `src/ui/sheet.ts`（新・純関数） | 段の高さ計算と吸い付き先の判定 `snapSheet()` |
| `src/ui/CommentSheet.ts`（新） | シートの開閉・ドラッグ・`inert` の付け外し |
| `src/ui/Sidebar.ts` | グラバー・✕・‹ › の見出し、タッチ向けの文言、`focus({ preventScroll: true })` |
| `src/ui/EmptyState.ts`・`toast.ts` | タッチ向けの文言、スマホでの位置 |
| `src/viewer/selection.ts` | `selectionchange` のデバウンス |
| `src/viewer/textSelectionAssist.ts`（新） | PDF.js の選択補助の移植 |
| `src/viewer/zoom.ts`（新・純関数） | 倍率⇄scale、範囲の丸め、ピンチの倍率、指の点を保つスクロール量 |
| `src/viewer/pinch.ts`（新） | 指 2 本の検出と CSS 変形 |
| `src/viewer/renderBudget.ts`（新・純関数） | `capOutputScale()`・`pagesToRelease()`・`pageIndexAt()` |
| `src/viewer/PdfViewer.ts`・`PageView.ts` | 余白を CSS から読む、点を保つ倍率変更、ピンチ、解放、ページ位置 |
| `src/viewer/hittest.ts` | tolerance |
| `src/export/share.ts`（新） | `deliverFile()` |
| `src/app.ts` | つなぎ込み |

実行時の依存は増やさない（アイコンはソースに埋め込む）。

## 品質の基準（数値）

| 項目 | 基準 | 根拠 |
|---|---|---|
| 押せる大きさ | タッチ端末で 44×44px 以上（主要ボタンは 48px） | Apple HIG 44pt、Material 48dp |
| 入力欄の文字 | タッチ端末で 16px 以上 | iOS の自動拡大を避ける |
| シートの動き | 開く 300ms `cubic-bezier(0.05, 0.7, 0.1, 1)`、閉じる 200ms `cubic-bezier(0.3, 0, 0.8, 0.15)`。`prefers-reduced-motion` で 0 | Material 3 の duration・easing |
| 「＋ コメント」 | 選択が止まって 300ms で出る。出る 120ms・消える 80ms | Hypothesis は 100ms（マウス）。タッチはハンドル操作の途中で点滅しない長さ |
| 本文の幅 | 375px 幅で左右の余白 8px、ページは 359px | 余白 24px のままだと幅の 13% を失う |
| 崩れない | 320〜1,920px のどの幅でも、横スクロールが出ない・押せない操作が無い | 依頼の本題 |
| 長い原稿 | 100 ページを最後まで送っても、描画済みキャンバスは 6 枚（タッチ）まで | iOS のキャンバス総量の上限 |
| 見た目 | アイコンは 1 系統（Lucide）で太さ・大きさを揃える。console のエラー 0 | 寄せ集めに見せない |

## 検証

- **自動**（`npm run check`）: 新しい純関数（`zoom.ts`・`renderBudget.ts`・`sheet.ts`・`share.ts`・`hittest.ts` の tolerance）を先にテストで固定する
- **ブラウザ**（`npm run dev`、Browser pane のモバイル表示 375×812・タブレット 768×1024・1,280×800・1,920×1,080）: docs/TESTING.md の「スマホ」の表を全部通す。タッチの合成（`TouchEvent`・`pointerType: 'touch'`）でピンチ・選択の確定・ボタンのタップを確かめる
- **実機（人）**: iPhone の Safari と Android の Chrome で、長押しで選ぶ → ＋ コメント → 入力（キーボードで欄が隠れない）→ 返信 → 付箋 → ピンチ → 保存（共有シート → ファイルに保存）→ 保存した PDF を開き直す。Browser pane では実際の長押し選択・キーボード・共有シートは出ないため、ここは人が確かめる

これが全部通れば完成: **スマホだけで、PDF を開く → 文字を選んでコメント → 付箋 → 返信 → 拡大して読む → 共有シートで Slack へ送る、が最後までできる。デスクトップの今までの操作（docs/TESTING.md #1〜22）は変わらない。**

## リスク

| リスク | 対処 |
|---|---|
| iOS で選択がタップで消え、ボタンが空振りする | 確定のたびに値を保持し、保持した値で作る。実機で確認 |
| iOS Safari の選択の癖（複数行で範囲が飛ぶ） | 選択補助を移植。残る分は引用をカードに出して確かめられるようにする |
| ピンチ中にブラウザのスクロールが割り込む | 指 2 本の `touchmove` を `preventDefault`、`touch-action: pan-x pan-y` |
| 共有シートが「操作から時間が経った」で拒否される | ダウンロードに切り替える |
| iOS Safari のストレージは 7 日使わないと消えることがある | README と空状態に「下書きは端末のブラウザにだけ残る。保存した PDF が正」と書く |
| デスクトップの操作が変わる | 768px 以上は CSS の追加だけ。docs/TESTING.md #1〜22 を回し直す |

## 調査の要点（出典）

2026-10-01 に技術（ブラウザの挙動）と UX（既存のモバイル PDF 注釈アプリ・指針）の 2 方向で調べた要点。

| 何が分かったか | 設計への効き方 | 出典 |
|---|---|---|
| タッチの選択では、ハンドルを動かした後に `mouseup`/`pointerup`/`touchend` が来ない。来るのは `selectionchange` だけ | 止まって 300ms で確定（Hypothesis はマウス 100ms） | [PDF.js #17923](https://github.com/mozilla/pdf.js/pull/17923)、[Hypothesis SelectionObserver](https://github.com/hypothesis/client/blob/main/src/annotator/selection-observer.ts)、[R. Knight の実測メモ](https://gist.github.com/robertknight/ad9f1bca8280b3fa325817aa3ed9935c) |
| iOS は選択の外のボタンをタップすると click の時点で選択が消えている | 確定した選択を保持し、押し始めの値で作る | [Apple Developer Forums 690918](https://developer.apple.com/forums/thread/690918) |
| OS の選択メニューは選択の上（無ければ下）に出て、消せない | 「＋ コメント」は選択のそばに出さず下へ | 同上・[MDN -webkit-touch-callout](https://developer.mozilla.org/en-US/docs/Web/CSS/-webkit-touch-callout) |
| 選択補助（`.endOfContent`）は `TextLayerBuilder` 側にあり、`TextLayer` だけでは入らない。iOS の選択の乱れは本家でも未解決 | 移植した。引用をカードに出して確かめられるように | [text_layer_builder.js v6.3.289](https://github.com/mozilla/pdf.js/blob/v6.3.289/web/text_layer_builder.js)、[#15691](https://github.com/mozilla/pdf.js/issues/15691) |
| pdfjs-dist は本家ビューアのピンチ処理 `TouchManager` を公開している。iOS は `user-scalable=no` を無視し、`touch-action` は iOS 13 から | `TouchManager` を使い、本文に `touch-action: pan-x pan-y`・`gesturestart` を止める | [touch_manager.js](https://github.com/mozilla/pdf.js/blob/v6.3.289/src/display/touch_manager.js)、[MDN touch-action](https://developer.mozilla.org/en-US/docs/Web/CSS/touch-action) |
| PDF.js はモバイルでキャンバス 1 枚 5,242,880 px、ページは 10 枚（`max(10, 2×見えている数+1)`）。iOS は合計の上限が撤廃され、超えるとタブごと落ちる | `renderBudget.ts` の値 | [app_options.js](https://github.com/mozilla/pdf.js/blob/v6.3.289/web/app_options.js)、[WebKit CanvasBase.cpp](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/html/CanvasBase.cpp) |
| 16px 未満の入力欄にフォーカスすると WebKit は 16 ÷ font-size 倍に拡大する | タッチ端末の入力欄は 16px | [WebKit WKContentViewInteraction.mm](https://github.com/WebKit/WebKit/blob/main/Source/WebKit/UIProcess/ios/WKContentViewInteraction.mm) |
| iOS も Android Chrome 108 以降も、キーボードで縮むのは visual viewport だけ（Android の既定は resizes-visual） | `--kb = innerHeight − vv.height − vv.offsetTop` でシートを持ち上げる | [Chrome: viewport resize behavior](https://developer.chrome.com/blog/viewport-resize-behavior)、[MDN Visual Viewport](https://developer.mozilla.org/en-US/docs/Web/API/Visual_Viewport_API) |
| 共有のユーザー操作の有効期間は WebKit・Chromium とも 5 秒。キャンセルは `AbortError`。Firefox はファイルを共有できない | PDF を作ってから `share`。キャンセルは下書きを残す | [MDN Navigator.share](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share)、[Chromium user_activation_state.h](https://github.com/chromium/chromium/blob/main/third_party/blink/public/common/frame/user_activation_state.h) |
| iOS Safari は 7 日間そのサイトで操作が無いと IndexedDB も localStorage も消す。`persist()` はホーム画面のアプリなど以外では通らない | README に「保存した PDF が正」 | [MDN StorageManager.persist](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist) |
| Box は「なぞって指を離すとコメント欄が自動で開く」。Zotero iOS には「離すと範囲がずれる」「ポップアップが本文を隠す」不満 | 押したらすぐ入力欄。確定は「＋ コメント」を押したとき | [Box iOS annotations](https://docs.box.com/en/box-mobile/box-for-ios/ios-annotations-highlight-region-and-highlight-text)、[Zotero forums 100203](https://forums.zotero.org/discussion/100203/ios-highlight-moves-after-selection) |
| Material 3: 主領域と共存する standard（非モーダル）シート、半分の既定比 0.5、ハンドルの触れる範囲 48dp。Apple: medium/large の 2 段、作成画面は全高だけ | 半分／全高の非モーダルシート、書くときは全高 | [M3 BottomSheet](https://github.com/material-components/material-components-android/blob/master/docs/components/BottomSheet.md)、[HIG Sheets](https://developer.apple.com/design/human-interface-guidelines/sheets) |
| タッチターゲット 44pt（HIG）／48dp（M3）。片手持ちが 49%、操作の 75% は親指。頻度の高い操作は画面下の中央寄り | 下部バーに戻す・付箋・コメント・保存、まれな操作は「…」 | [HIG Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)、[A List Apart: How We Hold Our Gadgets](https://alistapart.com/article/how-we-hold-our-gadgets/) |
| M3 の動き: 250〜400ms、emphasized decelerate `cubic-bezier(0.05, 0.7, 0.1, 1)` | シートの開閉 300ms / 200ms | [M3 Motion](https://github.com/material-components/material-components-android/blob/master/docs/theming/Motion.md) |

## 実装後の差分

実装しながら判明し、設計から変えた点。理由を添える。

- **下部バーは 5 項目（戻す・やり直す・付箋・コメント・保存）**。いったん「下部は少数の項目」という UX 調査に合わせてやり直すを「…」へ移したが、独立の UX 評価とコードレビューの両方で「設計の図と違う・やり直すが見つからない」と指摘されたので、設計の図どおりに戻した。320px でも 1 項目 61px（44px 以上）に収まる（360px 未満はラベルを 10px に）。
- **「＋ コメント」は、スマホ用画面では下部バーの上に浮かせず、下部バーそのものを「解除／＋ コメント」に差し替える**。浮かせると本文の下端を隠す。iPad などスマホ用画面でない指の操作では、本文の下端中央に固定して出す。
- **シートは下部バーを覆わず、その上に置く**。一覧を見ながら戻す・保存を押せるように。入力中だけ下部バーを隠し、シートをキーボードの上まで伸ばす。
- **「書くときは全高」は入力中だけにし、新しいコメントを書き終えたら（一覧の外を触る・キーボードの「完了」）開く前の段へ戻す**。添削で何十件も続けて付けるとき、毎回シートを閉じる手間を無くすため。一覧の中のボタンを押してフォーカスが外れたとき（iOS はボタンにフォーカスを移さない）は戻さない。
- **空のまま書き終えたら「ハイライトだけ残しました［取り消す］」（付箋は「空の付箋を残しました」）を出す**。UX 調査の提案。
- **ピンチは CSS の変形ではなく、指の動きごとにページの寸法を変え、離したら描き直す**（PDF.js 本家と同じやり方）。変形で伸ばすとスクロール量とずれ、縮小中にブラウザがスクロール位置を丸めるため。`pinch.ts` は作らず、pdfjs-dist の `TouchManager` を `PdfViewer` から使った。ハイライト・付箋はページに対する % で置き、倍率が変わっても描き直さない。
- **描き直しは新しいキャンバスに描いてから差し替える**。キャンバスの寸法を変えると中身が消えるので、倍率を変えた直後に白く抜けていた。描く前のキャンバスは 0×0 にした（既定の 300×150 を全ページ分持っていた）。
- **スマホ用画面では「幅に合わせる」をページごとにする**。サンプルの 3 ページ目のような横置きが 1 枚あるだけで、縦のページが幅の 7 割（375px で 254px）に縮んでいた。デスクトップは今まで通り最も広いページに合わせる。
- **選択の矩形はテキストノードだけから取る**。移植した `.endOfContent` が範囲の中に入ると、`range.getClientRects()` にページ全体の矩形（591×837）が混ざることを実測した（ハイライトがページ全体になる）。
- **ツールバーの `overflow: hidden` を外した**。「Markdown ▾」のメニューが切れて押せなかった（公開中の版でも再現）。はみ出しは幅ごとの畳み込みで防ぐ。
- **`interactive-widget` は付けなかった**。Android Chrome の既定（resizes-visual）なら iOS と同じく visual viewport だけが縮み、`--kb` の 1 つの仕組みで両方を扱える。
- **配信物にライセンス表示を残す**（`vite.config.ts` の `comments.legal`）。Vite の既定ではすべて消え、写したアイコンの ISC/MIT の条件を満たせなかった。
- **描画済みキャンバスの上限は「6（タッチ）か 2×見えている枚数+1 の大きい方」だが、表示付近のページは捨てないので 7 枚になることがある**（60 ページの PDF で実測 6〜7 枚・最大 12.5 MP）。品質の基準の「6 枚まで」はこの意味に読み替える。
- **横向きのスマホでは半分の段を使わない**。使える高さが 300px 前後になり、半分（約 143px）だと見出ししか入らなかった。使える高さが 360px 未満なら全高で開き、カードから本文へ移るときは閉じる。
- **ピンチで幅合わせの 1.05 倍以下まで縮めたら「幅に合わせる」に戻す**（iOS の PDF 表示と同じく、幅合わせより小さくは留めない）。独立レビューで、一度ピンチするとページごとの幅合わせに戻れないと指摘された。
- **入力中に段を変える操作（✕・取っ手・ドラッグ・カードからの移動）は、必ず入力をやめてから**。独立レビューで、入力中のまま段だけ変わり、下部バーが隠れたまま残る・後で勝手に段が巻き戻る経路が見つかった。
- **既存の不具合（セキュリティ）を直した**: 返信の id（PDF の `/NM` をそのまま使う）が `innerHTML` に未エスケープで入り、細工した PDF を開くだけでスクリプトが動いた（公開中の版でも再現）。独立レビューで発見し、別コミットにしてある。
- **著者名は OS の `window.prompt` でなく、アプリのダイアログで尋ねる**（独立の UX 評価で「ここだけ素のブラウザ部品」と指摘）。初めてのコメントのときは「決定」のタップの中で続けてコメントを作り、入力欄へフォーカスする（iOS がキーボードを出せるように）。
- **付箋モードに入ったら、スマホ用画面では一覧のシートを閉じる**。開いたままだと、置きたい場所のタップがシートに吸われて何も起きなかった（独立の UX 評価で発見）。
- **タブレット（指・1,099px 以下）では著者名の欄を「…」へ**。押せる大きさ（44px）にすると 768〜834px でツールバーが 14〜80px はみ出し、保存ボタンが欠けていた（独立の UX 評価で発見）。あわせて `.app` の列を `minmax(0, 1fr)` にした（`auto` だとツールバーの最小幅に画面ごと引っぱられ、ファイル名が縮まなかった）。
- **動作の下限は iOS / Safari 17.4・Chrome 119**。pdfjs-dist 6 自体が `Promise.withResolvers`・`AbortSignal.any` を使っているため（`TouchManager` を足しても下限は上がらない）。
