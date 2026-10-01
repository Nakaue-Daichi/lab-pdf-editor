// 部品をつなぐ。状態は ReviewStore、描画は PdfViewer、一覧は Sidebar、操作は Toolbar。
import 'pdfjs-dist/web/pdf_viewer.css';
import './styles.css';
import { downloadBytes, downloadText } from './export/download';
import { markdownFileName, reviewedFileName } from './export/filenames';
import { toMarkdown } from './export/markdown';
import { mergeComments } from './model/merge';
import { ReviewStore } from './model/store';
import { readAnnotations, writeAnnotations } from './pdf/annotations';
import { sha256Hex } from './pdf/hash';
import { loadPdfDocument, PdfOpenError, type LoadedPdf } from './pdf/loader';
import { deleteDraft, loadDraft, saveDraft } from './storage/drafts';
import { CommentSheet } from './ui/CommentSheet';
import { renderEmptyState } from './ui/EmptyState';
import { Sidebar } from './ui/Sidebar';
import { toast } from './ui/toast';
import { Toolbar } from './ui/Toolbar';
import { isCompact, onCompactChange, trackVisualViewport } from './ui/viewport';
import { hitTestHighlight } from './viewer/hittest';
import { PdfViewer } from './viewer/PdfViewer';
import { watchTextSelection, type TextSelection } from './viewer/selection';

const AUTHOR_KEY = 'lab-pdf-editor.author';
const DRAFT_DEBOUNCE_MS = 500;

interface OpenDocument {
  bytes: Uint8Array;
  hash: string;
  fileName: string;
  pdf: LoadedPdf;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function formatNow(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.matches('input, textarea, select, [contenteditable]') || target.isContentEditable);
}

export function startApp(root: HTMLElement): void {
  const store = new ReviewStore();
  let current: OpenDocument | null = null;
  let noteMode = false;
  let pendingSelection: TextSelection | null = null;
  let draftTimer = 0;

  // ---- 骨組み ----
  const app = document.createElement('div');
  app.className = 'app';
  root.replaceChildren(app);
  trackVisualViewport();

  const toolbar = new Toolbar(app, {
    openFiles: (files) => void openFile(files[0] as File),
    openSample: () => void openSample(),
    importFiles: (files) => void importFiles(files),
    savePdf: () => void savePdf(),
    copyMarkdown: () => void copyMarkdown(),
    saveMarkdown,
    setAuthor,
    editAuthor,
    setZoom: (mode) => {
      viewer.setZoom(mode);
      toolbar.setZoom(viewer.zoom);
    },
    toggleNoteMode: () => setNoteMode(!noteMode),
    toggleComments: () => sheet.toggle(),
    commentSelection: () => commentOnSelection(),
    cancelSelection: () => clearTextSelection(),
    undo,
    redo,
  });

  const main = document.createElement('div');
  main.className = 'app-main';
  // 下部バー（スマホ用画面）は .app の 3 段目に来るよう、本文の前に入れておいたものを後ろへ回す
  app.insertBefore(main, toolbar.bottomEl);
  const viewerWrap = document.createElement('div');
  viewerWrap.className = 'app-viewer';
  main.append(viewerWrap);

  const viewer = new PdfViewer(viewerWrap);
  viewer.el.hidden = true;
  viewer.setFitEachPage(isCompact());
  onCompactChange((compact) => viewer.setFitEachPage(compact));
  const emptyState = renderEmptyState(viewerWrap, {
    openSample: () => void openSample(),
    pickFile: () => toolbar.pickFile(),
  });
  const sidebar = new Sidebar(main, store, { onJump: (c) => viewer.scrollToComment(c) });
  const sheet = new CommentSheet(app, sidebar.el);
  sheet.onChange((state, compact) => toolbar.setCommentsOpen(compact && state !== 'closed'));

  const selectButton = document.createElement('button');
  selectButton.type = 'button';
  selectButton.className = 'pv-select-btn';
  selectButton.textContent = '＋ コメント';
  selectButton.hidden = true;
  document.body.append(selectButton);

  // ---- 著者名 ----
  try {
    store.setAuthor(localStorage.getItem(AUTHOR_KEY) ?? '');
  } catch {
    /* localStorage が使えない環境では毎回入力してもらう */
  }
  toolbar.setAuthor(store.author);

  function setAuthor(name: string): void {
    store.setAuthor(name);
    toolbar.setAuthor(store.author);
    try {
      localStorage.setItem(AUTHOR_KEY, store.author);
    } catch {
      /* 保存できなくても動作には支障ない */
    }
  }

  function ensureAuthor(): boolean {
    if (store.author) return true;
    const name = window.prompt('あなたの名前を入れてください（コメントの著者として PDF に記録されます）');
    if (!name || !name.trim()) {
      toast('著者名を入れるとコメントを付けられます', 'error');
      toolbar.focusAuthor();
      return false;
    }
    setAuthor(name);
    return true;
  }

  /** 入力欄の無いスマホ用画面で著者名を変える */
  function editAuthor(): void {
    const name = window.prompt('著者名（コメントの著者として PDF に記録されます）', store.author);
    if (name !== null) setAuthor(name);
  }

  // ---- 文書を開く ----
  async function openFile(file: File): Promise<void> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    await openBytes(bytes, file.name);
  }

  async function openSample(): Promise<void> {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}sample/sample.pdf`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await openBytes(new Uint8Array(await res.arrayBuffer()), 'sample.pdf');
    } catch (err) {
      toast(`サンプルを読み込めませんでした: ${errorMessage(err)}`, 'error');
    }
  }

  async function openBytes(bytes: Uint8Array, fileName: string): Promise<void> {
    let pdf: LoadedPdf;
    try {
      pdf = await loadPdfDocument(bytes);
    } catch (err) {
      toast(err instanceof PdfOpenError ? err.message : `PDF を開けませんでした: ${errorMessage(err)}`, 'error');
      return;
    }
    let read;
    try {
      read = await readAnnotations(bytes);
    } catch (err) {
      await pdf.destroy();
      toast(`注釈を読み取れませんでした: ${errorMessage(err)}`, 'error');
      return;
    }

    const hash = await sha256Hex(bytes);
    let comments = read.comments;
    let restored = 0;
    try {
      const draft = await loadDraft(hash);
      if (draft) {
        const merged = mergeComments(read.comments, draft.comments);
        comments = merged.merged;
        restored = merged.added;
      }
    } catch {
      /* IndexedDB が使えない環境では下書き無しで進む */
    }

    if (current) await current.pdf.destroy();
    current = { bytes, hash, fileName, pdf };
    store.openDocument({ fileName, pageCount: read.pageCount, comments, foreignAnnotations: read.foreignAnnotations });

    app.classList.add('has-doc');
    emptyState.hidden = true;
    viewer.el.hidden = false;
    await viewer.load(pdf.doc);
    viewer.setComments(store.comments, store.selectedId);
    toolbar.setFile(fileName, read.pageCount);
    toolbar.setZoom(viewer.zoom);
    setNoteMode(false);
    if (restored > 0) toast(`前回の下書きからコメント ${restored} 件を復元しました`);
  }

  // ---- 元に戻す・やり直す ----
  function undo(): void {
    if (!store.undo()) toast('これ以上戻せません');
  }

  function redo(): void {
    if (!store.redo()) toast('やり直せる操作はありません');
  }

  // ---- Store の変化を画面へ ----
  store.subscribe((event) => {
    toolbar.setHistory(store.canUndo, store.canRedo);
    toolbar.setCommentCount(store.comments.length);
    if (event.type === 'comments' || event.type === 'text') scheduleDraftSave();
    if (event.type === 'comments' || event.type === 'selection' || event.type === 'document') {
      viewer.setComments(store.comments, store.selectedId);
    }
  });

  function scheduleDraftSave(): void {
    window.clearTimeout(draftTimer);
    draftTimer = window.setTimeout(() => {
      if (!current || !store.doc) return;
      saveDraft(current.hash, { fileName: current.fileName, comments: store.doc.comments, updatedAt: new Date().toISOString() }).catch(
        (err: unknown) => console.warn('下書きを保存できませんでした', err),
      );
    }, DRAFT_DEBOUNCE_MS);
  }

  // ---- 文字選択 → ハイライト ----
  watchTextSelection(
    viewer.el,
    (el) => viewer.pageViewFor(el),
    (selection) => {
      pendingSelection = selection;
      if (!selection) {
        selectButton.hidden = true;
        return;
      }
      const { lastRect } = selection;
      selectButton.hidden = false;
      const width = selectButton.offsetWidth || 110;
      const left = Math.min(lastRect.right + 8, window.innerWidth - width - 8);
      const top = lastRect.top - 38 >= 0 ? lastRect.top - 38 : lastRect.bottom + 8;
      selectButton.style.left = `${Math.max(8, left)}px`;
      selectButton.style.top = `${top}px`;
    },
  );
  selectButton.addEventListener('mousedown', (event) => event.preventDefault()); // 押しても選択を消さない
  selectButton.addEventListener('click', () => commentOnSelection());

  /** 選んでいる文字列にハイライトとコメントを付け、入力欄にフォーカスする */
  function commentOnSelection(): void {
    if (!pendingSelection || !ensureAuthor()) return;
    const c = store.addHighlight(pendingSelection);
    clearTextSelection();
    sidebar.focusComment(c.id);
  }

  function clearTextSelection(): void {
    document.getSelection()?.removeAllRanges();
    pendingSelection = null;
    selectButton.hidden = true;
    toolbar.setSelecting(false);
  }

  // ---- ページ上のクリック: 付箋を置く／ハイライトを選ぶ ----
  viewer.onPageClick = (pageIndex, point) => {
    if (noteMode) {
      if (!ensureAuthor()) return;
      const c = store.addNote({ pageIndex, point });
      setNoteMode(false);
      sidebar.focusComment(c.id);
      return;
    }
    const sel = document.getSelection();
    if (sel && !sel.isCollapsed) return; // 選択直後のクリックは無視
    const hit = hitTestHighlight(store.comments, pageIndex, point);
    store.select(hit ? hit.id : null);
  };
  viewer.onSelectNote = (id) => store.select(id);

  function setNoteMode(on: boolean): void {
    noteMode = on && current !== null;
    viewer.el.classList.toggle('note-mode', noteMode);
    toolbar.setNoteMode(noteMode);
  }

  // ---- 保存・書き出し・取り込み ----
  async function savePdf(): Promise<void> {
    if (!current || !store.doc) return;
    const name = reviewedFileName(current.fileName);
    try {
      const out = await writeAnnotations(current.bytes, store.doc.comments);
      downloadBytes(out, name);
      await deleteDraft(current.hash).catch(() => undefined);
      toast(`${name} を保存しました（コメント ${store.doc.comments.length} 件）`);
    } catch (err) {
      toast(`保存に失敗しました: ${errorMessage(err)}`, 'error');
    }
  }

  function currentMarkdown(): string | null {
    if (!current || !store.doc) return null;
    return toMarkdown({ fileName: current.fileName, comments: store.doc.comments }, { generatedAt: formatNow() });
  }

  async function copyMarkdown(): Promise<void> {
    const md = currentMarkdown();
    if (md === null || !current) return;
    try {
      await navigator.clipboard.writeText(md);
      toast('Markdown をクリップボードにコピーしました');
    } catch {
      downloadText(md, markdownFileName(current.fileName));
      toast('クリップボードが使えないため .md ファイルとして保存しました');
    }
  }

  function saveMarkdown(): void {
    const md = currentMarkdown();
    if (md === null || !current) return;
    downloadText(md, markdownFileName(current.fileName));
  }

  async function importFiles(files: FileList): Promise<void> {
    if (!store.doc) return;
    // FileList は呼び出し元が input を空にすると同時に空になるので、先に配列へ写す
    const list = Array.from(files);
    let added = 0;
    let skipped = 0;
    const errors: string[] = [];
    for (const file of list) {
      try {
        const read = await readAnnotations(new Uint8Array(await file.arrayBuffer()));
        const result = store.mergeFrom(read);
        added += result.added;
        skipped += result.skipped;
      } catch (err) {
        errors.push(`${file.name}: ${errorMessage(err)}`);
      }
    }
    if (errors.length < list.length) toast(`取り込み: ${added} 件を追加、${skipped} 件は既にありました`);
    for (const message of errors) toast(message, 'error');
  }

  // ---- ドラッグ＆ドロップ ----
  window.addEventListener('dragover', (event) => {
    event.preventDefault();
    app.classList.add('is-dragging');
  });
  window.addEventListener('dragleave', (event) => {
    if (event.relatedTarget === null) app.classList.remove('is-dragging');
  });
  window.addEventListener('drop', (event) => {
    event.preventDefault();
    app.classList.remove('is-dragging');
    const file = event.dataTransfer?.files?.[0];
    if (file) void openFile(file);
  });

  // ---- キー操作 ----
  window.addEventListener('keydown', (event) => {
    const mod = event.metaKey || event.ctrlKey;
    if (mod && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void savePdf();
      return;
    }
    // 入力欄の中ではブラウザ標準の取り消し（その欄の文字だけ）に任せる
    if (mod && event.key.toLowerCase() === 'z' && !isTypingTarget(event.target)) {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
      return;
    }
    if (mod && event.key.toLowerCase() === 'y' && !isTypingTarget(event.target)) {
      event.preventDefault();
      redo();
      return;
    }
    if (event.key === 'Escape') {
      if (noteMode) setNoteMode(false);
      else store.select(null);
      return;
    }
    if (!mod && event.key.toLowerCase() === 'n' && !isTypingTarget(event.target)) {
      setNoteMode(!noteMode);
    }
  });
}
