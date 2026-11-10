import { h, clear } from '../dom';
import { stepTitle, nav, needsScan, flash, optionToggles } from './common';
import { createTile, setTileMode, selectionFooter } from '../preview-grid';
import { duplicateCandidates, totals } from '../../../cleanup/categories';
import { bucketByTime, defaultTrashKeys, findDuplicateGroups } from '../../../cleanup/duplicates';
import { formatBytes, formatCount, plural } from '../../../cleanup/format';
import type { WizardCtx } from '../state';
import type { MediaItem } from '../../../types';

const GROUPS_PER_PAGE = 25;

async function runAnalysis(ctx: WizardCtx): Promise<void> {
  const { state, core } = ctx;
  const scan = state.scan;
  if (!scan || state.dupeRunning || core.isProcessRunning) return;
  state.dupeRunning = true;
  state.error = null;
  state.dupeProgress = { done: 0, total: 0, groups: 0 };
  core.isProcessRunning = true;
  ctx.render();
  let lastRender = 0;
  try {
    const groups = await findDuplicateGroups(core, duplicateCandidates(scan.items, ctx.eligibility()), (p) => {
      state.dupeProgress = p;
      const now = Date.now();
      if (now - lastRender > 300) {
        lastRender = now;
        ctx.render();
      }
    });
    if (core.isProcessRunning) {
      groups.sort((a, b) => totals(b.items).bytes - totals(a.items).bytes);
      state.dupes = { groups, trashKeys: defaultTrashKeys(groups) };
    }
  } catch (error) {
    state.error = `Finding look-alikes failed: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    core.isProcessRunning = false;
    state.dupeRunning = false;
    state.dupeProgress = null;
    ctx.render();
  }
}

function groupsView(ctx: WizardCtx): HTMLElement {
  const dupes = ctx.state.dupes;
  if (!dupes) return h('div');
  const { groups, trashKeys } = dupes;
  if (!groups.length) {
    return h('div', { class: 'wz-empty' }, h('div', { class: 'wz-empty-icon' }, '✨'), h('p', null, 'No look-alike photos found.'));
  }

  const selectedItems = (): MediaItem[] => groups.flatMap((g) => g.items.filter((i) => trashKeys.has(i.mediaKey)));
  const footer = selectionFooter(() => {
    void ctx.trash(selectedItems(), 'photos');
  });
  const updateFooter = (): void => {
    const sel = selectedItems();
    const groupCount = groups.filter((g) => g.items.some((i) => trashKeys.has(i.mediaKey))).length;
    footer.update(`Selected: **${plural(sel.length, 'photo')} in ${plural(groupCount, 'group')}, ${formatBytes(totals(sel).bytes)}**`, sel.length > 0);
  };

  const list = h('div', { class: 'wz-groups' });
  const sentinel = h('div', { class: 'wz-sentinel' });
  let rendered = 0;

  const renderGroup = (index: number): HTMLElement => {
    const group = groups[index];
    const row = h('div', { class: 'wz-group-row' });
    const hint = h('span', { class: 'wz-group-hint' });
    const tiles = new Map<string, HTMLElement>();
    const modeOf = (item: MediaItem): 'trash' | 'keeper' => (trashKeys.has(item.mediaKey) ? 'trash' : 'keeper');
    for (const item of group.items) {
      const tile = createTile(item, modeOf(item), () => {
        if (trashKeys.has(item.mediaKey)) {
          trashKeys.delete(item.mediaKey);
        } else {
          // Never let every photo in a group go: one always stays.
          const keptCount = group.items.filter((i) => !trashKeys.has(i.mediaKey)).length;
          if (keptCount <= 1) {
            hint.textContent = 'Keep at least one photo from each group.';
            tile.classList.add('wz-shake');
            setTimeout(() => tile.classList.remove('wz-shake'), 400);
            return;
          }
          trashKeys.add(item.mediaKey);
        }
        hint.textContent = '';
        for (const i of group.items) {
          const t = tiles.get(i.mediaKey);
          if (t) setTileMode(t, modeOf(i));
        }
        updateFooter();
      });
      tiles.set(item.mediaKey, tile);
      row.appendChild(tile);
    }
    const when = new Date(group.items[0].timestamp).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    return h('div', { class: 'wz-group' }, h('div', { class: 'wz-group-head' }, h('span', null, `${when}  •  ${plural(group.items.length, 'photo')}`), hint), row);
  };

  const renderMore = (): void => {
    const end = Math.min(groups.length, rendered + GROUPS_PER_PAGE);
    for (let i = rendered; i < end; i++) list.appendChild(renderGroup(i));
    rendered = end;
    sentinel.style.display = rendered < groups.length ? '' : 'none';
  };

  if (typeof IntersectionObserver !== 'undefined') {
    new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && rendered < groups.length) renderMore();
    }, { rootMargin: '600px 0px' }).observe(sentinel);
  } else {
    sentinel.appendChild(h('button', { class: 'wz-btn wz-btn-ghost', onclick: renderMore }, 'Show more'));
  }

  const resetBtn = h('button', {
    class: 'wz-btn wz-btn-small',
    onclick: () => {
      dupes.trashKeys = defaultTrashKeys(groups);
      ctx.render();
    },
  }, 'Reset picks');
  const keepAllBtn = h('button', {
    class: 'wz-btn wz-btn-small',
    onclick: () => {
      trashKeys.clear();
      clear(list);
      rendered = 0;
      renderMore();
      updateFooter();
    },
  }, 'Keep all');

  renderMore();
  updateFooter();
  return h(
    'div',
    { class: 'wz-grid-wrap' },
    h('div', { class: 'wz-toolbar' }, h('p', { class: 'wz-hint' }, 'The best shot in each group has a green ring and stays. Tap to flip Keep or Trash.'), h('div', { class: 'wz-toolbar-right' }, resetBtn, keepAllBtn)),
    list,
    sentinel,
    footer.el
  );
}

export default function dupesStep(ctx: WizardCtx): HTMLElement {
  const { state } = ctx;
  const body = h('div', { class: 'wz-step' }, flash(ctx), stepTitle('Look-alike photos', 'Bursts and selfies that look almost the same. We keep the **best shot** in each group.'));
  const scan = state.scan;
  if (!scan) {
    body.appendChild(needsScan(ctx, 'screenshots'));
    return body;
  }

  if (state.dupeRunning) {
    const p = state.dupeProgress;
    const pct = p?.total ? Math.round((p.done / p.total) * 100) : 0;
    body.appendChild(
      h(
        'div',
        { class: 'wz-card' },
        h('div', { class: 'wz-progress wz-progress-lg' }, h('div', { class: 'wz-progress-fill', style: `width:${pct}%` })),
        h('p', { class: 'wz-progress-text' }, `${pct}%  Compared ${formatCount(p?.done ?? 0)} of ${formatCount(p?.total ?? 0)} photos  •  ${plural(p?.groups ?? 0, 'group')} found`),
        h('div', { class: 'wz-row-center' }, h('button', { class: 'wz-btn wz-btn-ghost', onclick: () => ctx.stop() }, 'Stop'))
      )
    );
    return body;
  }

  if (state.error) body.appendChild(h('div', { class: 'wz-note wz-note-error' }, state.error));

  if (!state.dupes) {
    const candidates = bucketByTime(duplicateCandidates(scan.items, ctx.eligibility())).reduce((n, b) => n + b.length, 0);
    body.appendChild(optionToggles(ctx));
    body.appendChild(
      h(
        'div',
        { class: 'wz-card wz-center' },
        h('p', null, `We'll compare ${plural(candidates, 'photo')} that were taken within 10 minutes of another photo. Nothing changes until you choose.`),
        h('div', { class: 'wz-row-center' }, h('button', { class: 'wz-btn wz-btn-primary wz-btn-lg', disabled: candidates === 0, onclick: () => void runAnalysis(ctx) }, 'Find look-alikes'))
      )
    );
  } else {
    body.appendChild(h('div', { class: 'wz-row-end' }, h('button', { class: 'wz-link', onclick: () => { state.dupes = null; void runAnalysis(ctx); } }, 'Check again')));
    body.appendChild(groupsView(ctx));
  }
  body.appendChild(nav(ctx, { back: 'screenshots', next: 'trash', nextLabel: 'Next: Empty trash' }));
  return body;
}
