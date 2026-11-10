import { describe, it, expect, vi } from 'vitest';

vi.stubGlobal('GM_getValue', () => 0);
vi.stubGlobal('GM_setValue', () => undefined);
vi.stubGlobal('GM_deleteValue', () => undefined);

const {
  isPhotosHost,
  runSetupBridge,
  consumeOpenRequest,
  OPEN_KEY,
  OPEN_TTL_MS,
  EVT_PING,
  EVT_INSTALLED,
  EVT_OPEN_REQUEST,
  EVT_OPEN_ARMED,
} = await import('../src/setup-bridge');

function memStore(initial: Record<string, number> = {}) {
  const data = { ...initial };
  return {
    data,
    get: (k: string) => data[k] ?? 0,
    set: (k: string, v: number) => { data[k] = v; },
    del: (k: string) => { delete data[k]; },
  };
}

function fakeDoc() {
  const target = new EventTarget();
  const dataset: Record<string, string> = {};
  const fired: string[] = [];
  const doc = {
    documentElement: { dataset },
    addEventListener: target.addEventListener.bind(target),
    dispatchEvent: (e: Event) => { fired.push(e.type); return target.dispatchEvent(e); },
  } as unknown as Document;
  return { doc, dataset, fired };
}

describe('isPhotosHost', () => {
  it('only matches photos.google.com', () => {
    expect(isPhotosHost('photos.google.com')).toBe(true);
    expect(isPhotosHost('www.prosperahq.io')).toBe(false);
    expect(isPhotosHost('localhost')).toBe(false);
  });
});

describe('runSetupBridge', () => {
  it('announces version and handler immediately', () => {
    const { doc, dataset, fired } = fakeDoc();
    runSetupBridge(doc, '4.0.0', memStore(), () => 1, 'Tampermonkey 5.3');
    expect(dataset.gptkVersion).toBe('4.0.0');
    expect(dataset.gptkHandler).toBe('Tampermonkey 5.3');
    expect(fired).toEqual([EVT_INSTALLED]);
  });

  it('re-announces on ping', () => {
    const { doc, fired } = fakeDoc();
    runSetupBridge(doc, '4.0.0', memStore(), () => 1, 'x');
    doc.dispatchEvent(new Event(EVT_PING));
    expect(fired.filter((t) => t === EVT_INSTALLED)).toHaveLength(2);
  });

  it('arms auto-open on request', () => {
    const { doc, dataset, fired } = fakeDoc();
    const store = memStore();
    runSetupBridge(doc, '4.0.0', store, () => 12345, 'x');
    doc.dispatchEvent(new Event(EVT_OPEN_REQUEST));
    expect(store.data[OPEN_KEY]).toBe(12345);
    expect(dataset.gptkOpenArmed).toBe('1');
    expect(fired).toContain(EVT_OPEN_ARMED);
  });
});

describe('consumeOpenRequest', () => {
  const loc = (hash = '') => ({ hash, pathname: '/', search: '' });

  it('opens on #gptk-open and strips the hash', () => {
    const replace = vi.fn();
    expect(consumeOpenRequest(loc('#gptk-open'), replace, memStore(), 0)).toBe(true);
    expect(replace).toHaveBeenCalledWith('/');
  });

  it('opens once when armed recently, then clears', () => {
    const store = memStore({ [OPEN_KEY]: 1000 });
    expect(consumeOpenRequest(loc(), vi.fn(), store, 2000)).toBe(true);
    expect(store.data[OPEN_KEY]).toBeUndefined();
    expect(consumeOpenRequest(loc(), vi.fn(), store, 2001)).toBe(false);
  });

  it('ignores and clears a stale arm', () => {
    const store = memStore({ [OPEN_KEY]: 1000 });
    expect(consumeOpenRequest(loc(), vi.fn(), store, 1000 + OPEN_TTL_MS)).toBe(false);
    expect(store.data[OPEN_KEY]).toBeUndefined();
  });

  it('does nothing on a plain load', () => {
    const replace = vi.fn();
    expect(consumeOpenRequest(loc(), replace, memStore(), 5)).toBe(false);
    expect(replace).not.toHaveBeenCalled();
  });
});
