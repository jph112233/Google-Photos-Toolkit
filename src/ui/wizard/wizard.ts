// "Free Up Space" wizard: step state machine, rendering, view toggle,
// and the one destructive operation it is allowed to make (Move to Trash).
import { h, clear } from './dom';
import { STEPS, initialState } from './state';
import { eligibilityFrom, saveSummary, loadSummary, usedBytes } from './summary';
import { confirmDialog, progressDialog } from './modal';
import scanStep from './steps/scan';
import saverStep from './steps/saver';
import videosStep from './steps/videos';
import screenshotsStep from './steps/screenshots';
import blurryStep from './steps/blurry';
import dupesStep from './steps/dupes';
import { trashStep, doneStep } from './steps/trash';
import Scanner, { ScanStoppedError, findSharedDedupKeys } from '../../cleanup/scan';
import { pruneGroups } from '../../cleanup/duplicates';
import { totals, withoutKeys, isEligible } from '../../cleanup/categories';
import { formatBytes, plural } from '../../cleanup/format';
import splitArrayIntoChunks from '../../utils/splitArrayIntoChunks';
import getFromStorage from '../../utils/getFromStorage';
import ApiUtils from '../../api/api-utils';
import { apiSettingsDefault } from '../../api/api-utils-default-presets';
import { core } from '../../globals';
import log from '../logic/log';
import type { StepId, WizardCtx, WizardState, GridPrefs } from './state';
import type { MediaItem, ApiSettings } from '../../types';

export type View = 'wizard' | 'advanced';
export const VIEW_KEY = 'gptk-view';

const RENDERERS: Record<StepId, (ctx: WizardCtx) => HTMLElement> = {
  scan: scanStep,
  saver: saverStep,
  videos: videosStep,
  screenshots: screenshotsStep,
  blurry: blurryStep,
  dupes: dupesStep,
  trash: trashStep,
  done: doneStep,
};

export function getView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === 'advanced' ? 'advanced' : 'wizard';
  } catch {
    return 'wizard';
  }
}

export function setView(view: View): void {
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch {
    // Storage blocked: the choice just won't persist.
  }
  applyView(view);
}

export function applyView(view: View): void {
  const gptk = document.getElementById('gptk');
  if (!gptk) return;
  gptk.classList.toggle('view-wizard', view === 'wizard');
  gptk.classList.toggle('view-advanced', view === 'advanced');
  const title = document.getElementById('gptk-title');
  if (title) title.textContent = view === 'wizard' ? 'Free Up Space' : 'Advanced';
  const toggle = document.getElementById('gptk-view-toggle');
  if (toggle) toggle.textContent = view === 'wizard' ? 'Advanced' : 'Back to Free Up Space';
}

function freshApiUtils(): ApiUtils {
  const settings = getFromStorage<ApiSettings>('apiSettings') ?? apiSettingsDefault;
  return new ApiUtils(core, settings);
}

class Wizard implements WizardCtx {
  state: WizardState = initialState();
  core = core;
  private root: HTMLElement;
  private storageEl: HTMLElement;
  private stepperEl: HTMLElement;
  private contentEl: HTMLElement;

  constructor(root: HTMLElement) {
    this.root = root;
    this.storageEl = root.querySelector('.wz-storage') as HTMLElement;
    this.stepperEl = root.querySelector('.wz-stepper') as HTMLElement;
    this.contentEl = root.querySelector('.wz-content') as HTMLElement;
    this.state.summary = loadSummary();
    if (this.state.summary) this.state.freedBytes = 0;
  }

  eligibility() {
    return eligibilityFrom(this.state);
  }

  gridPrefs(step: StepId, defaults: Partial<GridPrefs> = {}): GridPrefs {
    let prefs = this.state.grid[step];
    if (!prefs) {
      prefs = { keep: new Set(), chips: new Set(), sort: 'size', ...defaults };
      this.state.grid[step] = prefs;
    }
    return prefs;
  }

  go(step: StepId): void {
    this.state.step = step;
    this.state.error = null;
    this.render();
    this.contentEl.scrollTop = 0;
  }

  stop(): void {
    log('Stopping the process');
    this.core.isProcessRunning = false;
  }

  async startScan(): Promise<void> {
    const { state } = this;
    if (state.scanning) return;
    if (this.core.isProcessRunning) {
      state.error = 'Another task is running in the Advanced view. Stop it or wait for it to finish, then scan.';
      this.render();
      return;
    }
    state.scanning = true;
    state.error = null;
    state.progress = null;
    state.step = 'scan';
    this.core.isProcessRunning = true;
    this.core.apiUtils = freshApiUtils();
    this.render();

    let lastRender = 0;
    const scanner = new Scanner(this.core, (p) => {
      state.progress = p;
      const now = Date.now();
      if (now - lastRender > 250 || p.phase === 'done') {
        lastRender = now;
        if (state.step === 'scan') this.render();
      }
    });
    try {
      log('Free Up Space: scanning library');
      const result = await scanner.run();
      state.scan = result;
      state.dupes = null;
      state.grid = {};
      log(`Free Up Space: quick scan complete, ${result.items.length} items to review`, 'success');
      saveSummary(state);
      void this.checkShared();
    } catch (error) {
      if (error instanceof ScanStoppedError || !this.core.isProcessRunning) {
        state.error = 'Scan stopped. Nothing was changed. Scan again whenever you like.';
      } else {
        const msg = error instanceof Error ? error.message : String(error);
        state.error = `The scan hit a problem: ${msg}. Try again in a minute.`;
        log(`Free Up Space scan failed: ${msg}`, 'error');
      }
    } finally {
      this.core.isProcessRunning = false;
      state.scanning = false;
      state.progress = null;
      this.render();
    }
  }

  async checkShared(): Promise<void> {
    const { state } = this;
    const scan = state.scan;
    if (!scan || scan.sharedChecked || state.shared.checking) return;
    state.shared = { checking: true, done: 0, total: 0, error: null };
    this.render();
    let lastRender = 0;
    try {
      const keys = await findSharedDedupKeys(this.core.api, (done, total) => {
        state.shared.done = done;
        state.shared.total = total;
        if (Date.now() - lastRender > 500) {
          lastRender = Date.now();
          this.render();
        }
      });
      if (state.scan !== scan) return; // A newer scan replaced this one.
      scan.sharedDedupKeys = keys;
      scan.sharedChecked = true;
      // Look-alike groups found before this finished may hold shared photos.
      if (state.dupes && !state.includeShared) {
        const opts = this.eligibility();
        const removed = new Set(state.dupes.groups.flatMap((g) => g.items).filter((i) => !isEligible(i, opts)).map((i) => i.mediaKey));
        if (removed.size) {
          state.dupes.groups = pruneGroups(state.dupes.groups, removed);
          for (const key of removed) state.dupes.trashKeys.delete(key);
        }
      }
      saveSummary(state);
    } catch (error) {
      state.shared.error = error instanceof Error ? error.message : String(error);
    } finally {
      state.shared.checking = false;
      this.render();
    }
  }

  async trash(items: MediaItem[], noun: string): Promise<MediaItem[]> {
    const { state } = this;
    if (!items.length || !state.scan) return [];
    if (!state.scan.sharedChecked) {
      state.error = 'Still checking shared albums. Try again in a moment.';
      this.render();
      return [];
    }
    if (this.core.isProcessRunning) {
      state.error = 'Another task is running. Wait for it to finish first.';
      this.render();
      return [];
    }
    const t = totals(items);
    const ok = await confirmDialog({
      title: 'Move to Trash?',
      body: `Move ${plural(t.count, noun.replace(/s$/, ''), noun)} (${formatBytes(t.bytes)}) to Trash? You can restore ${t.count === 1 ? 'it' : 'them'} from Trash for 30 days.`,
      confirmLabel: 'Move to Trash',
      danger: true,
    });
    if (!ok) return [];

    this.core.isProcessRunning = true;
    const utils = freshApiUtils();
    this.core.apiUtils = utils;
    const dialog = progressDialog('Moving to Trash...', () => this.stop());
    const trashed: MediaItem[] = [];
    let failed = 0;
    try {
      const chunks = splitArrayIntoChunks(items, Math.max(1, Math.min(utils.operationSize || 250, 250)));
      log(`Free Up Space: moving ${items.length} items to trash`);
      for (const chunk of chunks) {
        if (!this.core.isProcessRunning) break;
        try {
          await this.core.api.moveItemsToTrash(chunk.map((i) => i.dedupKey));
          trashed.push(...chunk);
        } catch (error) {
          failed += chunk.length;
          log(`Move to trash failed for ${chunk.length} items: ${String(error)}`, 'error');
        }
        dialog.update(trashed.length + failed, items.length, `${trashed.length} of ${items.length} moved`);
      }
    } finally {
      this.core.isProcessRunning = false;
      dialog.close();
    }

    if (trashed.length) {
      const removed = new Set(trashed.map((i) => i.mediaKey));
      const tt = totals(trashed);
      state.scan.items = withoutKeys(state.scan.items, removed);
      state.scan.trash = { count: state.scan.trash.count + tt.count, bytes: state.scan.trash.bytes + tt.bytes };
      if (state.dupes) {
        state.dupes.groups = pruneGroups(state.dupes.groups, removed);
        for (const key of removed) state.dupes.trashKeys.delete(key);
      }
      state.freedBytes += tt.bytes;
      state.freedCount += tt.count;
      state.flash = `Nice! You freed **${formatBytes(tt.bytes)}** (${plural(tt.count, 'item')} moved to Trash).`;
      log(`Free Up Space: moved ${tt.count} items (${formatBytes(tt.bytes)}) to trash`, 'success');
      saveSummary(state);
    }
    if (failed) state.error = `${plural(failed, 'item')} couldn't be moved. They're still in your library. Try again later.`;
    else if (trashed.length < items.length) state.error = 'Stopped. The rest were not moved.';
    this.render();
    return trashed;
  }

  private renderStorage(): void {
    const { used, total } = usedBytes(this.state);
    clear(this.storageEl);
    if (!used && !total) {
      this.storageEl.appendChild(h('div', { class: 'wz-storage-text' }, 'Scan to see how much space you are using.'));
      return;
    }
    const freed = this.state.freedBytes;
    const pct = total > 0 ? Math.min(100, Math.max(0, (used / total) * 100)) : 0;
    // Some accounts (family plans, unlimited) report no total: show the text only.
    if (total > 0) {
      this.storageEl.appendChild(
        h('div', { class: 'wz-storage-bar', role: 'progressbar', 'aria-valuenow': String(Math.round(pct)), 'aria-valuemin': '0', 'aria-valuemax': '100' }, h('div', { class: 'wz-storage-fill', style: `width:${pct}%` }))
      );
    }
    this.storageEl.appendChild(
      h(
        'div',
        { class: 'wz-storage-text' },
        h('strong', null, `${formatBytes(used)} used by Google Photos`),
        total ? ` of ${formatBytes(total)}` : '',
        h('span', { class: 'wz-freed' }, freed > 0 ? `  (-${formatBytes(freed)} freed)` : '')
      )
    );
  }

  private renderStepper(): void {
    clear(this.stepperEl);
    const current = this.state.step === 'done' ? 'trash' : this.state.step;
    const currentIndex = STEPS.findIndex((s) => s.id === current);
    STEPS.forEach((s, i) => {
      const btn = h(
        'button',
        {
          class: `wz-stepper-item${i === currentIndex ? ' is-current' : ''}${i < currentIndex ? ' is-past' : ''}`,
          'aria-current': i === currentIndex ? 'step' : null,
          disabled: this.state.scanning,
          onclick: () => this.go(s.id),
        },
        h('span', { class: 'wz-stepper-dot' }, i < currentIndex ? '✓' : String(i + 1)),
        h('span', { class: 'wz-stepper-label' }, s.label)
      );
      this.stepperEl.appendChild(h('li', null, btn));
    });
  }

  render(): void {
    this.renderStorage();
    this.renderStepper();
    const scrollTop = this.contentEl.scrollTop;
    clear(this.contentEl);
    try {
      this.contentEl.appendChild(RENDERERS[this.state.step](this));
    } catch (error) {
      console.error('[GPTK] Wizard render failed', error);
      this.contentEl.appendChild(h('div', { class: 'wz-note wz-note-error' }, `Something went wrong drawing this step: ${String(error)}`));
    }
    this.contentEl.scrollTop = scrollTop;
  }
}

let instance: Wizard | null = null;

export function initWizard(): void {
  const root = document.getElementById('gptk-wizard');
  if (!root) return;
  instance = new Wizard(root);
  instance.render();
  applyView(getView());
  document.getElementById('gptk-view-toggle')?.addEventListener('click', () => {
    setView(getView() === 'wizard' ? 'advanced' : 'wizard');
  });
}

export function getWizard(): WizardCtx | null {
  return instance;
}
