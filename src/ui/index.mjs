import { ipcRenderer } from 'electron';
import { UsagePlugin } from './app.mjs';

window.__codexUsagePluginDispose?.();
const plugin = new UsagePlugin(ipcRenderer);
const dispose = () => {
  plugin.dispose();
  if (window.__codexUsagePluginDispose === dispose) window.__codexUsagePluginDispose = null;
};
window.__codexUsagePluginDispose = dispose;
if (document.readyState === 'loading') plugin.life.listen(document, 'DOMContentLoaded', () => plugin.start(), {once:true});
else plugin.start();
