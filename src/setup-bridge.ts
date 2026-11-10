// Setup-page bridge.
//
// The userscript also runs on the family setup page (www.prosperahq.io/photos-cleanup).
// There it does NOT start the toolkit. It only:
//   1. Announces itself: sets data-gptk-version / data-gptk-handler on <html>
//      and fires a `gptk-installed` event on document. It re-announces when the
//      page fires `gptk-ping` (covers either script loading first).
//   2. Arms auto-open: when the page fires `gptk-open-request`, it stores a
//      timestamp in userscript storage (shared across sites) and fires
//      `gptk-open-armed`. The next photos.google.com load within OPEN_TTL_MS
//      opens the Free Up Space wizard by itself. This survives Google's sign-in
//      redirects, which drop URL hashes.
// photos.google.com/#gptk-open also opens the wizard (manual fallback).
//
// Contract documented in docs/SETUP-PAGE-BUILD-PROMPT.md. Keep them in sync.

export const PHOTOS_HOST = 'photos.google.com';
export const OPEN_HASH = '#gptk-open';
export const OPEN_KEY = 'gptk-open-request';
export const OPEN_TTL_MS = 10 * 60 * 1000;

export const EVT_PING = 'gptk-ping';
export const EVT_INSTALLED = 'gptk-installed';
export const EVT_OPEN_REQUEST = 'gptk-open-request';
export const EVT_OPEN_ARMED = 'gptk-open-armed';

export interface ValueStore {
  get(key: string): number;
  set(key: string, value: number): void;
  del(key: string): void;
}

export const gmStore: ValueStore = {
  get: (key) => Number(GM_getValue(key, 0)) || 0,
  set: (key, value) => GM_setValue(key, value),
  del: (key) => GM_deleteValue(key),
};

export function isPhotosHost(hostname: string): boolean {
  return hostname === PHOTOS_HOST;
}

export function handlerInfo(): string {
  try {
    return `${GM_info.scriptHandler ?? 'unknown'} ${GM_info.version ?? ''}`.trim();
  } catch {
    return 'unknown';
  }
}

export function runSetupBridge(
  doc: Document,
  version: string,
  store: ValueStore = gmStore,
  now: () => number = Date.now,
  handler: string = handlerInfo(),
): void {
  const root = doc.documentElement;
  const announce = (): void => {
    root.dataset.gptkVersion = version;
    root.dataset.gptkHandler = handler;
    doc.dispatchEvent(new Event(EVT_INSTALLED));
  };
  doc.addEventListener(EVT_PING, announce);
  doc.addEventListener(EVT_OPEN_REQUEST, () => {
    store.set(OPEN_KEY, now());
    root.dataset.gptkOpenArmed = '1';
    doc.dispatchEvent(new Event(EVT_OPEN_ARMED));
  });
  announce();
}

/**
 * On photos.google.com: should the wizard open by itself? Reads and clears the
 * armed flag (one-shot) and strips #gptk-open from the URL.
 */
export function consumeOpenRequest(
  loc: { hash: string; pathname: string; search: string },
  replaceUrl: (url: string) => void,
  store: ValueStore = gmStore,
  now: number = Date.now(),
): boolean {
  let open = false;
  if (loc.hash === OPEN_HASH) {
    open = true;
    replaceUrl(loc.pathname + loc.search);
  }
  const armedAt = store.get(OPEN_KEY);
  if (armedAt) {
    store.del(OPEN_KEY);
    if (now - armedAt >= 0 && now - armedAt < OPEN_TTL_MS) open = true;
  }
  return open;
}
