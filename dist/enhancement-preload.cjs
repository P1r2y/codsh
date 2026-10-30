// codsh-source-sha256:b18d845ff45e580766ec459790593dce63a5752c9f7f8b9e1b048cba550fd34d
"use strict";
(() => {
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
    get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
  }) : x)(function(x) {
    if (typeof require !== "undefined") return require.apply(this, arguments);
    throw Error('Dynamic require of "' + x + '" is not supported');
  });
  var __commonJS = (cb, mod) => function __require2() {
    try {
      return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
    } catch (e) {
      throw mod = 0, e;
    }
  };

  // src/protocol.cjs
  var require_protocol = __commonJS({
    "src/protocol.cjs"(exports, module) {
      "use strict";
      var READ_CHANNEL = "codex-usage-ui:read-v1";
      var STATE_CHANNEL = "codex-enhancement-loader:state-v1";
      var UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
      var normalizeThreadId = (value) => typeof value === "string" && UUID.test(value) ? value.toLowerCase() : null;
      module.exports = { READ_CHANNEL, STATE_CHANNEL, UUID, normalizeThreadId };
    }
  });

  // src/enhancement-preload.cjs
  var require_enhancement_preload = __commonJS({
    "src/enhancement-preload.cjs"() {
      (() => {
        const { ipcRenderer } = __require("electron");
        const { STATE_CHANNEL } = require_protocol();
        let currentKey = null, busy = false, stopped = false;
        async function sync() {
          if (busy || stopped) return;
          busy = true;
          try {
            if (currentKey && typeof window.__codexUsagePluginDispose !== "function") currentKey = null;
            const state = await ipcRenderer.invoke(STATE_CHANNEL, { key: currentKey });
            if (stopped) return;
            if (!state.enabled || state.key !== currentKey) {
              window.__codexUsagePluginDispose?.();
              currentKey = null;
            }
            if (state.enabled && !currentKey && typeof state.code === "string") {
              new Function("require", state.code)(__require);
              currentKey = state.key;
            }
          } catch (e) {
            console.warn("[CodexEnhancementLoader]", String(e));
          } finally {
            busy = false;
          }
        }
        void sync();
        const interval = setInterval(() => void sync(), 2e3);
        window.addEventListener("beforeunload", () => {
          stopped = true;
          clearInterval(interval);
          window.__codexUsagePluginDispose?.();
        }, { once: true });
      })();
    }
  });
  require_enhancement_preload();
})();
