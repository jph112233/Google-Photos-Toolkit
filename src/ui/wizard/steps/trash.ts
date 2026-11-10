import { h, rich, openInNewTab } from '../dom';
import { stepTitle, flash } from './common';
import { refreshTrashAndQuota } from '../../../cleanup/scan';
import { formatBytes, plural } from '../../../cleanup/format';
import { saveSummary } from '../summary';
import { trashSizeText, includesPickedText, doneLines } from '../../../cleanup/trash-copy';
import type { WizardCtx } from '../state';

export const TRASH_URL = 'https://photos.google.com/trash';

async function recheck(ctx: WizardCtx): Promise<void> {
  const { state, core } = ctx;
  if (state.trashCheck.checking || core.isProcessRunning) return;
  state.trashCheck.checking = true;
  state.error = null;
  ctx.render();
  // Google returns no size info for trashed items, so Trash bytes are only
  // known for items this wizard trashed. Emptying is detected by count.
  const prev = state.scan?.trash ?? state.summary?.trash ?? { count: 0, bytes: 0 };
  core.isProcessRunning = true;
  try {
    const { quota, trash: fresh } = await refreshTrashAndQuota(core);
    const next = { ...fresh };
    if (fresh.count === 0) {
      next.bytes = 0;
    } else if (fresh.count >= prev.count) {
      next.bytes = Math.max(prev.bytes, fresh.bytes);
    }
    if (fresh.count < prev.count) {
      state.trashCheck.emptiedCount += prev.count - fresh.count;
      state.trashCheck.emptiedBytes += Math.max(0, prev.bytes - next.bytes);
    }
    if (state.scan) {
      state.scan.trash = next;
      if (quota && (quota.usedByGPhotos ?? quota.totalUsed) !== undefined) state.scan.quota = quota;
    } else if (state.summary) {
      state.summary.trash = next;
      state.summary.usedBytes = Number(quota.usedByGPhotos ?? quota.totalUsed ?? state.summary.usedBytes);
    }
    state.trashCheck.checkedAt = Date.now();
    saveSummary(state);
  } catch (error) {
    state.error = `Couldn't check the Trash: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    core.isProcessRunning = false;
    state.trashCheck.checking = false;
    ctx.render();
  }
}

export function trashStep(ctx: WizardCtx): HTMLElement {
  const { state } = ctx;
  const trash = state.scan?.trash ?? state.summary?.trash;
  const body = h('div', { class: 'wz-step' }, flash(ctx), stepTitle('Check the trash', "Items in Trash **don't count** against your storage. Google deletes them for good after 30 days, so emptying it now is optional."));
  if (state.error) body.appendChild(h('div', { class: 'wz-note wz-note-error' }, state.error));

  if (!trash) {
    body.appendChild(h('div', { class: 'wz-card' }, h('p', null, "Scan first, or open the Trash to see what's there.")));
  } else if (trash.count === 0) {
    body.appendChild(h('div', { class: 'wz-card' }, rich('p', '**Your Trash is empty.** Nothing more to do here.', 'wz-big-text')));
  } else {
    body.appendChild(
      h(
        'div',
        { class: 'wz-card' },
        rich('p', `Your Trash has **${plural(trash.count, 'item')}${trashSizeText(trash, state.trashCheck.emptiedCount ? 0 : state.freedCount)}**.`, 'wz-big-text'),
        (() => { const line = includesPickedText(state.freedCount, state.trashCheck.emptiedCount); return line ? rich('p', line, 'wz-muted') : null; })(),
        rich('p', "Want to clear it now? Emptying is permanent, so take one last look first. This toolkit can't empty it for you: open Trash, then click **Empty trash** in the top right.", 'wz-warning'),
        h('div', { class: 'wz-row-center' }, h('button', { class: 'wz-btn wz-btn-primary wz-btn-lg', onclick: () => openInNewTab(TRASH_URL) }, 'Open Trash ↗'))
      )
    );
  }

  const checking = state.trashCheck.checking;
  body.appendChild(
    h(
      'div',
      { class: 'wz-nav' },
      h('button', { class: 'wz-btn wz-btn-ghost', onclick: () => ctx.go('dupes') }, 'Back'),
      h(
        'div',
        { class: 'wz-nav-right' },
        h('button', { class: 'wz-btn', disabled: checking, onclick: () => void recheck(ctx) }, checking ? 'Checking...' : 'Re-check'),
        h('button', { class: 'wz-btn wz-btn-primary', onclick: () => ctx.go('done') }, 'Finish')
      )
    )
  );
  if (state.trashCheck.checkedAt) {
    body.appendChild(h('p', { class: 'wz-muted wz-right' }, `Checked at ${new Date(state.trashCheck.checkedAt).toLocaleTimeString()}`));
  }
  return body;
}

export function doneStep(ctx: WizardCtx): HTMLElement {
  const { state } = ctx;
  const emptied = state.trashCheck.emptiedBytes;
  const emptiedCount = state.trashCheck.emptiedCount;
  const body = h('div', { class: 'wz-step wz-done' });
  body.appendChild(h('div', { class: 'wz-done-burst', 'aria-hidden': 'true' }, '🎉'));
  body.appendChild(
    state.freedBytes > 0
      ? h('h2', { class: 'wz-done-title' }, 'You freed ', h('strong', null, formatBytes(state.freedBytes)))
      : h('h2', { class: 'wz-done-title' }, emptiedCount > 0 ? 'Trash emptied!' : 'All done!')
  );
  const lines = doneLines(state.freedCount, emptied, emptiedCount).map((line, idx) => rich('p', line, idx > 0 && !emptied && !emptiedCount && state.freedCount ? 'wz-muted' : undefined));
  body.append(...lines);
  body.appendChild(
    h(
      'div',
      { class: 'wz-row-center' },
      h('button', { class: 'wz-btn wz-btn-ghost', onclick: () => ctx.go('trash') }, 'Back to Trash'),
      h('button', { class: 'wz-btn wz-btn-primary', onclick: () => ctx.go('scan') }, 'See results')
    )
  );
  return body;
}
