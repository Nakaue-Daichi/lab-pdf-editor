// スマホ用画面のコメント一覧（ボトムシート）。段は「閉じる／半分／全高」。
// 768px 以上ではサイドバーのままなので何もしない（.app の data-sheet が "side" になる）。
// 見た目（高さ・位置・動き）は styles.css が data-sheet と is-typing を見て決める。
//
// - 見出し（グラバー・タイトルの行）をドラッグして高さを変え、離すと近い段へ吸い付く（速く払ったら払った向きの段）
// - グラバーをタップすると半分⇄全高、✕ で閉じる
// - 入力欄にフォーカスしている間は全高にし、下端をキーボードの上に合わせる（.app.is-typing）
// - 新しいコメントを書き始めたとき（compose）は、書き終えて一覧の外に出たら開く前の段に戻す（読む作業にすぐ戻れる）
import { snapSheet, type SheetState } from './sheet';
import { isCompact, onCompactChange } from './viewport';

export type { SheetState } from './sheet';

type Listener = (state: SheetState, compact: boolean) => void;

/** これ以上動いたらタップではなくドラッグとみなす（px） */
const DRAG_SLOP = 6;
/** 半分の段を使うのに要る高さ（px）。横向きのスマホ（使える高さ 300px 前後）では半分だと見出ししか入らないので全高にする */
const MIN_ROOM_FOR_HALF = 360;

export class CommentSheet {
  private state: SheetState = 'closed';
  private compact = isCompact();
  private readonly listeners = new Set<Listener>();
  private typing = false;
  /** 新しいコメントを書き始める前の段。書き終えたらここへ戻す */
  private composeReturn: SheetState | null = null;
  private composeId: string | null = null;
  /** 一覧の中を触っている最中か（そのせいで入力欄からフォーカスが外れても、書き終えたとはみなさない） */
  private touchingInside = false;
  private touchingTimer = 0;

  /** 新しいコメントを書き終えた（id は書き始めたコメント） */
  onComposeEnd: ((id: string) => void) | null = null;

  constructor(
    private readonly app: HTMLElement,
    private readonly sheetEl: HTMLElement,
    private readonly topBarEl: HTMLElement,
  ) {
    onCompactChange((compact) => {
      this.compact = compact;
      if (!compact) this.endTyping(false);
      this.apply();
    });
    sheetEl.querySelector('[data-act="sheet-close"]')?.addEventListener('click', () => this.set('closed'));
    this.bindDrag(sheetEl.querySelector<HTMLElement>('.sb-head')!, sheetEl.querySelector<HTMLElement>('[data-role="grabber"]')!);
    this.bindTyping();
    this.apply();
  }

  /** スマホ用画面（シート）か。false ならサイドバー */
  get isSheet(): boolean {
    return this.compact;
  }

  get current(): SheetState {
    return this.state;
  }

  /** 一覧が画面に出ているか（サイドバーなら常に出ている） */
  get isVisible(): boolean {
    return !this.compact || this.state !== 'closed';
  }

  /** 半分の段が使えるだけの高さがあるか */
  get canHalf(): boolean {
    // 下部バーの上端まで（入力中は下部バーを隠しているので、ふだんの高さ 56px を引いて見積もる）
    const bar = this.app.querySelector<HTMLElement>('.mb');
    const bottom = bar && bar.offsetHeight > 0 ? bar.getBoundingClientRect().top : window.innerHeight - 56;
    return bottom - this.topBarEl.getBoundingClientRect().bottom >= MIN_ROOM_FOR_HALF;
  }

  set(state: SheetState): void {
    if (state === 'half' && this.compact && !this.canHalf) state = 'full';
    // 入力中は全高と決めているので、全高以外にするなら入力もやめる（利用者が閉じた・下げた段を、後で書き始める前の段へ巻き戻さない。
    // 入力中のまま閉じると下部バーが隠れたまま残る）
    if (state !== 'full') this.stopTyping();
    if (state === this.state) return;
    this.state = state;
    this.apply();
  }

  toggle(): void {
    this.set(this.state === 'closed' ? 'half' : 'closed');
  }

  /** 閉じていれば開く（開いていればそのまま） */
  reveal(state: Exclude<SheetState, 'closed'> = 'half'): void {
    if (this.compact && this.state === 'closed') this.set(state);
  }

  /**
   * 新しいコメントを書き始める: 全高で開く。書き終えたら今の段へ戻す。
   * 呼び出し元はこの直後に（同じタップの処理の中で）入力欄へフォーカスする。
   */
  beginCompose(id: string): void {
    if (!this.compact) return;
    if (this.composeReturn === null) this.composeReturn = this.state;
    this.composeId = id;
    this.startTyping();
  }

  onChange(listener: Listener): void {
    this.listeners.add(listener);
  }

  private apply(): void {
    this.app.dataset.sheet = this.compact ? this.state : 'side';
    // 閉じたシートの中身にフォーカスや読み上げが行かないようにする
    this.sheetEl.inert = this.compact && this.state === 'closed';
    for (const listener of this.listeners) listener(this.state, this.compact);
  }

  // ---- 入力中は全高・キーボードの上 ----
  private bindTyping(): void {
    this.sheetEl.addEventListener('focusin', (event) => {
      if (this.compact && (event.target as Element).matches('input, textarea')) this.startTyping();
    });
    // 入力欄からフォーカスが外れたら（キーボードの「完了」など）入力中をやめる。移動先が決まってから判定する
    this.sheetEl.addEventListener('focusout', () => window.setTimeout(() => this.checkTyping(), 0));
    // 一覧の中を触ったか（触ったせいでフォーカスが外れたのなら、書き終えても段は戻さない）
    document.addEventListener(
      'pointerdown',
      (event) => {
        const inside = this.sheetEl.contains(event.target as Node);
        window.clearTimeout(this.touchingTimer);
        this.touchingInside = inside;
        if (inside) this.touchingTimer = window.setTimeout(() => (this.touchingInside = false), 600);
        // 一覧の外（全高の間は見えている上部バーくらい）を触ったら書き終えたとみなす。フォーカスを外さないブラウザもある
        else if (this.typing && !(event.target as Element).closest?.('.tb, .mb')) this.endTyping(true);
      },
      { capture: true },
    );
    // キーボードの出入りで一覧の高さが変わったら、入力中の欄が見える位置へ送る
    window.visualViewport?.addEventListener('resize', () => {
      if (!this.typing) return;
      requestAnimationFrame(() => {
        const active = document.activeElement;
        if (active instanceof HTMLElement && this.sheetEl.contains(active)) active.scrollIntoView({ block: 'nearest' });
      });
    });
  }

  private startTyping(): void {
    if (!this.typing) {
      this.typing = true;
      this.app.classList.add('is-typing');
    }
    this.set('full');
  }

  /** 入力欄にフォーカスが残っていなければ入力中をやめる。一覧の中を触ったせいなら段はそのまま */
  private checkTyping(): void {
    if (!this.typing) return;
    const active = document.activeElement;
    if (active instanceof Element && this.sheetEl.contains(active) && active.matches('input, textarea')) return;
    this.endTyping(!this.touchingInside);
  }

  /**
   * 入力中をやめる。restore なら、新しいコメントを書き始める前の段へ戻す（読む作業にすぐ戻れる）。
   * 書き始めたコメントがあれば onComposeEnd で知らせる（空のままなら「取り消す」を出すため）。
   */
  private endTyping(restore: boolean): void {
    if (!this.typing) return;
    this.typing = false;
    this.app.classList.remove('is-typing');
    const back = this.composeReturn;
    const id = this.composeId;
    this.composeReturn = null;
    this.composeId = null;
    if (restore && back !== null) this.set(back);
    if (id !== null) this.onComposeEnd?.(id);
  }

  /** シートを閉じる・動かすときに、入力中なら（キーボードも）やめる。段は呼び出し元が決める */
  private stopTyping(): void {
    if (!this.typing) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && this.sheetEl.contains(active)) active.blur();
    this.endTyping(false);
  }

  // ---- 見出しのドラッグ ----
  private bindDrag(head: HTMLElement, grabber: HTMLElement): void {
    let startY = 0;
    let startHeight = 0;
    let dragging = false;
    let pointerId = -1;
    let samples: { t: number; h: number }[] = [];

    const room = (): number => {
      // シートの下端（下部バーの上、入力中はキーボードの上）から上部バーの下まで
      const bottom = this.sheetEl.getBoundingClientRect().bottom;
      return Math.max(0, bottom - this.topBarEl.getBoundingClientRect().bottom);
    };

    head.addEventListener('pointerdown', (event) => {
      if (!this.compact || this.state === 'closed' || event.button !== 0) return;
      // 見出しの中のボタン（前後・閉じる）はそのまま押させる。グラバーはタップとドラッグの両方
      const target = event.target as Element;
      if (target.closest('button') && !target.closest('[data-role="grabber"]')) return;
      // 入力中をやめるのは離したとき（押した瞬間にやめるとシートの位置が変わり、タップが取っ手から外れる）
      pointerId = event.pointerId;
      startY = event.clientY;
      startHeight = this.sheetEl.getBoundingClientRect().height;
      dragging = false;
      samples = [{ t: event.timeStamp, h: startHeight }];
    });
    head.addEventListener('pointermove', (event) => {
      if (event.pointerId !== pointerId) return;
      const dy = event.clientY - startY;
      if (!dragging) {
        if (Math.abs(dy) < DRAG_SLOP) return;
        dragging = true;
        try {
          head.setPointerCapture(pointerId); // 指が見出しの外へ出ても追い続ける
        } catch {
          /* すでに離された指など。追えなくても離したときの処理は動く */
        }
        this.sheetEl.classList.add('is-dragging');
      }
      const height = Math.min(room(), Math.max(0, startHeight - dy));
      this.sheetEl.style.height = `${height}px`;
      samples.push({ t: event.timeStamp, h: height });
      if (samples.length > 6) samples.shift();
    });
    const finish = (event: PointerEvent): void => {
      if (event.pointerId !== pointerId) return;
      pointerId = -1;
      if (!dragging) return;
      dragging = false;
      const last = samples[samples.length - 1] as { t: number; h: number };
      const first = samples.find((s) => last.t - s.t <= 80) ?? last;
      const velocity = last.t > first.t ? (last.h - first.h) / (last.t - first.t) : 0;
      const full = room();
      const next = snapSheet(last.h, velocity, full * 0.5, full);
      // インラインの高さを外すと、CSS の段の高さへ transition で吸い付く。シートを動かしたら書くのはやめる
      this.sheetEl.classList.remove('is-dragging');
      this.sheetEl.style.height = '';
      this.stopTyping();
      this.set(next);
      // ドラッグの直後に来る click をグラバーのタップ（段の切り替え）と取り違えない
      const swallow = (e: Event): void => e.stopImmediatePropagation();
      grabber.addEventListener('click', swallow, { capture: true, once: true });
      window.setTimeout(() => grabber.removeEventListener('click', swallow, { capture: true }), 300);
    };
    head.addEventListener('pointerup', finish);
    head.addEventListener('pointercancel', finish);
    grabber.addEventListener('click', () => {
      this.stopTyping();
      this.set(this.state === 'full' ? 'half' : 'full');
    });
  }
}
