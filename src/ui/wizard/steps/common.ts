import { h, rich } from '../dom';
import type { WizardCtx, StepId } from '../state';

export function stepTitle(title: string, subtitle?: string): HTMLElement {
  return h('div', { class: 'wz-step-title' }, h('h2', null, title), subtitle ? rich('p', subtitle, 'wz-lead') : null);
}

export function flash(ctx: WizardCtx): HTMLElement | null {
  const msg = ctx.state.flash;
  if (!msg) return null;
  ctx.state.flash = null;
  return h('div', { class: 'wz-flash', role: 'status' }, h('span', { class: 'wz-flash-icon' }, '🎉'), rich('span', msg));
}

export function nav(ctx: WizardCtx, opts: { back?: StepId; next?: StepId; nextLabel?: string; nextPrimary?: boolean }): HTMLElement {
  return h(
    'div',
    { class: 'wz-nav' },
    opts.back ? h('button', { class: 'wz-btn wz-btn-ghost', onclick: () => ctx.go(opts.back as StepId) }, 'Back') : h('span'),
    opts.next
      ? h('button', { class: opts.nextPrimary ? 'wz-btn wz-btn-primary' : 'wz-btn', onclick: () => ctx.go(opts.next as StepId) }, opts.nextLabel ?? 'Skip')
      : null
  );
}

export function needsScan(ctx: WizardCtx, back?: StepId): HTMLElement {
  const restored = ctx.state.summary && !ctx.state.scan;
  return h(
    'div',
    { class: 'wz-card wz-center' },
    h('p', null, restored ? 'Your last scan results are shown on the Scan page, but the photos need a fresh scan before you can review them.' : 'Scan your library first, so we know what to show here.'),
    h('div', { class: 'wz-row-center' }, h('button', { class: 'wz-btn wz-btn-primary', onclick: () => { ctx.go('scan'); void ctx.startScan(); } }, 'Scan my library')),
    back ? nav(ctx, { back }) : null
  );
}

export function optionToggles(ctx: WizardCtx): HTMLElement {
  const toggle = (label: string, checked: boolean, onChange: (v: boolean) => void): HTMLElement => {
    const input = h('input', { type: 'checkbox', checked, onchange: (e: Event) => { e.stopPropagation(); onChange((e.target as HTMLInputElement).checked); } });
    return h('label', { class: 'wz-toggle' }, input, h('span', null, label));
  };
  return h(
    'div',
    { class: 'wz-options' },
    toggle('Include favorites', ctx.state.includeFavorites, (v) => { ctx.state.includeFavorites = v; ctx.render(); }),
    toggle('Include photos in shared albums', ctx.state.includeShared, (v) => { ctx.state.includeShared = v; ctx.render(); })
  );
}

/** While the background shared-album check runs, Move to Trash stays locked. */
export function sharedNotice(ctx: WizardCtx): HTMLElement {
  const scan = ctx.state.scan;
  const shared = ctx.state.shared;
  if (!scan || scan.sharedChecked) return h('span');
  if (shared.error) {
    return h(
      'div',
      { class: 'wz-note wz-note-error' },
      `Couldn't check which photos are in shared albums (${shared.error}). Move to Trash stays locked so nothing shared is removed. `,
      h('button', { class: 'wz-link', onclick: () => void ctx.checkShared() }, 'Try again')
    );
  }
  const progress = shared.total ? ` (${shared.done} of ${shared.total})` : '';
  return h('div', { class: 'wz-note' }, `Checking which photos are in shared albums${progress}. Shared photos are left out, so totals may drop a little. You can look around; Move to Trash unlocks in a moment.`);
}
