// ページ上のハイライトと付箋アイコンを描く。ハイライトはクリックを拾わない（文字選択の邪魔をしない）ので、
// クリック判定は PdfViewer 側で hitTestHighlight を使って行う。
// 位置と大きさはページに対する % で置く。ピンチ中に倍率が変わっても描き直さずにページと一緒に伸び縮みする。
import type { PageViewport } from 'pdfjs-dist';
import type { Comment } from '../model/types';
import { pdfRectToCss } from './coords';

const NOTE_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-6l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/></svg>';

export function renderOverlay(
  overlayEl: HTMLElement,
  viewport: PageViewport,
  comments: readonly Comment[],
  selectedId: string | null,
  onSelectNote: (id: string) => void,
): void {
  const fragment = document.createDocumentFragment();
  const pct = (value: number, total: number): string => `${(value / total) * 100}%`;
  for (const c of comments) {
    const selected = c.id === selectedId;
    if (c.anchor.kind === 'highlight') {
      for (const quad of c.anchor.quads) {
        const { left, top, width, height } = pdfRectToCss(quad, viewport);
        const div = document.createElement('div');
        div.className = selected ? 'pv-highlight is-selected' : 'pv-highlight';
        div.style.cssText = `left:${pct(left, viewport.width)};top:${pct(top, viewport.height)};width:${pct(width, viewport.width)};height:${pct(height, viewport.height)};background:${c.color}`;
        div.dataset.id = c.id;
        fragment.append(div);
      }
      continue;
    }
    const [vx, vy] = viewport.convertToViewportPoint(c.anchor.point[0], c.anchor.point[1]) as [number, number];
    const button = document.createElement('button');
    button.type = 'button';
    button.className = selected ? 'pv-note is-selected' : 'pv-note';
    button.style.left = pct(vx, viewport.width);
    button.style.top = pct(vy, viewport.height);
    button.style.setProperty('--note-color', c.color);
    button.title = `${c.author}: ${c.text || '（本文なし）'}`;
    button.dataset.id = c.id;
    button.innerHTML = NOTE_ICON;
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      onSelectNote(c.id);
    });
    fragment.append(button);
  }
  overlayEl.replaceChildren(fragment);
}
