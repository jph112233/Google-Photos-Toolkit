// Reusable thumbnail grid for steps 2-4: lazy thumbs, infinite scroll,
// select-all-by-default, live footer total, Move to Trash.
import { h, clear, openInNewTab } from './dom';
import { formatBytes, formatDuration, plural } from '../../cleanup/format';
import { bytesOf, isVideo, sortByDateAsc, sortByDateDesc, sortBySizeDesc, totals } from '../../cleanup/categories';
import { applyFilters, type GridFilter } from '../../cleanup/grid-filters';
import { filterSelects, showingLine, sortSelect } from './filter-bar';
import type { MediaItem } from '../../types';
import type { StepId, WizardCtx, GridPrefs } from './state';

export const PAGE_SIZE = 60;

export function thumbUrl(item: MediaItem): string {
  return item.thumb ? `${item.thumb}=w180-h180-c` : '';
}

export function photoUrl(item: MediaItem): string {
  return `https://photos.google.com/photo/${encodeURIComponent(item.mediaKey)}`;
}

let sharedObserver: IntersectionObserver | null = null;

/** Lazy-load thumbnails: the real src is set only when the tile scrolls into view. */
function lazyObserver(): IntersectionObserver | null {
  if (typeof IntersectionObserver === 'undefined') return null;
  sharedObserver ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const img = entry.target as HTMLImageElement;
        if (img.dataset.src) {
          img.src = img.dataset.src;
          delete img.dataset.src;
        }
        sharedObserver?.unobserve(img);
      }
    },
    { rootMargin: '400px 0px' }
  );
  return sharedObserver;
}

export type TileMode = 'trash' | 'keep' | 'keeper';

export function createTile(item: MediaItem, mode: TileMode, onToggle: () => void): HTMLElement {
  const img = h('img', { class: 'wz-thumb', alt: item.fileName ?? 'Photo', draggable: 'false' });
  const src = thumbUrl(item);
  const observer = lazyObserver();
  if (src && observer) {
    img.dataset.src = src;
    observer.observe(img);
  } else if (src) {
    img.src = src;
  }

  const open = h('a', {
    class: 'wz-open',
    href: photoUrl(item),
    target: '_blank',
    rel: 'noopener',
    title: 'Open in Google Photos',
    'aria-label': 'Open in Google Photos',
    onclick: (e: Event) => {
      e.stopPropagation();
      e.preventDefault();
      openInNewTab(photoUrl(item));
    },
  }, '↗');

  const tile = h(
    'div',
    {
      class: 'wz-tile',
      role: 'checkbox',
      tabindex: '0',
      title: item.fileName ?? '',
      onclick: onToggle,
      onkeydown: (e: Event) => {
        const key = (e as KeyboardEvent).key;
        if (key === ' ' || key === 'Enter') {
          e.preventDefault();
          onToggle();
        }
      },
    },
    img,
    h('span', { class: 'wz-tick', 'aria-hidden': 'true' }, '✓'),
    h('span', { class: 'wz-keep-label', 'aria-hidden': 'true' }, 'Keep'),
    open,
    h('span', { class: 'wz-badge wz-badge-size' }, formatBytes(bytesOf(item))),
    isVideo(item) ? h('span', { class: 'wz-badge wz-badge-dur' }, `▶ ${formatDuration(item.duration)}`) : null
  );
  setTileMode(tile, mode);
  return tile;
}

export function setTileMode(tile: HTMLElement, mode: TileMode): void {
  tile.classList.toggle('is-trash', mode === 'trash');
  tile.classList.toggle('is-keeper', mode === 'keeper');
  tile.setAttribute('aria-checked', String(mode === 'trash'));
  tile.setAttribute('aria-label', mode === 'trash' ? 'Will move to Trash. Click to keep.' : 'Keeping. Click to move to Trash.');
}

export function selectionFooter(onTrash: () => void): { el: HTMLElement; update(text: string, enabled: boolean): void } {
  const label = h('div', { class: 'wz-footer-label' });
  const button = h('button', { class: 'wz-btn wz-btn-danger', onclick: onTrash }, 'Move to Trash');
  const el = h('div', { class: 'wz-select-footer' }, label, button);
  return {
    el,
    update(text, enabled) {
      clear(label);
      text.split(/(\*\*[^*]+\*\*)/).forEach((part) => {
        if (part.startsWith('**')) label.appendChild(h('strong', null, part.slice(2, -2)));
        else if (part) label.appendChild(document.createTextNode(part));
      });
      button.disabled = !enabled;
    },
  };
}

export interface Chip {
  id: string;
  label: string;
  match: (item: MediaItem) => boolean;
}

export interface GridOptions {
  ctx: WizardCtx;
  step: StepId;
  items: MediaItem[];
  noun: [string, string];
  chips?: Chip[];
  /** 'any': show items matching any active chip (category toggles, all on by default).
   *  'all': active chips narrow the list (optional filters, off by default). */
  chipMode?: 'any' | 'all';
  defaultChips?: string[];
  /** Dropdown filters (When, Size, Length...). Only useful ones are shown. */
  filters?: GridFilter[];
  emptyText: string;
}

export function previewGrid(opts: GridOptions): HTMLElement {
  const { ctx, step, items, chips = [], chipMode = 'all', filters = [] } = opts;
  const prefs: GridPrefs = ctx.gridPrefs(step, { chips: new Set(opts.defaultChips ?? []) });

  if (!items.length) {
    return h('div', { class: 'wz-empty' }, h('div', { class: 'wz-empty-icon' }, '✨'), h('p', null, opts.emptyText));
  }

  const visible = (): MediaItem[] => {
    let list = items;
    if (chips.length) {
      const active = chips.filter((c) => prefs.chips.has(c.id));
      if (chipMode === 'any') list = list.filter((i) => active.some((c) => c.match(i)));
      else if (active.length) list = list.filter((i) => active.every((c) => c.match(i)));
    }
    list = applyFilters(list, filters, prefs.filters, (i) => i);
    if (prefs.sort === 'date') return sortByDateDesc(list);
    if (prefs.sort === 'oldest') return sortByDateAsc(list);
    return sortBySizeDesc(list);
  };
  const defaultChips = new Set(opts.defaultChips ?? []);
  const isFiltered = (): boolean =>
    Object.values(prefs.filters).some((v) => v && v !== 'all') ||
    prefs.chips.size !== defaultChips.size ||
    [...prefs.chips].some((c) => !defaultChips.has(c));
  const showing = showingLine(() => {
    prefs.filters = {};
    prefs.chips = new Set(defaultChips);
    ctx.render();
  });
  const selected = (): MediaItem[] => visible().filter((i) => !prefs.keep.has(i.mediaKey));

  const gridEl = h('div', { class: 'wz-grid' });
  const sentinel = h('div', { class: 'wz-sentinel' });
  const tiles = new Map<string, HTMLElement>();
  let list: MediaItem[] = [];
  let rendered = 0;

  const footer = selectionFooter(() => {
    void ctx.trash(selected(), opts.noun[1]);
  });

  const updateFooter = (): void => {
    const sel = selected();
    const t = totals(sel);
    footer.update(`Selected: **${plural(t.count, opts.noun[0], opts.noun[1])}, ${formatBytes(t.bytes)}**  of ${plural(list.length, opts.noun[0], opts.noun[1])}${list.length < items.length ? ' shown' : ''}`, t.count > 0 && ctx.state.scan?.sharedChecked === true);
    showing.update(list.length, items.length, opts.noun[1], isFiltered());
  };

  const renderMore = (): void => {
    const next = list.slice(rendered, rendered + PAGE_SIZE);
    for (const item of next) {
      const tile = createTile(item, prefs.keep.has(item.mediaKey) ? 'keep' : 'trash', () => {
        if (prefs.keep.has(item.mediaKey)) prefs.keep.delete(item.mediaKey);
        else prefs.keep.add(item.mediaKey);
        setTileMode(tile, prefs.keep.has(item.mediaKey) ? 'keep' : 'trash');
        updateFooter();
      });
      tiles.set(item.mediaKey, tile);
      gridEl.appendChild(tile);
    }
    rendered += next.length;
    sentinel.style.display = rendered < list.length ? '' : 'none';
  };

  const rebuild = (): void => {
    list = visible();
    rendered = 0;
    tiles.clear();
    clear(gridEl);
    renderMore();
    updateFooter();
  };

  if (typeof IntersectionObserver !== 'undefined') {
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && rendered < list.length) renderMore();
    }, { rootMargin: '600px 0px' });
    io.observe(sentinel);
  } else {
    sentinel.appendChild(h('button', { class: 'wz-btn wz-btn-ghost', onclick: renderMore }, 'Show more'));
  }

  const setAll = (keep: boolean): void => {
    for (const item of visible()) {
      if (keep) prefs.keep.add(item.mediaKey);
      else prefs.keep.delete(item.mediaKey);
    }
    for (const [key, tile] of tiles) setTileMode(tile, prefs.keep.has(key) ? 'keep' : 'trash');
    updateFooter();
  };

  const chipRow = chips.length
    ? h(
      'div',
      { class: 'wz-chips' },
      ...chips.map((chip) => {
        const count = items.filter(chip.match).length;
        const btn = h('button', {
          class: `wz-chip${prefs.chips.has(chip.id) ? ' is-on' : ''}`,
          'aria-pressed': String(prefs.chips.has(chip.id)),
          onclick: () => {
            if (prefs.chips.has(chip.id)) prefs.chips.delete(chip.id);
            else prefs.chips.add(chip.id);
            btn.classList.toggle('is-on', prefs.chips.has(chip.id));
            btn.setAttribute('aria-pressed', String(prefs.chips.has(chip.id)));
            rebuild();
          },
        }, `${chip.label} (${count})`);
        return btn;
      })
    )
    : null;

  const sorter = sortSelect(prefs, { size: 'Biggest first', date: 'Newest first', oldest: 'Oldest first' }, rebuild);
  const dropdowns = filterSelects(items, filters, prefs, rebuild);

  const toolbar = h(
    'div',
    { class: 'wz-toolbar' },
    chipRow || dropdowns.length ? h('div', { class: 'wz-filters' }, ...dropdowns, chipRow) : null,
    h(
      'div',
      { class: 'wz-toolbar-right' },
      h('button', { class: 'wz-btn wz-btn-small', onclick: () => setAll(false) }, 'Select all'),
      h('button', { class: 'wz-btn wz-btn-small', onclick: () => setAll(true) }, 'Select none'),
      sorter
    )
  );

  const wrap = h('div', { class: 'wz-grid-wrap' }, toolbar, h('p', { class: 'wz-hint' }, 'Ticked items go to Trash. Tap any you want to keep. ↗ opens it in Google Photos.'), showing.el, gridEl, sentinel, footer.el);
  rebuild();
  return wrap;
}
