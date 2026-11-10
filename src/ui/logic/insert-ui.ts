import gptkMainTemplate from '../markup/gptk-main-template.html';
import buttonHtml from '../markup/gptk-button.html';
import wizardTemplate from '../markup/wizard-template.html';
import css from '../markup/style.css';
import wizardCss from '../markup/wizard.css';
import logoLight from '../../../media/brand/prospera-logo-light.png';
import logoDark from '../../../media/brand/prospera-logo-dark.png';
import prosperaMark from '../../../media/brand/prospera-mark.png';
import { updateUI } from './update-state';

const version = `v${__VERSION__}`;
const homepage = __HOMEPAGE__;

const FONT_URL = 'https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700&display=swap';

function htmlTemplatePrep(template: string): string {
  return template
    .replaceAll('%version%', version)
    .replaceAll('%homepage%', homepage)
    .replaceAll('%logoLight%', logoLight)
    .replaceAll('%logoDark%', logoDark)
    .replaceAll('%mark%', prosperaMark);
}

/** Montserrat for #gptk only. If CSP blocks it, the CSS falls back to the system stack. */
function loadBrandFont(): void {
  if (document.getElementById('gptk-font')) return;
  try {
    const link = document.createElement('link');
    link.id = 'gptk-font';
    link.rel = 'stylesheet';
    link.href = FONT_URL;
    document.head.appendChild(link);
  } catch (error) {
    console.warn('[GPTK] Could not load Montserrat, using system fonts', error);
  }
}

export function insertUi(): void {
  // For inserting HTML to work with Trusted Types
  const win = window as unknown as { trustedTypes?: { createPolicy: (name: string, policy: { createHTML: (s: string) => string }) => void } };
  if (win.trustedTypes?.createPolicy) {
    win.trustedTypes.createPolicy('default', {
      createHTML: (s: string) => s,
    });
  }
  let buttonInsertLocation = '.J3TAe';
  if (window.location.href.includes('lockedfolder')) buttonInsertLocation = '.c9yG5b';
  document.querySelector(buttonInsertLocation)?.insertAdjacentHTML('afterbegin', htmlTemplatePrep(buttonHtml));
  document.body.insertAdjacentHTML('afterbegin', htmlTemplatePrep(gptkMainTemplate));
  document.querySelector('#gptk > .header')?.insertAdjacentHTML('afterend', htmlTemplatePrep(wizardTemplate));
  const style = document.createElement('style');
  style.textContent = `${css}\n${wizardCss}`;
  document.head.appendChild(style);
  loadBrandFont();

  baseListenersSetUp();
}

export function showMainMenu(): void {
  const overlay = document.querySelector<HTMLElement>('.overlay');
  const gptk = document.getElementById('gptk');
  if (gptk) gptk.style.display = 'flex';
  if (overlay) overlay.style.display = 'block';
  document.body.style.overflow = 'hidden';
}

function hideMainMenu(): void {
  const overlay = document.querySelector<HTMLElement>('.overlay');
  const gptk = document.getElementById('gptk');
  if (gptk) gptk.style.display = 'none';
  if (overlay) overlay.style.display = 'none';
  document.body.style.overflow = 'visible';
}

function baseListenersSetUp(): void {
  document.addEventListener('change', updateUI);

  const gptkButton = document.getElementById('gptk-button');
  gptkButton?.addEventListener('click', showMainMenu);
  const exitMenuButton = document.querySelector('#hide');
  exitMenuButton?.addEventListener('click', hideMainMenu);
}
