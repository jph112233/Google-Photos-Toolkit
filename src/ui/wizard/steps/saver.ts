import { h, rich, openInNewTab } from '../dom';
import { stepTitle, needsScan, flash } from './common';
import { originalQualityStats } from '../../../cleanup/categories';
import { formatBytes, formatBytesRange, formatCount } from '../../../cleanup/format';
import type { WizardCtx } from '../state';

export const SETTINGS_URL = 'https://photos.google.com/settings';

export default function saverStep(ctx: WizardCtx): HTMLElement {
  const body = h('div', { class: 'wz-step' }, flash(ctx), stepTitle('Storage saver', 'A Google setting that shrinks your photos. **Information only.** This wizard never changes it for you.'));
  const scan = ctx.state.scan;
  const stats = scan ? originalQualityStats(scan.items) : ctx.state.summary?.saver;
  if (!stats) {
    body.appendChild(needsScan(ctx, 'scan'));
    return body;
  }

  if (!stats.count) {
    body.appendChild(h('div', { class: 'wz-card' }, h('p', null, 'Good news: your big photos and videos are already in Storage saver, so there is little to gain here.')));
  } else {
    body.appendChild(
      h(
        'div',
        { class: 'wz-card' },
        rich('p', `At least **${formatCount(stats.count)}** of your biggest photos and videos are saved in **Original quality** (${formatBytes(stats.bytes)}).`, 'wz-big-text'),
        rich('p', `Switching to **Storage saver** could free at least **${formatBytesRange(stats.savingsLow, stats.savingsHigh)}**, likely more.`, 'wz-big-text'),
        rich('p', "They'll still look great on a phone, but you **can't undo** this. The originals are gone for good.", 'wz-warning'),
        h(
          'details',
          { class: 'wz-howto' },
          h('summary', null, 'How to turn it on yourself'),
          h(
            'ol',
            null,
            h('li', null, 'Open Google Photos settings (button below).'),
            rich('li', 'Find **Recover storage** and choose **Manage storage** if asked.'),
            rich('li', 'Read Google\'s notes, then confirm **Compress existing photos and videos**.')
          )
        )
      )
    );
  }

  body.appendChild(
    h(
      'div',
      { class: 'wz-nav' },
      h('button', { class: 'wz-btn wz-btn-ghost', onclick: () => ctx.go('scan') }, 'Back'),
      h(
        'div',
        { class: 'wz-nav-right' },
        stats.count ? h('button', { class: 'wz-link', onclick: () => openInNewTab(SETTINGS_URL) }, "Open Google's Recover storage setting ↗") : null,
        h('button', { class: 'wz-btn wz-btn-primary', onclick: () => ctx.go('videos') }, 'Skip for now')
      )
    )
  );
  return body;
}

