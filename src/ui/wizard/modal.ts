import { h, clear } from './dom';

function host(): HTMLElement {
  return document.getElementById('gptk-wizard') ?? document.body;
}

/** In-panel confirm dialog (never window.confirm, which would block the page). */
export function confirmDialog(opts: { title: string; body: string; confirmLabel: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    const close = (result: boolean): void => {
      backdrop.remove();
      document.removeEventListener('keydown', onKey, true);
      resolve(result);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close(false);
      }
    };
    const confirmBtn = h('button', { class: opts.danger ? 'wz-btn wz-btn-danger' : 'wz-btn wz-btn-primary', onclick: () => close(true) }, opts.confirmLabel);
    const backdrop = h(
      'div',
      { class: 'wz-modal-backdrop', onclick: (e: Event) => { if (e.target === backdrop) close(false); } },
      h(
        'div',
        { class: 'wz-modal', role: 'dialog', 'aria-modal': 'true' },
        h('h3', null, opts.title),
        h('p', null, opts.body),
        h('div', { class: 'wz-modal-actions' }, h('button', { class: 'wz-btn wz-btn-ghost', onclick: () => close(false) }, 'Cancel'), confirmBtn)
      )
    );
    document.addEventListener('keydown', onKey, true);
    host().appendChild(backdrop);
    confirmBtn.focus();
  });
}

export interface ProgressDialog {
  update(done: number, total: number, text?: string): void;
  close(): void;
}

export function progressDialog(title: string, onStop?: () => void): ProgressDialog {
  const fill = h('div', { class: 'wz-progress-fill' });
  const label = h('p', { class: 'wz-muted' }, 'Starting...');
  const actions = h('div', { class: 'wz-modal-actions' });
  if (onStop) actions.appendChild(h('button', { class: 'wz-btn wz-btn-ghost', onclick: onStop }, 'Stop'));
  const backdrop = h('div', { class: 'wz-modal-backdrop' }, h('div', { class: 'wz-modal', role: 'dialog', 'aria-modal': 'true' }, h('h3', null, title), h('div', { class: 'wz-progress' }, fill), label, actions));
  host().appendChild(backdrop);
  return {
    update(done, total, text) {
      fill.style.width = `${total > 0 ? Math.round((done / total) * 100) : 0}%`;
      clear(label);
      label.textContent = text ?? `${done} of ${total}`;
    },
    close() {
      backdrop.remove();
    },
  };
}
