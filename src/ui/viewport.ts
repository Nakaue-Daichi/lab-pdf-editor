// 画面の大きさ・入力の種類・ソフトウェアキーボード。
// レイアウトの切り替えは styles.css の media query が正本で、JS が知る必要があるとき（シートかサイドバーか）はここの同じ条件を使う。

/** スマホ用の画面にする条件。styles.css の同名の @media と同じ文字列にしておく */
export const COMPACT_QUERY = '(max-width: 767px), (max-height: 500px) and (pointer: coarse)';

const compactMedia = window.matchMedia(COMPACT_QUERY);

export function isCompact(): boolean {
  return compactMedia.matches;
}

export function onCompactChange(listener: (compact: boolean) => void): void {
  compactMedia.addEventListener('change', (event) => listener(event.matches));
}

/** 指で操作するのが主の端末か（描画の上限・保存の既定を決める） */
export function isTouchDevice(): boolean {
  return navigator.maxTouchPoints > 0 && window.matchMedia('(pointer: coarse)').matches;
}

let lastPointerType = 'mouse';
document.addEventListener(
  'pointerdown',
  (event) => {
    lastPointerType = event.pointerType || 'mouse';
  },
  { capture: true, passive: true },
);

/** 直前の操作が指（またはペン）だったか。iPad のようにマウスと指の両方がある端末で、出し方を操作ごとに変える */
export function lastInputWasTouch(): boolean {
  return lastPointerType === 'touch' || lastPointerType === 'pen';
}

/**
 * 見えている範囲を CSS 変数に置く。--vvh = 見えている高さ、--kb = 下からキーボード等に隠れている高さ。
 * iOS Safari はキーボードを出してもレイアウトの高さを変えないので、下端に固定した要素はキーボードの裏に隠れる。
 * ページ全体を拡大しているとき（scale ≠ 1）は高さの差がキーボードとは限らないので --kb を 0 にする。
 */
export function trackVisualViewport(root: HTMLElement = document.documentElement): void {
  const vv = window.visualViewport;
  const update = (): void => {
    const height = vv ? vv.height : window.innerHeight;
    const hidden = vv && Math.abs(vv.scale - 1) < 0.01 ? window.innerHeight - height - vv.offsetTop : 0;
    root.style.setProperty('--vvh', `${Math.round(height)}px`);
    root.style.setProperty('--kb', `${Math.max(0, Math.round(hidden))}px`);
  };
  vv?.addEventListener('resize', update);
  vv?.addEventListener('scroll', update);
  window.addEventListener('resize', update);
  update();
}
