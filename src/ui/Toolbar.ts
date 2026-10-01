// 操作列。状態は持たず、押されたことを actions で通知する。
// 画面上部のツールバーと、スマホ用画面の下部バー（よく使う操作を親指の届く位置に置く）の 2 つを持つ。
// どのボタンをどの幅で出すかは styles.css が決める（data-wide = 1,440px 以上だけ、data-desk = スマホ用画面では隠す）。
import type { ZoomMode } from '../viewer/PdfViewer';
import { icon } from './icons';

export interface ToolbarActions {
  openFiles(files: FileList): void;
  openSample(): void;
  importFiles(files: FileList): void;
  savePdf(): void;
  copyMarkdown(): void;
  saveMarkdown(): void;
  setAuthor(name: string): void;
  /** 著者名を尋ねて変える（入力欄の無いスマホ用画面から） */
  editAuthor(): void;
  undo(): void;
  redo(): void;
  setZoom(mode: ZoomMode): void;
  toggleNoteMode(): void;
  /** コメント一覧（スマホ用画面のシート）を開閉する */
  toggleComments(): void;
  /** 選択中の文字列にコメントを付ける（スマホ用画面の下部バー） */
  commentSelection(): void;
  /** 文字の選択をやめる */
  cancelSelection(): void;
}

const ZOOM_OPTIONS: { label: string; value: ZoomMode }[] = [
  { label: '幅に合わせる', value: 'fit-width' },
  { label: '75%', value: 75 },
  { label: '100%', value: 100 },
  { label: '125%', value: 125 },
  { label: '150%', value: 150 },
  { label: '200%', value: 200 },
];

export class Toolbar {
  readonly el: HTMLElement;
  /** スマホ用画面の下部バー */
  readonly bottomEl: HTMLElement;
  private readonly fileInput: HTMLInputElement;
  private readonly importInput: HTMLInputElement;
  private readonly authorInput: HTMLInputElement;
  private readonly authorMenuLabel: HTMLSpanElement;
  private readonly zoomSelect: HTMLSelectElement;
  private readonly customZoomOption: HTMLOptionElement;
  private readonly fileLabel: HTMLSpanElement;
  private readonly commentCount: HTMLSpanElement;
  private readonly menus: HTMLDetailsElement[];
  private readonly docControls: HTMLElement[];

  constructor(parent: HTMLElement, actions: ToolbarActions) {
    this.el = document.createElement('header');
    this.el.className = 'tb';
    this.el.innerHTML = `
      <div class="tb-brand"><span class="tb-logo"></span><span class="tb-brand-text">論文 PDF レビュー</span></div>
      <button type="button" class="tb-btn" data-act="open" data-desk>PDF を開く</button>
      <button type="button" class="tb-btn tb-btn-quiet" data-act="sample" data-wide>サンプルで試す</button>
      <span class="tb-file" data-role="file"></span>
      <div class="tb-spacer"></div>
      <label class="tb-author" data-desk><span class="tb-author-label">著者名</span> <input type="text" data-role="author" placeholder="あなたの名前" autocomplete="name" /></label>
      <select class="tb-zoom" data-role="zoom" data-desk title="表示倍率" aria-label="表示倍率"></select>
      <button type="button" class="tb-btn tb-btn-icon" data-act="undo" data-role="undo" data-desk aria-label="元に戻す" title="元に戻す（⌘Z / Ctrl+Z）" disabled>↶</button>
      <button type="button" class="tb-btn tb-btn-icon" data-act="redo" data-role="redo" data-desk aria-label="やり直す" title="やり直す（⇧⌘Z / Ctrl+Y）" disabled>↷</button>
      <button type="button" class="tb-btn tb-toggle" data-act="note" data-role="note" data-doc data-desk title="ページをクリックした場所に付箋を置く（N）">付箋</button>
      <button type="button" class="tb-btn" data-act="import" data-doc data-wide title="同じ原稿の注釈入り PDF を選んでコメントを統合する">コメントを取り込む</button>
      <details class="tb-menu" data-role="md" data-wide>
        <summary class="tb-btn" data-doc>Markdown ▾</summary>
        <div class="tb-menu-list">
          <button type="button" data-act="md-copy">クリップボードにコピー</button>
          <button type="button" data-act="md-save">.md ファイルを保存</button>
        </div>
      </details>
      <details class="tb-menu tb-more" data-role="more">
        <summary class="tb-btn tb-btn-icon" aria-label="その他の操作" title="その他の操作">${icon('ellipsis')}</summary>
        <div class="tb-menu-list">
          <button type="button" data-act="redo" data-role="redo" data-compact disabled>${icon('redo-2')}やり直す</button>
          <button type="button" data-act="open" data-compact>${icon('folder-open')}PDF を開く</button>
          <button type="button" data-act="sample">${icon('file-text')}サンプルで試す</button>
          <button type="button" data-act="author-edit" data-compact>${icon('user-round')}<span>著者名<span class="tb-menu-sub" data-role="author-label"></span></span></button>
          <button type="button" data-act="fit" data-doc data-compact>${icon('move-horizontal')}幅に合わせる</button>
          <hr />
          <button type="button" data-act="import" data-doc>${icon('import')}コメントを取り込む</button>
          <button type="button" data-act="md-copy" data-doc>${icon('copy')}Markdown をコピー</button>
          <button type="button" data-act="md-save" data-doc>${icon('file-down')}.md ファイルを保存</button>
        </div>
      </details>
      <button type="button" class="tb-btn tb-btn-primary" data-act="save" data-doc data-desk title="コメントを PDF 注釈として埋め込んで保存（⌘S / Ctrl+S）"><span class="tb-save-long">コメント付き PDF を保存</span><span class="tb-save-short">保存</span></button>
      <input type="file" accept="application/pdf,.pdf" hidden data-role="file-input" />
      <input type="file" accept="application/pdf,.pdf" multiple hidden data-role="import-input" />
    `;
    parent.append(this.el);

    this.bottomEl = document.createElement('nav');
    this.bottomEl.className = 'mb';
    this.bottomEl.setAttribute('aria-label', '操作');
    this.bottomEl.innerHTML = `
      <div class="mb-row mb-tools">
        <button type="button" class="mb-btn" data-act="undo" data-role="undo" disabled>${icon('undo-2')}<span>戻す</span></button>
        <button type="button" class="mb-btn tb-toggle" data-act="note" data-role="note" data-doc>${icon('sticky-note')}<span>付箋</span></button>
        <button type="button" class="mb-btn" data-act="comments" data-role="comments" data-doc aria-expanded="false">${icon('messages-square')}<span>コメント<b class="mb-count" data-role="count">0</b></span></button>
        <button type="button" class="mb-btn mb-btn-primary" data-act="save" data-doc>${icon('download')}<span>保存</span></button>
      </div>
      <div class="mb-row mb-selecting">
        <button type="button" class="mb-btn mb-btn-wide" data-act="sel-cancel">${icon('x')}<span>解除</span></button>
        <button type="button" class="mb-btn mb-btn-primary mb-btn-comment" data-act="sel-comment">＋ コメント</button>
      </div>
    `;
    parent.append(this.bottomEl);

    this.fileInput = this.query<HTMLInputElement>('[data-role="file-input"]');
    this.importInput = this.query<HTMLInputElement>('[data-role="import-input"]');
    this.authorInput = this.query<HTMLInputElement>('[data-role="author"]');
    this.authorMenuLabel = this.query<HTMLSpanElement>('[data-role="author-label"]');
    this.zoomSelect = this.query<HTMLSelectElement>('[data-role="zoom"]');
    this.fileLabel = this.query<HTMLSpanElement>('[data-role="file"]');
    this.commentCount = this.bottomEl.querySelector<HTMLSpanElement>('[data-role="count"]')!;
    this.menus = Array.from(this.el.querySelectorAll<HTMLDetailsElement>('details.tb-menu'));
    this.docControls = [this.el, this.bottomEl].flatMap((root) => Array.from(root.querySelectorAll<HTMLElement>('[data-doc]')));

    for (const opt of ZOOM_OPTIONS) {
      const option = document.createElement('option');
      option.value = String(opt.value);
      option.textContent = opt.label;
      this.zoomSelect.append(option);
    }
    // ピンチなどで選択肢に無い倍率になったときに表示する枠
    this.customZoomOption = document.createElement('option');
    this.customZoomOption.hidden = true;
    this.zoomSelect.append(this.customZoomOption);

    const onClick = (event: Event): void => {
      const button = (event.target as Element).closest<HTMLElement>('[data-act]');
      if (!button || button.matches(':disabled')) return;
      if (button.closest('.tb-menu-list')) this.closeMenus();
      switch (button.dataset.act) {
        case 'open':
          this.fileInput.click();
          break;
        case 'sample':
          actions.openSample();
          break;
        case 'import':
          this.importInput.click();
          break;
        case 'note':
          actions.toggleNoteMode();
          break;
        case 'undo':
          actions.undo();
          break;
        case 'redo':
          actions.redo();
          break;
        case 'save':
          actions.savePdf();
          break;
        case 'md-copy':
          actions.copyMarkdown();
          break;
        case 'md-save':
          actions.saveMarkdown();
          break;
        case 'author-edit':
          actions.editAuthor();
          break;
        case 'fit':
          actions.setZoom('fit-width');
          break;
        case 'comments':
          actions.toggleComments();
          break;
        case 'sel-comment':
          actions.commentSelection();
          break;
        case 'sel-cancel':
          actions.cancelSelection();
          break;
      }
    };
    this.el.addEventListener('click', onClick);
    this.bottomEl.addEventListener('click', onClick);
    // 下部バーの「＋ コメント」は押しても文字の選択を消さない（マウス）
    this.bottomEl.addEventListener('mousedown', (event) => {
      if ((event.target as Element).closest('[data-act="sel-comment"]')) event.preventDefault();
    });
    // メニューは 1 つだけ開き、外を押したら閉じる
    for (const menu of this.menus) {
      menu.addEventListener('toggle', () => {
        if (menu.open) for (const other of this.menus) if (other !== menu) other.open = false;
      });
    }
    document.addEventListener('pointerdown', (event) => {
      if (!(event.target as Element).closest?.('details.tb-menu')) this.closeMenus();
    });

    this.fileInput.addEventListener('change', () => {
      if (this.fileInput.files?.length) actions.openFiles(this.fileInput.files);
      this.fileInput.value = '';
    });
    this.importInput.addEventListener('change', () => {
      if (this.importInput.files?.length) actions.importFiles(this.importInput.files);
      this.importInput.value = '';
    });
    this.authorInput.addEventListener('change', () => actions.setAuthor(this.authorInput.value));
    this.authorInput.addEventListener('blur', () => actions.setAuthor(this.authorInput.value));
    this.zoomSelect.addEventListener('change', () => {
      const value = this.zoomSelect.value;
      actions.setZoom(value === 'fit-width' ? 'fit-width' : Number(value));
    });
    this.setDocumentOpen(false);
  }

  private query<T extends Element>(selector: string): T {
    const el = this.el.querySelector<T>(selector);
    if (!el) throw new Error(`Toolbar: ${selector} が見つかりません`);
    return el;
  }

  private all<T extends Element>(selector: string): T[] {
    return [this.el, this.bottomEl].flatMap((root) => Array.from(root.querySelectorAll<T>(selector)));
  }

  closeMenus(): void {
    for (const menu of this.menus) menu.open = false;
  }

  setAuthor(name: string): void {
    if (this.authorInput.value !== name) this.authorInput.value = name;
    this.authorMenuLabel.textContent = name ? `：${name}` : '：未設定';
  }

  focusAuthor(): void {
    this.authorInput.focus();
    this.authorInput.select();
  }

  /** ファイルの input を開く（空状態の「PDF を開く」から） */
  pickFile(): void {
    this.fileInput.click();
  }

  setFile(fileName: string | null, pageCount: number): void {
    this.fileLabel.textContent = fileName ? `${fileName} · ${pageCount} ページ` : '';
    this.fileLabel.title = fileName ?? '';
    this.setDocumentOpen(fileName !== null);
  }

  setNoteMode(on: boolean): void {
    for (const button of this.all<HTMLButtonElement>('[data-role="note"]')) {
      button.classList.toggle('is-on', on);
      button.setAttribute('aria-pressed', String(on));
    }
  }

  /** 元に戻す／やり直すの押せる状態（履歴が空なら押せない） */
  setHistory(canUndo: boolean, canRedo: boolean): void {
    for (const b of this.all<HTMLButtonElement>('[data-role="undo"]')) b.toggleAttribute('disabled', !canUndo);
    for (const b of this.all<HTMLButtonElement>('[data-role="redo"]')) b.toggleAttribute('disabled', !canRedo);
  }

  setZoom(mode: ZoomMode): void {
    const preset = ZOOM_OPTIONS.some((o) => o.value === mode);
    this.customZoomOption.hidden = preset;
    if (!preset) {
      this.customZoomOption.value = String(mode);
      this.customZoomOption.textContent = `${mode}%`;
    }
    this.zoomSelect.value = String(mode);
  }

  setCommentCount(count: number): void {
    this.commentCount.textContent = String(count);
  }

  /** シートが開いているか（下部バーの「コメント」を押された見た目にする） */
  setCommentsOpen(open: boolean): void {
    const button = this.bottomEl.querySelector<HTMLElement>('[data-role="comments"]')!;
    button.classList.toggle('is-on', open);
    button.setAttribute('aria-expanded', String(open));
  }

  /** 文字を選んでいる間は下部バーを「解除／＋ コメント」に差し替える */
  setSelecting(on: boolean): void {
    this.bottomEl.classList.toggle('is-selecting', on);
  }

  /** 保存ボタンの絵（共有シートが使えるなら共有、使えなければダウンロード） */
  setSaveIcon(kind: 'share' | 'download'): void {
    const button = this.bottomEl.querySelector<HTMLElement>('[data-act="save"]')!;
    button.querySelector('svg')?.remove();
    button.insertAdjacentHTML('afterbegin', icon(kind));
  }

  private setDocumentOpen(open: boolean): void {
    for (const el of this.docControls) el.toggleAttribute('disabled', !open);
    this.zoomSelect.toggleAttribute('disabled', !open);
  }
}
