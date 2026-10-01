// 保存した PDF を利用者に渡す。指で操作する端末では共有シート（Slack・LINE・「ファイルに保存」・AirDrop など）を開き、
// 使えないブラウザ（Firefox、古い端末）や許可されないときはダウンロードにする。
// 共有シートから送られるのは利用者が選んだアプリへだけで、このツールのサーバを介すことはない（README「プライバシー」）。

export type DeliverResult = 'shared' | 'downloaded' | 'cancelled';

/** navigator のうち使う部分（テストで差し替える） */
export interface ShareCapable {
  canShare?(data?: ShareData): boolean;
  share?(data?: ShareData): Promise<void>;
}

export interface DeliverOptions {
  /** 共有シートを優先するか（指で操作する端末） */
  preferShare: boolean;
  nav: ShareCapable;
  download(bytes: Uint8Array, fileName: string, mime: string): void;
}

function canShareFile(nav: ShareCapable, file: File): boolean {
  if (!nav.share || !nav.canShare) return false;
  try {
    return nav.canShare({ files: [file] });
  } catch {
    return false;
  }
}

/**
 * ファイルを渡す。共有シートを利用者が閉じたら 'cancelled'（呼び出し元は下書きを消さない）。
 * 共有の許可が無い（NotAllowedError: 操作から時間が経った等）・失敗したときはダウンロードに切り替える。
 */
export async function deliverFile(bytes: Uint8Array, fileName: string, mime: string, options: DeliverOptions): Promise<DeliverResult> {
  const { nav } = options;
  if (options.preferShare) {
    const file = new File([bytes as Uint8Array<ArrayBuffer>], fileName, { type: mime });
    if (canShareFile(nav, file)) {
      try {
        await nav.share!({ files: [file], title: fileName });
        return 'shared';
      } catch (err) {
        if ((err as { name?: string }).name === 'AbortError') return 'cancelled';
      }
    }
  }
  options.download(bytes, fileName, mime);
  return 'downloaded';
}

/** 共有シートで PDF を渡せそうか（保存ボタンの絵を決める。実際に渡せるかは deliverFile が確かめる） */
export function canShareFiles(nav: ShareCapable): boolean {
  return canShareFile(nav, new File([new Uint8Array(1)], 'probe.pdf', { type: 'application/pdf' }));
}
