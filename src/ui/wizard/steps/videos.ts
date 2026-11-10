import { h } from '../dom';
import { stepTitle, nav, needsScan, flash, optionToggles, sharedNotice } from './common';
import { previewGrid } from '../preview-grid';
import { bigVideos, isScreenRecording, isLongVideo, totals } from '../../../cleanup/categories';
import { formatBytes, plural } from '../../../cleanup/format';
import type { WizardCtx } from '../state';

export default function videosStep(ctx: WizardCtx): HTMLElement {
  const scan = ctx.state.scan;
  const items = scan ? bigVideos(scan.items, ctx.eligibility()) : [];
  const t = totals(items);
  const body = h(
    'div',
    { class: 'wz-step' },
    flash(ctx),
    stepTitle('Big videos', scan ? `**${plural(t.count, 'video')}** over 50 MB, using **${formatBytes(t.bytes)}**. Biggest first.` : 'Videos over 50 MB, biggest first.')
  );
  if (!scan) {
    body.appendChild(needsScan(ctx, 'saver'));
    return body;
  }
  body.appendChild(optionToggles(ctx));
  body.appendChild(sharedNotice(ctx));
  body.appendChild(
    previewGrid({
      ctx,
      step: 'videos',
      items,
      noun: ['video', 'videos'],
      chipMode: 'all',
      chips: [
        { id: 'screenrec', label: 'Screen recordings', match: isScreenRecording },
        { id: 'long', label: 'Longer than 1 min', match: isLongVideo },
      ],
      emptyText: 'No videos over 50 MB. Nice!',
    })
  );
  body.appendChild(nav(ctx, { back: 'saver', next: 'screenshots', nextLabel: 'Next: Screenshots' }));
  return body;
}
