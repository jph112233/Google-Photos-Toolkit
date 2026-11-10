import type { WindowGlobalData } from './types';

// Fallback to {}: on the setup page (not Google Photos) WIZ_global_data is absent,
// and this module is still evaluated when the bundle loads.
const wiz: Record<string, unknown> = unsafeWindow.WIZ_global_data ?? {};

export const windowGlobalData: WindowGlobalData = {
  rapt: wiz.Dbw5Ud,
  account: wiz.oPEP7c as string,
  'f.sid': wiz.FdrFJe as string,
  bl: wiz.cfb2h as string,
  path: wiz.eptZe as string,
  at: wiz.SNlM0e as string,
};
