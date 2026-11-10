import { h, clear } from '../dom';
import { stepTitle, nav, needsScan, flash, optionToggles, sharedNotice } from './common';
import { createTile, setTileMode, selectionFooter } from '../preview-grid';
import { totals } from '../../../cleanup/categories';
import { defaultTrashKeys, newCursor, streamDuplicateGroups, type DuplicateGroup } from '../../../cleanup/duplicates';
import { applyFilters, whenFilter } from '../../../cleanup/grid-filters';
import { filterSelects, showingLine, sortSelect } from '../filter-bar';
import { formatBytes, formatCount, plural } from '../../../cleanup/format';
import type { WizardCtx } from '../state';
import type { MediaItem } from '../../../types';

const GROUPS_PER_PAGE = 25;

function monthYear(ts: number | null): string {
  return ts ? new Date(ts).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) : 'today';
}

/** Start, or keep going from where the last pass stopped. */
async function runAnalysis(ctx: WizardCtx): Promise<void> {
  const { state, core } = ctx;
  if (!state.scan || state.dupeRunning || core.isProcessRunning) return;
  state.dupes ??= { groups: [], trashKeys: new Set(), cursor: newCursor() };
  const dupes = state.dupes;
  if (dupes.cursor.done) return;
  state.dupeRunning = true;
  state.error = null;
  state.dupeProgress = { cursor: dupes.cursor, groups: 0 };
  core.isProcessRunning = true;
  ctx.render();
  let lastRender = 0;
  try {
    dupes.cursor = await streamDuplicateGroups(core, {
      eligibility: ctx.eligibility(),
      cursor: dupes.cursor,
      onGroups: (groups) => {
        dupes.groups.push(...groups);
        for (const key of defaultTrashKeys(groups)) dupes.trashKeys.add(key);
      },
      onProgress: (p) => {
        state.dupeProgress = p;
        dupes.cursor = p.cursor;
        if (Date.now() - lastRender > 400) {
          lastRender = Date.now();
          ctx.render();
        }
      },
    });
  } catch (error) {
    state.error = `Finding look-alikes hit a problem: ${error instanceof Error ? error.message : String(error)}. Your progress is saved, press Keep looking to continue.`;
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
  const { groups } = dupes;
  if (!groups.length) {
    return h('div', { class: 'wz-empty' }, h('div', { class: 'wz-empty-icon' }, '✨'), h('p', null, 'No look-alike photos found.'));
  }

  const trashKeys = (): Set<string> => dupes.trashKeys;
  const prefs = ctx.gridPrefs('dupes', { sort: 'date' });
  const leads = groups.map((g) => g.items[0]);
  const filters = [whenFilter(leads)];
  const BIG_GROUP = 3;
  const groupBytes = (g: DuplicateGroup): number => totals(g.items).bytes;
  const visibleGroups = (): DuplicateGroup[] => {
    let list = applyFilters(groups, filters, prefs.filters, (g) => g.items[0]);
    if (prefs.chips.has('big')) list = list.filter((g) => g.items.length >= BIG_GROUP);
    if (prefs.sort === 'size') return [...list].sort((a, b) => groupBytes(b) - groupBytes(a));
    if (prefs.sort === 'oldest') return [...list].sort((a, b) => a.items[0].timestamp - b.items[0].timestamp);
    return [...list].sort((a, b) => b.items[0].timestamp - a.items[0].timestamp);
  };
  let shown: DuplicateGroup[] = [];
  const selectedItems = (): MediaItem[] => shown.flatMap((g) => g.items.filter((i) => trashKeys().has(i.mediaKey)));
  const showing = showingLine(() => {
    prefs.filters = {};
    prefs.chips.clear();
    ctx.render();
  });
  const footer = selectionFooter(() => {
    void ctx.trash(selectedItems(), 'photos');
  });
  const updateFooter = (): void => {
    const sel = selectedItems();
    const groupCount = shown.filter((g) => g.items.some((i) => trashKeys().has(i.mediaKey))).length;
    footer.update(`Selected: **${plural(sel.length, 'photo')} in ${plural(groupCount, 'group')}, ${formatBytes(totals(sel).bytes)}**`, sel.length > 0 && ctx.state.scan?.sharedChecked === true);
    const filtered = shown.length < groups.length;
    showing.update(shown.length, groups.length, 'groups', filtered);
  };

  const list = h('div', { class: 'wz-groups' });
  const sentinel = h('div', { class: 'wz-sentinel' });
  let rendered = 0;

  const renderGroup = (index: number): HTMLElement => {
    const group = shown[index];
    const row = h('div', { class: 'wz-group-row' });
    const hint = h('span', { class: 'wz-group-hint' });
    const tiles = new Map<string, HTMLElement>();
    const modeOf = (item: MediaItem): 'trash' | 'keeper' => (trashKeys().has(item.mediaKey) ? 'trash' : 'keeper');
    for (const item of group.items) {
      const tile = createTile(item, modeOf(item), () => {
        if (trashKeys().has(item.mediaKey)) {
          trashKeys().delete(item.mediaKey);
        } else {
          // Never let every photo in a group go: one always stays.
          const keptCount = group.items.filter((i) => !trashKeys().has(i.mediaKey)).length;
          if (keptCount <= 1) {
            hint.textContent = 'Keep at least one photo from each group.';
            tile.classList.add('wz-shake');
            setTimeout(() => tile.classList.remove('wz-shake'), 400);
            return;
          }
          trashKeys().add(item.mediaKey);
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
    const end = Math.min(shown.length, rendered + GROUPS_PER_PAGE);
    for (let i = rendered; i < end; i++) list.appendChild(renderGroup(i));
    rendered = end;
    sentinel.style.display = rendered < shown.length ? '' : 'none';
  };
  const rebuild = (): void => {
    shown = visibleGroups();
    clear(list);
    rendered = 0;
    renderMore();
    updateFooter();
  };

  if (typeof IntersectionObserver !== 'undefined') {
    new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && rendered < shown.length) renderMore();
    }, { rootMargin: '600px 0px' }).observe(sentinel);
  } else {
    sentinel.appendChild(h('button', { class: 'wz-btn wz-btn-ghost', onclick: renderMore }, 'Show more'));
  }

  const resetBtn = h('button', {
    class: 'wz-btn wz-btn-small',
    onclick: () => {
      // Only the groups on screen; picks in filtered-out groups stay as they are.
      for (const g of shown) for (const i of g.items) trashKeys().delete(i.mediaKey);
      for (const key of defaultTrashKeys(shown)) trashKeys().add(key);
      rebuild();
    },
  }, 'Reset picks');
  const keepAllBtn = h('button', {
    class: 'wz-btn wz-btn-small',
    onclick: () => {
      for (const g of shown) for (const i of g.items) trashKeys().delete(i.mediaKey);
      rebuild();
    },
  }, 'Keep all');

  const bigChip = groups.some((g) => g.items.length >= BIG_GROUP) && groups.some((g) => g.items.length < BIG_GROUP)
    ? h('button', {
      class: `wz-chip${prefs.chips.has('big') ? ' is-on' : ''}`,
      'aria-pressed': String(prefs.chips.has('big')),
      onclick: () => {
        if (prefs.chips.has('big')) prefs.chips.delete('big');
        else prefs.chips.add('big');
        bigChip?.classList.toggle('is-on', prefs.chips.has('big'));
        bigChip?.setAttribute('aria-pressed', String(prefs.chips.has('big')));
        rebuild();
      },
    }, `${BIG_GROUP}+ photos (${formatCount(groups.filter((g) => g.items.length >= BIG_GROUP).length)})`)
    : null;
  const dropdowns = filterSelects(leads, filters, prefs, rebuild);
  const sorter = sortSelect(prefs, { date: 'Newest first', oldest: 'Oldest first', size: 'Most space' }, rebuild);

  rebuild();
  return h(
    'div',
    { class: 'wz-grid-wrap' },
    h('div', { class: 'wz-toolbar' }, h('div', { class: 'wz-filters' }, ...dropdowns, bigChip), h('div', { class: 'wz-toolbar-right' }, resetBtn, keepAllBtn, sorter)),
    h('p', { class: 'wz-hint' }, 'The best shot in each group has a green ring and stays. Tap to flip Keep or Trash.'),
    showing.el,
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
    body.appendChild(needsScan(ctx, 'blurry'));
    return body;
  }
  const dupes = state.dupes;

  if (state.dupeRunning) {
    const c = state.dupeProgress?.cursor ?? dupes?.cursor;
    const found = dupes?.groups.length ?? 0;
    body.appendChild(
      h(
        'div',
        { class: 'wz-card' },
        h('div', { class: 'wz-progress wz-progress-lg wz-progress-indeterminate' }, h('div', { class: 'wz-progress-fill' })),
        h(
          'p',
          { class: 'wz-progress-text' },
          `Checked back to ${monthYear(c?.checkedBackTo ?? null)}  \u2022  ${formatCount(c?.itemsSeen ?? 0)} photos looked at  \u2022  ${plural(found, 'group')} found`
        ),
        h('p', { class: 'wz-muted' }, 'Newest photos first. You can stop any time and review what we found so far, then keep looking later.'),
        h('div', { class: 'wz-row-center' }, h('button', { class: 'wz-btn wz-btn-primary', onclick: () => ctx.stop() }, found ? `Stop and review ${plural(found, 'group')}` : 'Stop'))
      )
    );
    return body;
  }

  if (state.error) body.appendChild(h('div', { class: 'wz-note wz-note-error' }, state.error));

  if (!dupes) {
    body.appendChild(optionToggles(ctx));
    body.appendChild(
      h(
        'div',
        { class: 'wz-card wz-center' },
        h('p', null, "We'll go through your photos newest first and compare the ones taken within 10 minutes of each other. Groups show up as we find them, and you can stop any time. Nothing changes until you choose."),
        h('div', { class: 'wz-row-center' }, h('button', { class: 'wz-btn wz-btn-primary wz-btn-lg', onclick: () => void runAnalysis(ctx) }, 'Find look-alikes'))
      )
    );
  } else {
    const c = dupes.cursor;
    body.appendChild(sharedNotice(ctx));
    body.appendChild(
      h(
        'div',
        { class: 'wz-note wz-row-between' },
        h('span', null, c.done ? `Checked your whole library (${formatCount(c.itemsSeen)} photos).` : `Checked back to ${monthYear(c.checkedBackTo)} (${formatCount(c.itemsSeen)} photos so far).`),
        c.done ? null : h('button', { class: 'wz-btn wz-btn-small', onclick: () => void runAnalysis(ctx) }, 'Keep looking')
      )
    );
    body.appendChild(groupsView(ctx));
  }
  body.appendChild(nav(ctx, { back: 'blurry', next: 'trash', nextLabel: 'Next: Trash' }));
  return body;
}
