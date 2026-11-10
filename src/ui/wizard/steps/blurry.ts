import { h } from '../dom';
import { stepTitle, nav, needsScan, flash, optionToggles, sharedNotice } from './common';
import { previewGrid } from '../preview-grid';
import { blurryPhotos, totals } from '../../../cleanup/categories';
import { formatBytes, plural } from '../../../cleanup/format';
import { whenFilter } from '../../../cleanup/grid-filters';
import type { WizardCtx } from '../state';

export default function blurryStep(ctx: WizardCtx): HTMLElement {
  const scan = ctx.state.scan;
  const items = scan ? blurryPhotos(scan.items, scan.sources.blurry, ctx.eligibility()) : [];
  const t = totals(items);
  const body = h(
    'div',
    { class: 'wz-step' },
    flash(ctx),
    stepTitle('Blurry photos', scan ? `Google spotted **${plural(t.count, 'blurry photo')}**, using **${formatBytes(t.bytes)}**. Keep any that matter to you.` : 'Photos Google thinks came out blurry.')
  );
  if (!scan) {
    body.appendChild(needsScan(ctx, 'screenshots'));
    return body;
  }
  body.appendChild(optionToggles(ctx));
  body.appendChild(sharedNotice(ctx));
  body.appendChild(
    previewGrid({
      ctx,
      step: 'blurry',
      items,
      noun: ['photo', 'photos'],
      filters: [whenFilter(items)],
      emptyText: 'No blurry photos found.',
    })
  );
  body.appendChild(nav(ctx, { back: 'screenshots', next: 'dupes', nextLabel: 'Next: Look-alikes' }));
  return body;
}
