import { h } from '../dom';
import { stepTitle, nav, needsScan, flash, optionToggles, sharedNotice } from './common';
import { previewGrid } from '../preview-grid';
import { screenshots, screenshotKind, SCREENSHOT_KINDS, totals } from '../../../cleanup/categories';
import { formatBytes, plural } from '../../../cleanup/format';
import { typeFilter, whenFilter } from '../../../cleanup/grid-filters';
import type { WizardCtx } from '../state';

export default function screenshotsStep(ctx: WizardCtx): HTMLElement {
  const scan = ctx.state.scan;
  const items = scan ? screenshots(scan.items, scan.sources, ctx.eligibility()) : [];
  const t = totals(items);
  const body = h(
    'div',
    { class: 'wz-step' },
    flash(ctx),
    stepTitle(
      'Screenshots and app saves',
      scan
        ? `**${plural(t.count, 'item')}** from screenshots, Snapchat, WhatsApp and other apps, using **${formatBytes(t.bytes)}**.`
        : 'Screenshots plus photos saved from Snapchat, WhatsApp and other apps.'
    )
  );
  if (!scan) {
    body.appendChild(needsScan(ctx, 'videos'));
    return body;
  }
  const sources = scan.sources;
  body.appendChild(optionToggles(ctx));
  body.appendChild(sharedNotice(ctx));
  body.appendChild(
    previewGrid({
      ctx,
      step: 'screenshots',
      items,
      noun: ['item', 'items'],
      chipMode: 'any',
      defaultChips: SCREENSHOT_KINDS.map((k) => k.id),
      chips: SCREENSHOT_KINDS.map((k) => ({ id: k.id, label: k.label, match: (item) => screenshotKind(item, sources) === k.id })),
      filters: [whenFilter(items), typeFilter()],
      emptyText: 'No screenshots or app saves found.',
    })
  );
  body.appendChild(nav(ctx, { back: 'videos', next: 'blurry', nextLabel: 'Next: Blurry photos' }));
  return body;
}
