// 文字層の選択補助。pdfjs-dist の TextLayer だけでは入らない（ビューア部品 TextLayerBuilder 側にある）ので移植した。
// 出典: PDF.js v6.3.289 web/text_layer_builder.js の #bindMouse と #enableGlobalSelectionListener
//       https://github.com/mozilla/pdf.js/blob/v6.3.289/web/text_layer_builder.js
//       Copyright 2012 Mozilla Foundation — Licensed under the Apache License, Version 2.0
//       （http://www.apache.org/licenses/LICENSE-2.0）。変更: 型を付け、DOM を上へたどる箇所に null の確認を足した。
//
// Safari（iOS は全ブラウザがこれ）と古い Chrome では、選択の端が文字の無い所に掛かると選択がページ先頭まで飛ぶ。
// 選択が動いている端の <span> の隣へ .endOfContent（user-select: text の空のブロック）を差し込み、飛び先を抑える。
// 見た目の CSS は pdfjs-dist/web/pdf_viewer.css の .textLayer .endOfContent と .textLayer.selecting .endOfContent。

/** 登録中の文字層 → その .endOfContent */
const layers = new Map<HTMLElement, HTMLElement>();
let globalAbort: AbortController | null = null;

/** 描画の終わった文字層を登録する（末尾に .endOfContent を足す） */
export function attachSelectionAssist(textLayerDiv: HTMLElement): void {
  detachSelectionAssist(textLayerDiv);
  const end = document.createElement('div');
  end.className = 'endOfContent';
  textLayerDiv.append(end);
  textLayerDiv.addEventListener('mousedown', onMouseDown);
  layers.set(textLayerDiv, end);
  enableGlobalListener();
}

/** 文字層を描き直す・捨てる前に外す */
export function detachSelectionAssist(textLayerDiv: HTMLElement): void {
  if (!layers.delete(textLayerDiv)) return;
  textLayerDiv.removeEventListener('mousedown', onMouseDown);
  textLayerDiv.classList.remove('selecting');
  if (layers.size === 0) {
    globalAbort?.abort();
    globalAbort = null;
  }
}

function onMouseDown(event: MouseEvent): void {
  (event.currentTarget as HTMLElement).classList.add('selecting');
}

function reset(end: HTMLElement, textLayer: HTMLElement): void {
  textLayer.append(end);
  end.style.width = '';
  end.style.height = '';
  textLayer.classList.remove('selecting');
}

interface UserAgentData {
  brands: { brand: string; version: string }[];
}

function enableGlobalListener(): void {
  if (globalAbort) return;
  globalAbort = new AbortController();
  const { signal } = globalAbort;

  let isPointerDown = false;
  document.addEventListener(
    'pointerdown',
    () => {
      isPointerDown = true;
    },
    { signal },
  );
  document.addEventListener(
    'pointerup',
    () => {
      isPointerDown = false;
      layers.forEach(reset);
    },
    { signal },
  );
  window.addEventListener(
    'blur',
    () => {
      isPointerDown = false;
      layers.forEach(reset);
    },
    { signal },
  );
  document.addEventListener(
    'keyup',
    () => {
      if (!isPointerDown) layers.forEach(reset);
    },
    { signal },
  );

  // Firefox と Chromium 148 以上は自前で正しく選べるので .endOfContent を動かさない（PDF.js と同じ判定）
  let isFirefoxOrModernChromium: boolean | undefined;
  let prevRange: Range | undefined;
  document.addEventListener(
    'selectionchange',
    () => {
      const selection = document.getSelection();
      if (!selection || selection.rangeCount === 0) {
        layers.forEach(reset);
        return;
      }
      const active = new Set<HTMLElement>();
      for (let i = 0; i < selection.rangeCount; i++) {
        const range = selection.getRangeAt(i);
        for (const layer of layers.keys()) if (!active.has(layer) && range.intersectsNode(layer)) active.add(layer);
      }
      for (const [layer, end] of layers) {
        if (active.has(layer)) layer.classList.add('selecting');
        else reset(end, layer);
      }

      if (isFirefoxOrModernChromium === undefined) {
        const first = layers.keys().next().value;
        isFirefoxOrModernChromium = !!first && getComputedStyle(first).getPropertyValue('-moz-user-select') === 'none';
        if (!isFirefoxOrModernChromium) {
          const brands = (navigator as Navigator & { userAgentData?: UserAgentData }).userAgentData?.brands;
          const chromiumVersion = brands
            ? brands.find(({ brand }) => brand === 'Chromium')?.version
            : /\bChrome\/(\d+)\b/.exec(navigator.userAgent)?.[1];
          isFirefoxOrModernChromium = !!chromiumVersion && parseInt(chromiumVersion, 10) >= 148;
        }
      }
      if (isFirefoxOrModernChromium) return;

      const range = selection.getRangeAt(0);
      const modifyStart =
        prevRange !== undefined &&
        (range.compareBoundaryPoints(Range.END_TO_END, prevRange) === 0 || range.compareBoundaryPoints(Range.START_TO_END, prevRange) === 0);
      let anchor: Node | null = modifyStart ? range.startContainer : range.endContainer;
      if (anchor.nodeType === Node.TEXT_NODE) anchor = anchor.parentNode;
      if (anchor instanceof Element && anchor.classList.contains('highlight')) anchor = anchor.parentNode;
      if (!modifyStart && range.endOffset === 0) {
        do {
          while (anchor && !anchor.previousSibling) anchor = anchor.parentNode;
          anchor = anchor?.previousSibling ?? null;
        } while (anchor && !anchor.childNodes.length);
      }
      const parent = anchor?.parentElement;
      const textLayer = parent?.closest<HTMLElement>('.textLayer');
      const end = textLayer ? layers.get(textLayer) : undefined;
      if (anchor && parent && textLayer && end) {
        end.style.width = textLayer.style.width;
        end.style.height = textLayer.style.height;
        end.style.userSelect = 'text';
        parent.insertBefore(end, modifyStart ? anchor : anchor.nextSibling);
      }
      prevRange = range.cloneRange();
    },
    { signal },
  );
}
