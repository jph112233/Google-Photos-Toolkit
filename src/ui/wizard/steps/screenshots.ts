import { h } from '../dom';
import { stepTitle, nav, needsScan, flash, optionToggles } from './common';
import { previewGrid } from '../preview-grid';
import { screenshots, screenshotKind, SCREENSHOT_KINDS, totals } from '../../../cleanup/categories';
import { formatBytes, plural } from '../../../cleanup/format';
import type { WizardCtx } from '../state';

export default function screenshotsStep(ctx: WizardCtx): HTMLElement {
  const scan = ctx.state.scan;
  const items = scan ? screenshots(scan.items, scan.screenshotKeys, ctx.eligibility()) : [];
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
  const keys = scan.screenshotKeys;
  body.appendChild(optionToggles(ctx));
  body.appendChild(
    previewGrid({
      ctx,
      step: 'screenshots',
      items,
      noun: ['item', 'items'],
      chipMode: 'any',
      defaultChips: SCREENSHOT_KINDS.map((k) => k.id),
      chips: SCREENSHOT_KINDS.map((k) => ({ id: k.id, label: k.label, match: (item) => screenshotKind(item, keys) === k.id })),
      emptyText: 'No screenshots or app saves found.',
    })
  );
  body.appendChild(nav(ctx, { back: 'videos', next: 'dupes', nextLabel: 'Next: Look-alikes' }));
  return body;
}
