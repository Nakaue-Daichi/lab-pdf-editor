// スマホ用画面のコメント一覧（ボトムシート）の段の管理。段は「閉じる／半分／全高」。
// 768px 以上ではサイドバーのままなので何もしない（.app の data-sheet が "side" になる）。
// 見た目（高さ・位置・動き）は styles.css が data-sheet を見て決める。
import { isCompact, onCompactChange } from './viewport';

export type SheetState = 'closed' | 'half' | 'full';

type Listener = (state: SheetState, compact: boolean) => void;

export class CommentSheet {
  private state: SheetState = 'closed';
  private compact = isCompact();
  private readonly listeners = new Set<Listener>();

  constructor(
    private readonly app: HTMLElement,
    private readonly sheetEl: HTMLElement,
  ) {
    onCompactChange((compact) => {
      this.compact = compact;
      this.apply();
    });
    sheetEl.querySelector('[data-act="sheet-close"]')?.addEventListener('click', () => this.set('closed'));
    sheetEl.querySelector('[data-role="grabber"]')?.addEventListener('click', () => this.set(this.state === 'full' ? 'half' : 'full'));
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

  set(state: SheetState): void {
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

  onChange(listener: Listener): void {
    this.listeners.add(listener);
  }

  private apply(): void {
    this.app.dataset.sheet = this.compact ? this.state : 'side';
    // 閉じたシートの中身にフォーカスや読み上げが行かないようにする
    this.sheetEl.inert = this.compact && this.state === 'closed';
    for (const listener of this.listeners) listener(this.state, this.compact);
  }
}
