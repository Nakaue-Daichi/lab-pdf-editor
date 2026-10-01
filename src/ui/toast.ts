// 画面の下に短時間出る通知。成功・失敗の両方に使う。action を渡すとボタン（「取り消す」など）を 1 つ付ける。
let host: HTMLDivElement | null = null;

function ensureHost(): HTMLDivElement {
  if (!host) {
    host = document.createElement('div');
    host.className = 'toast-host';
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    document.body.append(host);
  }
  return host;
}

export interface ToastAction {
  label: string;
  run(): void;
}

export function toast(
  message: string,
  kind: 'info' | 'error' = 'info',
  durationMs = kind === 'error' ? 6000 : 3500,
  action?: ToastAction,
): void {
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.textContent = message;
  const leave = (): void => {
    el.classList.add('is-leaving');
    window.setTimeout(() => el.remove(), 300);
  };
  if (action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'toast-action';
    button.textContent = action.label;
    button.addEventListener('click', () => {
      action.run();
      leave();
    });
    el.append(button);
  }
  ensureHost().append(el);
  window.setTimeout(leave, durationMs);
}
