import { isPhotosHost, runSetupBridge, consumeOpenRequest } from './setup-bridge';
import initUI from './ui/logic/gptk-ui-init';
import { showMainMenu } from './ui/logic/insert-ui';

if (isPhotosHost(window.location.hostname)) {
  initUI();
  const openNow = consumeOpenRequest(window.location, (url) => history.replaceState(history.state, '', url));
  if (openNow) showMainMenu();
} else {
  runSetupBridge(document, __VERSION__);
}
