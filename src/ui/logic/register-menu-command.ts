import { showMainMenu } from './insert-ui';

export default function registerMenuCommand(): void {
  GM_registerMenuCommand('Open Free Up Space (GPTK)', function () {
    showMainMenu();
  });
}
