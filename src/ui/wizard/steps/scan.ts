import { h, rich } from '../dom';
import { stepTitle, flash, sharedNotice } from './common';
import { SCAN_PHASES } from '../../../cleanup/scan';
import { formatBytes, formatBytesRange, formatCount, formatEta, plural } from '../../../cleanup/format';
import { computeSummary } from '../summary';
import type { WizardCtx, StepId, SavedSummary } from '../state';

interface ResultCard {
  step: StepId;
  title: string;
  value: string;
  detail: string;
  bytes: number;
}

function cards(summary: SavedSummary): ResultCard[] {
  const list: ResultCard[] = [
    {
      step: 'saver',
      title: 'Storage saver',
      value: summary.saver.count ? `~${formatBytesRange(summary.saver.savingsLow, summary.saver.savingsHigh)}` : 'All set',
      detail: summary.saver.count ? `${plural(summary.saver.count, 'big item')} in Original quality` : 'Already using Storage saver',
      bytes: summary.saver.savingsHigh,
    },
    { step: 'videos', title: 'Big videos', value: formatBytes(summary.videos.bytes), detail: `${plural(summary.videos.count, 'video')} over 50 MB`, bytes: summary.videos.bytes },
    { step: 'screenshots', title: 'Screenshots and app saves', value: formatBytes(summary.screenshots.bytes), detail: plural(summary.screenshots.count, 'item'), bytes: summary.screenshots.bytes },
    { step: 'blurry', title: 'Blurry photos', value: formatBytes(summary.blurry?.bytes ?? 0), detail: plural(summary.blurry?.count ?? 0, 'photo'), bytes: summary.blurry?.bytes ?? 0 },
    { step: 'dupes', title: 'Look-alike photos', value: 'Check', detail: 'Bursts and repeat selfies', bytes: 0 },
    {
      step: 'trash',
      title: 'Trash',
      value: summary.trash.bytes > 0 ? formatBytes(summary.trash.bytes) : summary.trash.count ? plural(summary.trash.count, 'item') : 'Empty',
      detail: summary.trash.count ? `${plural(summary.trash.count, 'item')} waiting to be cleared` : 'Nothing waiting',
      bytes: summary.trash.bytes,
    },
  ];
  return list.sort((a, b) => b.bytes - a.bytes);
}

function progressView(ctx: WizardCtx): HTMLElement {
  const p = ctx.state.progress;
  const pct = Math.round((p?.fraction ?? 0) * 100);
  const activeIndex = SCAN_PHASES.findIndex((ph) => ph.id === p?.phase);
  const detailParts: string[] = [];
  if (p?.largeBytes) detailParts.push(`${formatBytes(p.largeBytes)} of big files found`);
  if (p?.itemCount) detailParts.push(`${formatCount(p.itemCount)} items to review`);
  if (p?.phase === 'details' && p.total) detailParts.push(`details for ${formatCount(p.done)} of ${formatCount(p.total)}`);
  if (p?.etaMs !== undefined && p.phase !== 'large') detailParts.push(formatEta(p.etaMs));

  return h(
    'div',
    { class: 'wz-card' },
    h('div', { class: 'wz-progress wz-progress-lg' }, h('div', { class: 'wz-progress-fill', style: `width:${pct}%` })),
    h('p', { class: 'wz-progress-text' }, `${pct}%  ${detailParts.join('  •  ')}`),
    h(
      'ol',
      { class: 'wz-phases' },
      ...SCAN_PHASES.map((ph, i) =>
        h('li', { class: i < activeIndex || p?.phase === 'done' ? 'is-done' : i === activeIndex ? 'is-active' : '' }, ph.label)
      )
    ),
    h('div', { class: 'wz-row-center' }, h('button', { class: 'wz-btn wz-btn-ghost', onclick: () => ctx.stop() }, 'Stop'))
  );
}

function resultsView(ctx: WizardCtx, summary: SavedSummary, restored: boolean): HTMLElement {
  const sorted = cards(summary);
  // Biggest win: the card with the most to free; fall back to step order.
  const best = sorted.find((c) => c.bytes > 0)?.step ?? 'saver';
  const when = new Date(summary.scannedAt).toLocaleString();
  return h(
    'div',
    null,
    restored
      ? h('div', { class: 'wz-note' }, `These numbers are from your scan on ${when}. Scan again to review and clean up.`)
      : null,
    h(
      'div',
      { class: 'wz-cards' },
      ...sorted.map((c) =>
        h(
          'button',
          { class: 'wz-result-card', onclick: () => ctx.go(c.step) },
          h('span', { class: 'wz-result-title' }, c.title),
          h('span', { class: 'wz-result-value' }, c.value),
          h('span', { class: 'wz-result-detail' }, c.detail)
        )
      )
    ),
    h(
      'div',
      { class: 'wz-nav' },
      h('button', { class: 'wz-btn wz-btn-ghost', onclick: () => void ctx.startScan() }, restored ? 'Scan my library' : 'Scan again'),
      restored ? null : h('button', { class: 'wz-btn wz-btn-primary', onclick: () => ctx.go(best) }, 'Start with the biggest win')
    )
  );
}

export default function scanStep(ctx: WizardCtx): HTMLElement {
  const { state } = ctx;
  const body = h('div', { class: 'wz-step' }, flash(ctx));

  if (state.scanning) {
    body.appendChild(stepTitle('Finding your quick wins...', "Biggest files first. This only reads your library, **nothing changes**, and it's quick even for huge libraries."));
    body.appendChild(progressView(ctx));
    return body;
  }

  if (state.error) {
    body.appendChild(h('div', { class: 'wz-note wz-note-error' }, state.error));
  }

  const live = computeSummary(state);
  if (live) {
    body.appendChild(stepTitle('Here is what we found', `Pick a card, or go step by step. ${plural(live.videos.count + live.screenshots.count + live.blurry.count, 'item')} are ready to review.`));
    body.appendChild(sharedNotice(ctx));
    body.appendChild(resultsView(ctx, live, false));
    return body;
  }

  if (state.summary) {
    body.appendChild(stepTitle('Welcome back', 'Here is what your last scan found.'));
    body.appendChild(resultsView(ctx, state.summary, true));
    return body;
  }

  body.appendChild(stepTitle("Let's find what's eating your storage", "We start with the biggest wins. It takes about a minute and **doesn't change anything**."));
  body.appendChild(
    h(
      'div',
      { class: 'wz-card wz-welcome' },
      h(
        'ul',
        { class: 'wz-list' },
        h('li', null, 'We look for big videos, screenshots, blurry shots, and look-alike photos.'),
        h('li', null, 'You pick what goes. Nothing is deleted without you saying so.'),
        rich('li', 'Anything you remove sits in **Trash for 30 days**, so you can get it back.')
      ),
      h('div', { class: 'wz-row-center' }, h('button', { class: 'wz-btn wz-btn-primary wz-btn-lg', onclick: () => void ctx.startScan() }, 'Scan my library'))
    )
  );
  return body;
}
