// Dropdown filters, sort and the "Showing X of Y" line, shared by the review grids.
import { h } from './dom';
import { formatCount } from '../../cleanup/format';
import { ALL, isUseful, optionCounts, type GridFilter } from '../../cleanup/grid-filters';
import type { MediaItem } from '../../types';
import type { GridPrefs, GridSort } from './state';

/** Selects for each filter that would actually narrow `items`. Options with no matches are left out. */
export function filterSelects(items: MediaItem[], filters: GridFilter[], prefs: GridPrefs, onChange: () => void): HTMLElement[] {
  return filters
    .filter((f) => isUseful(items, f) || (prefs.filters[f.id] ?? ALL) !== ALL)
    .map((f) => {
      const counts = optionCounts(items, f);
      const current = prefs.filters[f.id] ?? ALL;
      const select = h(
        'select',
        {
          class: 'wz-select',
          'aria-label': f.label,
          onchange: (e: Event) => {
            e.stopPropagation();
            prefs.filters[f.id] = (e.target as HTMLSelectElement).value;
            select.classList.toggle('is-on', prefs.filters[f.id] !== ALL);
            onChange();
          },
        },
        ...f.options
          .filter((o) => o.value === ALL || o.value === current || (counts.get(o.value) ?? 0) > 0)
          .map((o) => h('option', { value: o.value, selected: o.value === current }, o.value === ALL ? o.label : `${o.label} (${formatCount(counts.get(o.value) ?? 0)})`))
      );
      select.classList.toggle('is-on', current !== ALL);
      return select;
    });
}

export function sortSelect(prefs: GridPrefs, labels: Record<GridSort, string>, onChange: () => void): HTMLElement {
  return h(
    'select',
    {
      class: 'wz-select',
      'aria-label': 'Sort',
      onchange: (e: Event) => {
        e.stopPropagation();
        prefs.sort = (e.target as HTMLSelectElement).value as GridSort;
        onChange();
      },
    },
    ...(Object.keys(labels) as GridSort[]).map((value) => h('option', { value, selected: prefs.sort === value }, labels[value]))
  );
}

/** "Showing 120 of 2,431 videos. Only these can go to Trash.  Clear filters" (hidden when nothing is filtered out). */
export function showingLine(onClear: () => void): { el: HTMLElement; update(shown: number, total: number, noun: string, filtered: boolean): void } {
  const text = h('span');
  const clearBtn = h('button', { class: 'wz-link', onclick: (e: Event) => { e.stopPropagation(); onClear(); } }, 'Clear filters');
  const el = h('div', { class: 'wz-showing', role: 'status' }, text, clearBtn);
  return {
    el,
    update(shown, total, noun, filtered) {
      el.style.display = filtered ? '' : 'none';
      text.textContent = `Showing ${formatCount(shown)} of ${formatCount(total)} ${noun}. Only these can go to Trash. `;
    },
  };
}
