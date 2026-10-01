import { describe, expect, it, vi } from 'vitest';
import { canShareFiles, deliverFile, type ShareCapable } from '../src/export/share';

const bytes = new Uint8Array([37, 80, 68, 70]); // "%PDF"

function setup(nav: ShareCapable, preferShare = true) {
  const download = vi.fn();
  return { download, run: () => deliverFile(bytes, 'draft_reviewed.pdf', 'application/pdf', { preferShare, nav, download }) };
}

function rejectWith(name: string) {
  return () => Promise.reject(Object.assign(new Error(name), { name }));
}

describe('deliverFile', () => {
  it('downloads when sharing is not preferred (desktop)', async () => {
    const share = vi.fn();
    const { download, run } = setup({ canShare: () => true, share }, false);
    expect(await run()).toBe('downloaded');
    expect(share).not.toHaveBeenCalled();
    expect(download).toHaveBeenCalledWith(bytes, 'draft_reviewed.pdf', 'application/pdf');
  });

  it('opens the share sheet with the file when the browser can share files', async () => {
    const share = vi.fn((_data?: ShareData) => Promise.resolve());
    const { download, run } = setup({ canShare: () => true, share });
    expect(await run()).toBe('shared');
    expect(download).not.toHaveBeenCalled();
    const data = share.mock.calls[0]![0]!;
    expect(data.files?.[0]?.name).toBe('draft_reviewed.pdf');
    expect(data.files?.[0]?.type).toBe('application/pdf');
  });

  it('reports a cancelled share sheet without downloading', async () => {
    const { download, run } = setup({ canShare: () => true, share: rejectWith('AbortError') });
    expect(await run()).toBe('cancelled');
    expect(download).not.toHaveBeenCalled();
  });

  it('falls back to a download when sharing is refused or fails', async () => {
    const refused = setup({ canShare: () => true, share: rejectWith('NotAllowedError') });
    expect(await refused.run()).toBe('downloaded');
    expect(refused.download).toHaveBeenCalledOnce();

    const cannot = setup({ canShare: () => false, share: vi.fn() });
    expect(await cannot.run()).toBe('downloaded');

    const throwing = setup({ canShare: () => { throw new TypeError('bad'); }, share: vi.fn() });
    expect(await throwing.run()).toBe('downloaded');

    const missing = setup({});
    expect(await missing.run()).toBe('downloaded');
  });
});

describe('canShareFiles', () => {
  it('is true only when the browser can share a PDF file', () => {
    expect(canShareFiles({ canShare: (d) => (d?.files?.length ?? 0) > 0, share: () => Promise.resolve() })).toBe(true);
    expect(canShareFiles({ canShare: () => false, share: () => Promise.resolve() })).toBe(false);
    expect(canShareFiles({ share: () => Promise.resolve() })).toBe(false);
  });
});
