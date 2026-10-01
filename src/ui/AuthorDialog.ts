// 著者名を尋ねる小さなダイアログ（window.prompt の代わり。見た目を他の部品とそろえ、入力欄は 16px）。
// done は「決定」「キャンセル」のタップの処理の中で同期的に呼ぶ。続けて入力欄へフォーカスしたとき、
// iOS がキーボードを出すのはユーザー操作の処理の中だけなので、close イベント（後から来る）では呼ばない。

export interface AuthorDialogOptions {
  /** 今の著者名（初期値） */
  current: string;
  /** 見出しの下の説明 */
  message: string;
}

export function askAuthor(options: AuthorDialogOptions, done: (name: string | null) => void): void {
  const dialog = document.createElement('dialog');
  dialog.className = 'dlg';
  dialog.setAttribute('aria-labelledby', 'dlg-author-title');
  dialog.innerHTML = `
    <form class="dlg-body">
      <h2 class="dlg-title" id="dlg-author-title">著者名</h2>
      <p class="dlg-text"></p>
      <input class="dlg-input" type="text" name="author" autocomplete="name" enterkeyhint="done" placeholder="あなたの名前" />
      <div class="dlg-actions">
        <button type="button" class="dlg-btn" data-act="cancel">キャンセル</button>
        <button type="submit" class="dlg-btn dlg-btn-primary">決定</button>
      </div>
    </form>
  `;
  dialog.querySelector<HTMLElement>('.dlg-text')!.textContent = options.message;
  const input = dialog.querySelector<HTMLInputElement>('input')!;
  input.value = options.current;

  let finished = false;
  const finish = (name: string | null): void => {
    if (finished) return;
    finished = true;
    dialog.close();
    dialog.remove();
    done(name);
  };
  dialog.querySelector('form')!.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = input.value.trim();
    finish(name === '' ? null : name);
  });
  dialog.querySelector('[data-act="cancel"]')!.addEventListener('click', () => finish(null));
  // Esc・背景のタップ
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    finish(null);
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) finish(null);
  });

  document.body.append(dialog);
  dialog.showModal();
  input.focus();
  input.select();
}
