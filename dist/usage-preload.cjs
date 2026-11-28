// codsh-source-sha256:175349c97d06618faf9d81d32b5508ab421e7ab0ec971340798bda7f762b177b
(() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
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
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));

  // src/protocol.cjs
  var require_protocol = __commonJS({
    "src/protocol.cjs"(exports, module) {
      "use strict";
      var READ_CHANNEL = "codex-usage-ui:read-v1";
      var CHANGE_CHANNEL = "codex-usage-ui:changed-v1";
      var STATE_CHANNEL = "codex-enhancement-loader:state-v1";
      var NATIVE_FROM_VIEW = "codex_desktop:message-for-view";
      var UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
      var normalizeThreadId2 = (value) => typeof value === "string" && UUID.test(value) ? value.toLowerCase() : null;
      module.exports = { READ_CHANNEL, CHANGE_CHANNEL, STATE_CHANNEL, NATIVE_FROM_VIEW, UUID, normalizeThreadId: normalizeThreadId2 };
    }
  });

  // src/usage-model.cjs
  var require_usage_model = __commonJS({
    "src/usage-model.cjs"(exports, module) {
      "use strict";
      var FIELDS = ["input_tokens", "cached_input_tokens", "output_tokens", "reasoning_output_tokens", "total_tokens"];
      var emptyUsage = () => Object.fromEntries(FIELDS.map((k) => [k, 0]));
      var number = (n) => Number.isFinite(n) && n >= 0 ? n : null;
      var clamp = (n) => Math.min(100, Math.max(0, n));
      function usage(v) {
        if (!v || number(v.input_tokens) === null || number(v.output_tokens) === null) return null;
        const out = emptyUsage();
        for (const k of FIELDS) out[k] = number(v[k]) ?? 0;
        out.total_tokens = number(v.total_tokens) ?? out.input_tokens + out.output_tokens;
        return out;
      }
      function add(a, b) {
        for (const k of FIELDS) a[k] += b[k];
        return a;
      }
      function difference(a, b) {
        return Object.fromEntries(FIELDS.map((k) => [k, Math.max(0, a[k] - b[k])]));
      }
      function statisticsFor2(turns) {
        const output = turns.reduce((n, t) => n + (t.usage?.output_tokens ?? 0), 0);
        const measured = turns.filter((t) => (t.usage?.output_tokens ?? 0) > 0);
        const complete = measured.length > 0 && measured.every((t) => t.estimatedGenerationTps != null && t.generatedMs > 0);
        const generatedMs = complete ? measured.reduce((n, t) => n + t.generatedMs, 0) : null;
        const durationMs = turns.every((t) => t.durationMs != null) ? turns.reduce((n, t) => n + t.durationMs, 0) : null;
        return {
          generatedMs,
          durationMs,
          estimatedGenerationTps: generatedMs > 0 ? output * 1e3 / generatedMs : null,
          averageTps: durationMs > 0 && output > 0 ? output * 1e3 / durationMs : null
        };
      }
      function usageParts2(usage2, compact = false) {
        const cached = usage2 ? Math.min(usage2.input_tokens, usage2.cached_input_tokens) : null;
        const parts = [
          { key: "uncached", label: "\u672A\u7F13\u5B58\u8F93\u5165", amount: usage2 ? usage2.input_tokens - cached : null },
          { key: "cached", label: "\u7F13\u5B58\u8F93\u5165", amount: cached },
          { key: "output", label: compact ? "\u8F93\u51FA" : "\u8F93\u51FA\uFF08\u542B\u63A8\u7406\uFF09", amount: usage2?.output_tokens }
        ];
        const missing = usage2 ? Math.max(0, usage2.total_tokens - usage2.input_tokens - usage2.output_tokens) : 0;
        if (missing > 0) {
          for (const part of parts) if (part.amount === 0) part.amount = null;
          parts.push({ key: "unknown", label: "\u672A\u5206\u7C7B", amount: missing });
        }
        return parts;
      }
      module.exports = { FIELDS, emptyUsage, number, clamp, usage, add, difference, statisticsFor: statisticsFor2, usageParts: usageParts2 };
    }
  });

  // src/quota-model.cjs
  var require_quota_model = __commonJS({
    "src/quota-model.cjs"(exports, module) {
      "use strict";
      var { number, clamp } = require_usage_model();
      var time = (value) => typeof value === "number" ? value < 1e12 ? value * 1e3 : value : Date.parse(value);
      function normalizeLimits2(raw, observedAt = Date.now()) {
        if (!raw) return null;
        const groups = raw.rateLimitsByLimitId ?? raw.rate_limits_by_limit_id;
        const candidates = groups ? Object.values(groups) : [raw.rateLimits ?? raw.rate_limits ?? raw];
        const groupsOut = candidates.filter(Boolean).map((group) => {
          const windows = ["primary", "secondary"].flatMap((kind) => {
            const window2 = group[kind];
            if (!window2) return [];
            const used = number(window2.usedPercent ?? window2.used_percent);
            const minutes = number(window2.windowDurationMins ?? window2.window_minutes);
            const resetsAt = number(window2.resetsAt ?? window2.resets_at);
            if (used === null || minutes === null || minutes === 0) return [];
            return [{
              kind,
              usedPercent: clamp(used),
              remainingPercent: clamp(100 - used),
              windowMinutes: minutes,
              resetsAt: resetsAt === null ? null : time(resetsAt),
              label: minutes === 10080 ? "\u5468\u989D\u5EA6" : minutes === 300 ? "5 \u5C0F\u65F6\u989D\u5EA6" : `${minutes / 60} \u5C0F\u65F6\u989D\u5EA6`
            }];
          });
          return { id: group.limitId ?? group.limit_id ?? "codex", name: group.limitName ?? group.limit_name ?? "Codex", windows };
        }).filter((group) => group.windows.length);
        return groupsOut.length ? { groups: groupsOut, observedAt } : null;
      }
      function quotaWindow(limits, now = Date.now()) {
        const windows = limits?.groups?.flatMap((group) => group.windows.map((window2) => ({ ...window2, groupName: group.name }))) ?? [];
        const current = windows.filter((window2) => window2.resetsAt == null || window2.resetsAt > now);
        return (current.length ? current : windows).sort((a, b) => a.remainingPercent - b.remainingPercent || a.windowMinutes - b.windowMinutes)[0] ?? null;
      }
      module.exports = { normalizeLimits: normalizeLimits2, quotaWindow };
    }
  });

  // src/ui/index.mjs
  var import_electron = __require("electron");

  // src/ui/lifetime.mjs
  var Lifetime = class {
    constructor() {
      this.abort = new AbortController();
      this.cleanup = [];
      this.disposed = false;
    }
    listen(target, type, listener, options = {}) {
      target.addEventListener(type, listener, { ...options, signal: this.abort.signal });
    }
    interval(callback, milliseconds) {
      const id = setInterval(callback, milliseconds);
      this.cleanup.push(() => clearInterval(id));
    }
    own(dispose2) {
      this.cleanup.push(dispose2);
    }
    dispose() {
      if (this.disposed) return;
      this.disposed = true;
      this.abort.abort();
      for (const dispose2 of this.cleanup.reverse()) dispose2();
      this.cleanup.length = 0;
    }
  };

  // src/ui/background-scan.mjs
  var BackgroundScan = class {
    constructor({ interval = 1200, gap = 48, batchSize = 8, budgetMs = 3, now = () => performance.now() } = {}) {
      Object.assign(this, { interval, gap, batchSize, budgetMs, now });
      this.lastStarted = -Infinity;
      this.timer = null;
      this.idle = null;
      this.pending = null;
      this.iterator = null;
      this.disposed = false;
      this.updates = [];
      this.requestIdle = globalThis.requestIdleCallback?.bind(globalThis) ?? ((fn) => setTimeout(() => fn({ didTimeout: false, timeRemaining: () => 50 }), 0));
      this.cancelIdle = globalThis.cancelIdleCallback?.bind(globalThis) ?? clearTimeout;
    }
    request(factory, visible2 = false) {
      if (this.disposed) return;
      this.pending = factory;
      if (visible2 && !this.urgent) {
        this.urgent = true;
        clearTimeout(this.timer);
        if (this.idle !== null) this.cancelIdle(this.idle);
        this.idle = null;
        this.plan(0);
      } else if (this.timer === null && this.idle === null) this.plan(Math.max(0, this.interval - (this.now() - this.lastStarted)));
    }
    plan(delay) {
      this.timer = setTimeout(() => {
        this.timer = null;
        if (this.lastStarted === -Infinity || this.urgent) {
          this.urgent = false;
          this.run({ didTimeout: false, timeRemaining: () => this.budgetMs });
          return;
        }
        this.idle = this.requestIdle((deadline) => {
          this.idle = null;
          this.run(deadline);
        }, { timeout: 500 });
      }, delay);
    }
    run(deadline) {
      if (this.disposed) return;
      const deferred = this.updates.length > 0;
      if (!this.iterator && !deferred) {
        const factory = this.pending;
        this.pending = null;
        if (!factory) return;
        this.iterator = factory();
        this.lastStarted = this.now();
      }
      const start = this.now(), limit = deadline.didTimeout ? 1 : this.batchSize;
      const hasTime = () => this.now() - start < this.budgetMs && deadline.timeRemaining() >= 1;
      try {
        if (!deferred) {
          for (let count = 0; count < limit && (count === 0 || hasTime()); count++) {
            const { value, done } = this.iterator.next();
            if (value) this.updates.push(value);
            if (done) {
              this.iterator = null;
              break;
            }
          }
        }
        for (let count = 0; count < limit && this.updates.length && (count === 0 || hasTime()); count++) {
          const update = this.updates.shift();
          update(deferred);
        }
      } catch (error) {
        this.updates.length = 0;
        this.iterator = null;
        console.warn("[CodexUsageUI]", String(error));
      }
      if (this.iterator || this.updates.length) this.plan(this.gap);
      else if (this.pending) this.plan(Math.max(this.gap, this.interval - (this.now() - this.lastStarted)));
    }
    cancel() {
      this.urgent = false;
      clearTimeout(this.timer);
      if (this.idle !== null) this.cancelIdle(this.idle);
      this.timer = null;
      this.idle = null;
      this.pending = null;
      this.updates.length = 0;
      this.iterator?.return?.();
      this.iterator = null;
      this.lastStarted = -Infinity;
    }
    dispose() {
      this.cancel();
      this.disposed = true;
    }
  };

  // src/ui/reply-cache.mjs
  var import_protocol2 = __toESM(require_protocol(), 1);

  // src/ui/dom.mjs
  var import_protocol = __toESM(require_protocol(), 1);
  var { normalizeThreadId } = import_protocol.default;
  var OWN = ".cu-strip,.cu-turn,.cu-ring,.cu-quota-panel,.cu-panel,#codex-usage-ui-style";
  var STRUCTURAL_MARKERS = "[data-thread-find-composer],[data-thread-scroll-footer],[data-above-composer-conversation-id],[data-content-search-turn-key],[data-response-annotation-conversation],.turn-action-controls,[data-app-navigation-rail],[data-transition-phase],[data-chatgpt-composer]";
  function structural(node) {
    return node.nodeType === 1 && !node.closest(OWN) && (node.matches(STRUCTURAL_MARKERS) || node.querySelector(STRUCTURAL_MARKERS) !== null);
  }
  function visible(node) {
    return node && node.closest('[aria-hidden="true"],[hidden],[inert]') == null && node.getClientRects().length > 0 && !["hidden", "collapse"].includes(getComputedStyle(node).visibility);
  }
  function uniqueThread(nodes, attribute) {
    const ids = new Set(nodes.map((node) => normalizeThreadId(node.getAttribute(attribute))).filter(Boolean));
    return ids.size === 1 ? [...ids][0] : null;
  }
  function composerRoot(node) {
    const footer = node.closest("[data-thread-scroll-footer]");
    if (!footer) return node;
    let parent;
    while ((parent = node.parentElement?.closest("[data-thread-find-composer]")) && footer.contains(parent)) node = parent;
    return node;
  }
  function turnId(root, turns) {
    const key = root.getAttribute("data-content-search-turn-key") ?? "";
    if (turns.has(key)) return key;
    const candidates = [key, ...key.match(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/gi) ?? [], ...key.split(/[^\w-]+/)];
    return candidates.find((candidate) => turns.has(candidate)) ?? null;
  }
  var CodexDOM = class {
    constructor() {
      this.footers = /* @__PURE__ */ new Set();
      this.actions = /* @__PURE__ */ new Map();
      this.actionParents = /* @__PURE__ */ new WeakMap();
      this.visibilityNodes = /* @__PURE__ */ new Set();
    }
    invalidateShell() {
      this.composerNodes = null;
      this.rails = null;
      this.cachedQuotaMount = void 0;
      this.quotaObserver?.disconnect();
      this.fallbackThread = null;
    }
    responseChanged(response) {
      if (!this.fallbackResponses) return;
      this.fallbackThread = null;
      if (response.isConnected && response.hasAttribute("data-response-annotation-conversation")) this.fallbackResponses.add(response);
      else this.fallbackResponses.delete(response);
    }
    watchVisibility(callback) {
      this.visibilityObserver = new MutationObserver((records) => {
        const normalize = (value, name) => {
          if (name === "class") return (value ?? "").split(/\s+/).filter((x) => x && !x.startsWith("cu-")).sort().join(" ");
          if (name === "style") return (value ?? "").split(";").map((x) => x.trim()).filter((x) => /^(?:display|visibility|content-visibility)\s*:/.test(x)).sort().join(";");
          return value;
        };
        const changed = records.filter((r) => normalize(r.oldValue, r.attributeName) !== normalize(r.target.getAttribute(r.attributeName), r.attributeName));
        if (changed.length) {
          if (changed.some((r) => this.rails?.some((rail) => r.target.contains(rail)))) this.cachedQuotaMount = void 0;
          callback(new Set(changed.map((r) => r.target)));
        }
      });
    }
    trackVisibility() {
      const next = /* @__PURE__ */ new Set();
      for (const node of [...this.composerNodes ?? [], ...this.rails ?? []]) {
        for (let parent = node; parent; parent = parent.parentElement) next.add(parent);
      }
      if (next.size === this.visibilityNodes.size && [...next].every((node) => this.visibilityNodes.has(node))) return;
      this.visibilityNodes = next;
      this.visibilityObserver?.disconnect();
      for (const node of next) this.visibilityObserver?.observe(node, { attributes: true, attributeOldValue: true, attributeFilter: ["class", "style", "hidden", "inert", "aria-hidden"] });
    }
    composer() {
      if (!this.composerNodes) {
        this.composerNodes = [...document.querySelectorAll("[data-thread-find-composer]")].filter((node) => !node.matches("button,input,textarea"));
        this.trackVisibility();
      }
      const all = this.composerNodes;
      const nodes = [...new Set(all.filter(visible).map(composerRoot))];
      const footers = nodes.filter((node) => node.closest("[data-thread-scroll-footer]"));
      const candidates = footers.length ? footers : nodes;
      return candidates.find((node) => node.contains(document.activeElement)) ?? candidates.at(-1) ?? null;
    }
    thread(composer = this.composer()) {
      for (const scope2 of [composer, composer?.closest("[data-thread-scroll-footer]")]) {
        const portals = scope2 ? [...scope2.querySelectorAll("[data-above-composer-conversation-id]")] : [];
        if (portals.length) return uniqueThread(portals, "data-above-composer-conversation-id");
      }
      const container = composer?.closest(".thread-scroll-container");
      if (composer && !container) return null;
      const scope = container ?? document;
      if (this.fallbackThread?.scope === scope) return this.fallbackThread.id;
      this.fallbackResponses ??= new Set(document.querySelectorAll("[data-response-annotation-conversation]"));
      const responses = [...this.fallbackResponses].filter((node) => (scope === document || scope.contains(node)) && visible(node));
      const id = uniqueThread(responses, "data-response-annotation-conversation");
      this.fallbackThread = { scope, id };
      return id;
    }
    chatMode(composer) {
      return Boolean(composer?.matches("[data-chatgpt-composer]") || [...composer?.querySelectorAll("[data-chatgpt-composer]") ?? []].some(visible));
    }
    context() {
      const composer = this.composer();
      return { composer, id: this.thread(composer) };
    }
    quotaMount() {
      const mount = this.cachedQuotaMount;
      if (mount === null || mount?.parent.isConnected && (!mount.before || mount.before.parentNode === mount.parent)) return mount;
      return this.cachedQuotaMount = this.findQuotaMount();
    }
    watchQuota(callback) {
      this.quotaObserver = new MutationObserver((records) => {
        const changed = records.some(({ type, target, addedNodes, removedNodes, attributeName, oldValue }) => {
          if (target.closest(OWN)) return false;
          if (type === "attributes") {
            if (attributeName === "data-transition-phase") return oldValue === null || !target.hasAttribute(attributeName);
            return oldValue !== target.getAttribute(attributeName);
          }
          return [addedNodes, removedNodes].some((list) => Array.prototype.some.call(list, (node) => node.nodeType === 1 && !node.matches(OWN)));
        });
        if (changed) {
          this.cachedQuotaMount = void 0;
          callback();
        }
      });
    }
    findQuotaMount() {
      if (!this.rails) {
        this.rails = [...document.querySelectorAll("[data-app-navigation-rail]")];
        this.trackVisibility();
        for (const rail2 of this.rails) this.quotaObserver?.observe(rail2, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeOldValue: true,
          attributeFilter: ["data-transition-phase", "aria-label", "title", "role", "hidden", "inert", "aria-hidden"]
        });
      }
      const rail = this.rails.find(visible);
      if (!rail) return null;
      const buttons = [...rail.querySelectorAll('button,[role="button"]')].filter((node) => !node.closest(OWN));
      const nativeQuota = buttons.find((node) => node.querySelector("[data-transition-phase]") && !node.closest('[hidden],[aria-hidden="true"],[inert]'));
      if (nativeQuota) return { parent: nativeQuota.parentElement, before: nativeQuota };
      let anchor = buttons.find((node) => /^(下载|Downloads?)(?:\b|$)|查看下载/i.test(node.getAttribute("aria-label") ?? node.getAttribute("title") ?? "")) ?? buttons.at(-1);
      if (!anchor) return { parent: rail, before: null };
      while (anchor.parentElement !== rail && anchor.parentElement && !/column/.test(getComputedStyle(anchor.parentElement).flexDirection)) anchor = anchor.parentElement;
      return { parent: anchor.parentElement, before: anchor };
    }
    alignComposer(composer, remeasure = false) {
      const footer = composer?.closest("[data-thread-scroll-footer]");
      if (!footer || this.footers.has(footer) && !remeasure) return;
      footer.classList.remove("cu-footer");
      const padding = parseFloat(getComputedStyle(footer).paddingBottom) || 0;
      const nativeAfter = footer.classList.contains("after:h-(--thread-composer-bottom-inset)") ? getComputedStyle(footer, "::after") : null;
      const after = nativeAfter && nativeAfter.display !== "none" && nativeAfter.content !== "none" ? parseFloat(nativeAfter.height) || 0 : 0;
      const inset = padding + after;
      footer.style.setProperty("--cu-strip-height", `${30 + Math.max(0, inset - 8)}px`);
      footer.classList.add("cu-footer");
      this.footers.add(footer);
    }
    setActionParent(stats, row) {
      const old = this.actionParents.get(stats);
      if (old && old !== row && this.actions.get(old) === stats) {
        old.classList.remove("cu-action-row");
        this.actions.delete(old);
      }
      if (row) {
        if (!row.classList.contains("cu-action-row")) row.classList.add("cu-action-row");
        this.actions.set(row, stats);
        this.actionParents.set(stats, row);
      } else this.actionParents.delete(stats);
    }
    reconcile() {
      for (const footer of this.footers) {
        if (footer.isConnected && footer.querySelector(".cu-strip")) continue;
        footer.classList.remove("cu-footer");
        footer.style.removeProperty("--cu-strip-height");
        this.footers.delete(footer);
      }
    }
    remountActions(record, threadId, replies) {
      if (record.removedNodes.length !== 1 || record.addedNodes.length !== 1) return false;
      const old = record.removedNodes[0], row = record.addedNodes[0];
      if (!this.actions.has(old) || old.isConnected || !row.matches?.(".turn-action-controls")) return false;
      const response = row.closest("[data-response-annotation-conversation]");
      if (!response || normalizeThreadId(response.dataset.responseAnnotationConversation) !== threadId) return false;
      const root = response.closest("[data-content-search-turn-key]");
      const group = root && replies.get(turnId(root, replies));
      if (!group || group.node.parentElement !== old || row.querySelector(".cu-turn") || !visible(row)) return false;
      this.setActionParent(group.node, row);
      group.mount(row);
      return true;
    }
    relevant(record) {
      const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
      if (target?.closest(OWN)) return false;
      if (record.type === "attributes") {
        return !["hidden", "aria-hidden", "inert"].includes(record.attributeName) || structural(target);
      }
      const nodes = [...record.addedNodes, ...record.removedNodes];
      if ([...record.removedNodes].some((node) => node.nodeType === 1 && node.matches(".cu-strip,.cu-turn,.cu-ring") && !node.isConnected)) return true;
      if (nodes.some(structural)) return true;
      return target?.matches("[data-thread-find-composer],[data-thread-scroll-footer],.turn-action-controls,[data-app-navigation-rail]") && nodes.some((node) => node.nodeType === 1 && !node.matches(OWN));
    }
    dispose() {
      this.visibilityObserver?.disconnect();
      this.quotaObserver?.disconnect();
      this.visibilityNodes.clear();
      for (const footer of this.footers) {
        footer.classList.remove("cu-footer");
        footer.style.removeProperty("--cu-strip-height");
      }
      for (const row of this.actions.keys()) row.classList.remove("cu-action-row");
      this.footers.clear();
      this.actions.clear();
    }
  };

  // src/ui/reply-cache.mjs
  var RESPONSE = "[data-response-annotation-conversation]";
  var TURN = "[data-content-search-turn-key]";
  var ACTION = ".turn-action-controls";
  var SHELL = "[data-thread-find-composer],[data-app-navigation-rail]";
  var MARKERS = [RESPONSE, ACTION, SHELL].join(",");
  var STREAMING_MARKDOWN = '[data-markdown-text-style="assistant-message"][data-markdown-animated]';
  var FORMATTING = `:is(p,pre,code,span,em,strong,b,i,s,del,a,br,wbr,hr,h1,h2,h3,h4,h5,h6,blockquote,ul,ol,li,table,thead,tbody,tr,th,td):not(${STRUCTURAL_MARKERS},${OWN})`;
  var VIEWPORT_HISTORY_SIZE = 96;
  function hasElement(nodes) {
    return Array.prototype.some.call(nodes, (node) => node.nodeType === 1);
  }
  function onlyFormatting(nodes) {
    return Array.prototype.every.call(nodes, (node) => node.nodeType !== 1 || node.matches(FORMATTING));
  }
  function lastVisible(nodes) {
    return nodes.findLast(visible);
  }
  function isCompleteTurnList(nodes, parent) {
    return nodes.length >= 2 && nodes.length === parent.childElementCount && !parent.closest(TURN + "," + RESPONSE) && Array.prototype.every.call(nodes, (node) => node.parentElement === parent && node.matches?.(TURN));
  }
  function statsChanged(previous, next) {
    return previous?.usage?.total_tokens !== next?.usage?.total_tokens || previous?.cacheHitPercent !== next?.cacheHitPercent || previous?.estimatedGenerationTps !== next?.estimatedGenerationTps || previous?.averageTps !== next?.averageTps;
  }
  var ConversationReplies = class {
    constructor(id, owners, onVisible) {
      this.id = id;
      this.owners = owners;
      this.onVisible = onVisible;
      this.nearby = /* @__PURE__ */ new Set();
      this.streamRoots = /* @__PURE__ */ new Set();
      this.indexed = false;
      this.nodes = /* @__PURE__ */ new Map();
      this.byTurn = /* @__PURE__ */ new Map();
      this.unresolved = /* @__PURE__ */ new Set();
      this.pendingMarkdown = /* @__PURE__ */ new WeakSet();
      this.turns = /* @__PURE__ */ new Map();
      this.groups = /* @__PURE__ */ new Map();
      this.mounts = /* @__PURE__ */ new Map();
      this.dirty = /* @__PURE__ */ new Set();
      this.domRevision = 0;
    }
    watchViewport() {
      if (this.viewport || typeof IntersectionObserver !== "function") return;
      this.viewport = new IntersectionObserver((entries) => {
        let changed = false;
        for (const entry of entries) {
          const row = this.nodes.get(entry.target);
          if (!row) continue;
          if (!entry.isIntersecting) {
            this.nearby.delete(entry.target);
            continue;
          }
          if (this.nearby.has(entry.target)) continue;
          this.nearby.add(entry.target);
          if (row.key != null && this.turns.get(row.key)?.completed) {
            this.invalidate(row.key);
            changed = true;
          }
        }
        if (changed) this.onVisible(this);
      }, { rootMargin: "400px 0px", scrollMargin: "400px 0px" });
      for (const response of this.nodes.keys()) this.viewport.observe(response);
    }
    nearTurn(key) {
      if (!this.viewport) return true;
      for (const response of this.nearby) if (this.nodes.get(response)?.key === key) return true;
      return false;
    }
    invalidate(key) {
      if (key == null) return;
      this.mounts.delete(key);
      if (!this.groups.has(key) && !this.nearTurn(key)) return;
      this.dirty.add(key);
      this.domRevision++;
    }
    remove(response, forget = true) {
      const row = this.nodes.get(response);
      if (!row) return;
      if (forget) {
        this.viewport?.unobserve(response);
        this.nearby.delete(response);
        if (row.root && !row.root.isConnected) this.streamRoots.delete(row.root);
      }
      this.nodes.delete(response);
      this.unresolved.delete(response);
      const peers = this.byTurn.get(row.key);
      if (peers) {
        peers.delete(row);
        if (!peers.size) this.byTurn.delete(row.key);
      }
      this.invalidate(row.key);
    }
    bind(response, fromInitialList = false) {
      const known = this.nodes.has(response);
      this.remove(response, false);
      let root = response.closest(TURN);
      let key = null;
      while (root && !(key = turnId(root, this.turns))) {
        this.unresolved.add(response);
        root = root.parentElement?.closest(TURN);
      }
      if (!key) this.unresolved.add(response);
      const row = { response, root, key };
      this.nodes.set(response, row);
      if (!known) this.viewport?.observe(response);
      if (key == null) return;
      if (!this.byTurn.has(key)) this.byTurn.set(key, /* @__PURE__ */ new Set());
      this.byTurn.get(key).add(row);
      if (this.pendingMarkdown.delete(response)) {
        for (const nested of response.querySelectorAll(RESPONSE)) this.bindOwned(nested);
      }
      if (fromInitialList && this.mounts.has(key)) {
        const chosen = this.mounts.get(key);
        if (!chosen && this.viewport && !this.nearby.has(response)) return;
        if (chosen ? response.compareDocumentPosition(chosen.response) & Node.DOCUMENT_POSITION_FOLLOWING : !visible(response)) return;
      }
      this.invalidate(key);
    }
    setSnapshot(snapshot) {
      if (this.snapshot === snapshot) return;
      this.snapshot = snapshot;
      const previous = this.turns;
      this.turns = new Map((snapshot.turns ?? []).map((turn) => [turn.id, turn]));
      const priorLive = this.liveId;
      const last = snapshot.turns?.at(-1);
      this.liveId = last && !last.completed ? last.id : null;
      if (this.liveId || this.turns.size >= VIEWPORT_HISTORY_SIZE) this.watchViewport();
      const rebind = /* @__PURE__ */ new Set();
      let added = false;
      for (const [id, turn] of this.turns) {
        const prior = previous.get(id);
        if (!prior) added = true;
        if (!this.byTurn.has(id) && !this.groups.has(id)) continue;
        if (prior?.completed !== turn.completed) this.invalidate(id);
        else if (turn.completed && this.nearTurn(id) && statsChanged(prior, turn)) this.dirty.add(id);
      }
      for (const id of previous.keys()) {
        if (this.turns.has(id) || !this.byTurn.has(id) && !this.groups.has(id)) continue;
        this.invalidate(id);
        for (const row of this.byTurn.get(id) ?? []) rebind.add(row.response);
      }
      if (added) for (const response of this.unresolved) rebind.add(response);
      for (const response of rebind) this.bind(response);
      if (priorLive && this.liveId !== priorLive) this.finishStream(priorLive);
    }
    deferStreamMutation(target, response) {
      if (!this.liveId) return false;
      let root = target.closest(TURN);
      let key;
      while (root && !(key = turnId(root, this.turns))) root = root.parentElement?.closest(TURN);
      if (key !== this.liveId) return false;
      if (response) {
        if (import_protocol2.default.normalizeThreadId(response.dataset.responseAnnotationConversation) !== this.id) return false;
      } else if (!this.streamRoots.has(root) && !import_protocol2.default.normalizeThreadId(this.liveId) && ![...this.byTurn.get(this.liveId) ?? []].some((row) => row.root === root)) return false;
      if (!this.streamRoots.has(root)) {
        for (const previous of this.streamRoots) if (!previous.isConnected) this.streamRoots.delete(previous);
        this.streamRoots.add(root);
      }
      return true;
    }
    bindOwned(response) {
      if (import_protocol2.default.normalizeThreadId(response.dataset.responseAnnotationConversation) !== this.id) return;
      this.bind(response);
      this.owners.set(response, this);
    }
    finishStream(key) {
      if (!this.streamRoots.size) return;
      for (const row of [...this.byTurn.get(key) ?? []]) {
        if (!row.response.isConnected || !row.root.contains(row.response)) {
          this.remove(row.response);
          if (this.owners.get(row.response) === this) this.owners.delete(row.response);
        }
      }
      for (const root of this.streamRoots) {
        if (!root.isConnected) continue;
        if (root.matches(RESPONSE)) this.bindOwned(root);
        for (const response of root.querySelectorAll(RESPONSE)) this.bindOwned(response);
      }
      this.streamRoots.clear();
    }
    mountFor(key) {
      if (this.mounts.has(key)) return this.mounts.get(key);
      const rows = [...this.byTurn.get(key) ?? []];
      if (rows.length > 1) rows.sort((a, b) => a.response.compareDocumentPosition(b.response) & Node.DOCUMENT_POSITION_FOLLOWING ? 1 : -1);
      let mount = null;
      for (const row of rows) {
        const { root, response } = row;
        if (!response.isConnected || !visible(response)) continue;
        if (this.viewport && !this.nearby.has(response)) break;
        row.actions ??= [...response.querySelectorAll(ACTION)];
        let actions = lastVisible(row.actions);
        if (!actions) {
          row.siblings ??= [...root.querySelectorAll(ACTION)].filter((node) => !node.closest(RESPONSE) && response.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING);
          actions = lastVisible(row.siblings);
        }
        const parent = actions ?? response;
        mount = { response, parent, inline: Boolean(actions), stillCurrent: () => this.mounts.get(key) === mount && root.contains(response) && root.contains(parent) && visible(response) && (!actions || visible(actions)) };
        break;
      }
      this.mounts.set(key, mount);
      return mount;
    }
    restore() {
      if (this.viewport) {
        for (const response of this.nearby) {
          const key = this.nodes.get(response)?.key;
          if (key != null) this.dirty.add(key);
        }
        return;
      }
      for (const key of this.byTurn.keys()) this.dirty.add(key);
      for (const key of this.groups.keys()) this.dirty.add(key);
    }
    changeFor(key) {
      const turn = this.turns.get(key);
      return { key, turn, mount: turn?.completed && this.nearTurn(key) ? this.mountFor(key) : null };
    }
    *pendingChanges() {
      for (const key of this.dirty) {
        this.dirty.delete(key);
        yield this.changeFor(key);
      }
    }
    *changes() {
      if (!this.indexed) {
        this.initialRows ??= Array.from(document.querySelectorAll(`[data-response-annotation-conversation="${this.id}" i]`));
        let registered = 0;
        while (this.initialRows.length) {
          const response = this.initialRows.pop();
          if (!this.nodes.has(response) && response.isConnected && import_protocol2.default.normalizeThreadId(response.dataset.responseAnnotationConversation) === this.id) {
            this.bind(response, true);
            this.owners.set(response, this);
          }
          if (this.viewport) {
            if (++registered === 32) {
              registered = 0;
              yield* this.pendingChanges();
              yield;
            }
          } else {
            const key = this.nodes.get(response)?.key;
            yield this.dirty.delete(key) ? this.changeFor(key) : null;
          }
        }
        this.initialRows = null;
        this.indexed = true;
      }
      yield* this.pendingChanges();
    }
  };
  var ReplyCache = class {
    constructor(onVisible = () => {
    }) {
      this.threads = /* @__PURE__ */ new Map();
      this.owners = /* @__PURE__ */ new WeakMap();
      this.onVisible = onVisible;
    }
    select(id, snapshot) {
      const thread = this.threads.get(id) ?? new ConversationReplies(id, this.owners, this.onVisible);
      this.threads.delete(id);
      this.threads.set(id, thread);
      if (this.threads.size > 6) this.drop(this.threads.values().next().value);
      thread.setSnapshot(snapshot);
      return thread;
    }
    drop(thread) {
      thread.viewport?.disconnect();
      for (const node of thread.nodes.keys()) this.owners.delete(node);
      for (const group of thread.groups.values()) group.dispose();
      this.threads.delete(thread.id);
    }
    visibility(scope) {
      if (!scope.firstElementChild && !scope.matches(RESPONSE + "," + ACTION)) return;
      for (const thread of this.threads.values()) {
        const responses = thread.viewport ? thread.nearby : thread.nodes.keys();
        for (const response of responses) {
          const row = thread.nodes.get(response);
          if (scope.contains(row.response) || row.root?.contains(scope) && (row.actions?.some((node) => scope.contains(node)) || row.siblings?.some((node) => scope.contains(node)))) {
            thread.invalidate(row.key);
          }
        }
      }
    }
    relevantDuringStream(record, active) {
      const target = record.target;
      if (target.nodeType !== 1) return false;
      const children = record.type === "childList";
      if (children && !hasElement(record.addedNodes) && !hasElement(record.removedNodes)) return false;
      if (target.closest(OWN)) return false;
      if (!children && !["aria-hidden", "hidden", "inert"].includes(record.attributeName)) return true;
      const response = target.closest(RESPONSE);
      const thread = response ? this.owners.get(response) ?? this.threads.get(import_protocol2.default.normalizeThreadId(response.dataset.responseAnnotationConversation)) : active;
      if (thread?.deferStreamMutation(target, response)) return false;
      if (children && response && thread?.nodes.get(response)?.key == null) {
        const body = target.closest(STREAMING_MARKDOWN);
        if (body && (target === body || target.matches(FORMATTING)) && onlyFormatting(record.addedNodes) && onlyFormatting(record.removedNodes)) {
          thread?.pendingMarkdown.add(response);
          return false;
        }
      }
      return true;
    }
    observe(records, active, dom) {
      const changed = /* @__PURE__ */ new Set();
      const actionScopes = /* @__PURE__ */ new Set();
      const visibilityScopes = /* @__PURE__ */ new Set();
      const subtrees = /* @__PURE__ */ new Map();
      const markersIn = (root) => {
        if (!subtrees.has(root)) subtrees.set(root, root.querySelectorAll(MARKERS));
        return subtrees.get(root);
      };
      const collectReplyAndShell = (node) => {
        if (node.matches(RESPONSE) || this.owners.has(node)) changed.add(node);
        if (node.matches(SHELL)) dom.invalidateShell();
      };
      const collect = (node, target) => {
        collectReplyAndShell(node);
        if (node.matches(ACTION)) {
          const scope = node.closest(RESPONSE) ?? target.closest(RESPONSE) ?? node.closest(TURN) ?? target.closest(TURN);
          if (scope) actionScopes.add(scope);
        }
      };
      for (const record of records) {
        const target = record.target;
        if (target.nodeType !== 1 || target.closest(OWN)) continue;
        if (record.type === "attributes") {
          switch (record.attributeName) {
            case "data-response-annotation-conversation":
              changed.add(target);
              break;
            case "data-content-search-turn-key":
              if (target.matches(RESPONSE)) changed.add(target);
              for (const node of target.querySelectorAll(RESPONSE)) changed.add(node);
              break;
            case "data-thread-find-composer":
            case "data-app-navigation-rail":
              dom.invalidateShell();
              break;
            case "hidden":
            case "aria-hidden":
            case "inert":
              visibilityScopes.add(target);
              break;
          }
          continue;
        }
        for (const nodes of [record.addedNodes, record.removedNodes]) {
          if (nodes === record.addedNodes && isCompleteTurnList(nodes, target)) {
            for (const node of nodes) if (this.owners.has(node)) changed.add(node);
            for (const node of markersIn(target)) collectReplyAndShell(node);
            continue;
          }
          for (const node of nodes) {
            if (node.nodeType !== 1) continue;
            if (node.matches(OWN)) {
              const key = node.dataset.cuTurn;
              if (!node.isConnected && active?.groups.get(key)?.node === node) active.invalidate(key);
              continue;
            }
            collect(node, target);
            if (node.firstElementChild) for (const child of markersIn(node)) collect(child, target);
          }
        }
      }
      for (const scope of actionScopes) {
        if (scope.matches(RESPONSE)) changed.add(scope);
        else for (const response of scope.querySelectorAll(RESPONSE)) changed.add(response);
      }
      for (const response of changed) {
        dom.responseChanged(response);
        const old = this.owners.get(response);
        const id = import_protocol2.default.normalizeThreadId(response.dataset.responseAnnotationConversation);
        const next = response.isConnected ? this.threads.get(id) : null;
        if (old && old !== next) {
          old.remove(response);
          this.owners.delete(response);
        }
        if (next) {
          next.bind(response);
          this.owners.set(response, next);
        }
      }
      if (visibilityScopes.size) dom.fallbackThread = null;
      for (const scope of visibilityScopes) this.visibility(scope);
    }
    dispose() {
      for (const thread of this.threads.values()) this.drop(thread);
    }
  };

  // src/ui/controller.mjs
  var import_protocol3 = __toESM(require_protocol(), 1);
  var ConversationController = class {
    constructor(read, onChange) {
      this.read = read;
      this.onChange = onChange;
      this.threadId = null;
      this.snapshot = null;
      this.revision = 0;
      this.inflight = /* @__PURE__ */ new Map();
      this.history = /* @__PURE__ */ new Map();
      this.pending = false;
      this.disposed = false;
    }
    select(value) {
      if (this.disposed) return false;
      const id = import_protocol3.default.normalizeThreadId(value);
      if (id === this.threadId) return false;
      this.threadId = id;
      this.snapshot = this.history.get(id) ?? null;
      this.revision++;
      this.onChange(true);
      return true;
    }
    async refresh() {
      if (this.disposed || !this.threadId) return;
      if (this.inflight.has(this.threadId) || this.inflight.size >= 2) {
        this.pending = true;
        return;
      }
      const id = this.threadId;
      const revision = this.revision;
      const knownRevision = this.snapshot?.revision;
      const task = Promise.resolve().then(() => this.read(id, knownRevision));
      this.inflight.set(id, task);
      try {
        const next = await task;
        if (!this.disposed && revision === this.revision && next?.threadId === id) {
          if (this.snapshot && typeof next.eventDriven === "boolean") this.snapshot.eventDriven = next.eventDriven;
          if (next.unchanged && next.liveTick && this.snapshot) {
            const turn = this.snapshot.turns?.find((item) => item.id === next.liveTick.id);
            if (turn && !turn.completed) {
              turn.durationMs = next.liveTick.durationMs;
              turn.averageTps = next.liveTick.averageTps;
              this.onChange(false, true);
            }
          } else if (!next.unchanged) {
            const sameRevision = next.revision && next.revision === this.snapshot?.revision;
            const live = next.turns?.some((turn) => !turn.completed);
            this.snapshot = next;
            this.history.delete(id);
            this.history.set(id, next);
            while (this.history.size > 6) this.history.delete(this.history.keys().next().value);
            if (!sameRevision || live) this.onChange(false);
          }
        }
      } catch (error) {
        if (!this.disposed) console.warn("[CodexUsageUI]", String(error));
      } finally {
        this.inflight.delete(id);
        if (this.pending && !this.disposed) {
          this.pending = false;
          void this.refresh();
        }
      }
    }
    dispose() {
      this.disposed = true;
      this.revision++;
      this.pending = false;
      this.snapshot = null;
      this.history.clear();
    }
  };

  // src/ui/quota-controller.mjs
  var import_protocol4 = __toESM(require_protocol(), 1);
  var import_quota_model = __toESM(require_quota_model(), 1);
  var { normalizeLimits } = import_quota_model.default;
  var QuotaController = class {
    constructor(ipc, onChange, now = Date.now) {
      this.ipc = ipc;
      this.onChange = onChange;
      this.now = now;
      this.native = null;
      this.fallback = null;
      this.accountChanged = false;
      this.lastPoll = -Infinity;
      this.inflight = false;
      this.disposed = false;
      this.listener = (_event, message) => this.receive(message);
      ipc.on(import_protocol4.default.NATIVE_FROM_VIEW, this.listener);
    }
    get limits() {
      return this.native ?? this.fallback;
    }
    useFallback(value) {
      if (this.disposed || this.accountChanged || !value) return;
      if (!this.fallback || (value.observedAt ?? 0) >= (this.fallback.observedAt ?? 0)) this.fallback = value;
    }
    receive(message) {
      if (this.disposed || message?.hostId !== "local") return;
      if (message.type === "mcp-notification" && message.method === "account/updated") {
        this.native = null;
        this.fallback = null;
        this.accountChanged = true;
        this.onChange();
        return;
      }
      let raw;
      if (message.type === "mcp-notification" && message.method === "account/rateLimits/updated") raw = message.params;
      else if (message.type === "mcp-response" && !message.message?.error) {
        const result = message.message?.result;
        if (result?.rateLimits || result?.rateLimitsByLimitId || result?.rate_limits || result?.rate_limits_by_limit_id) raw = result;
      }
      const limits = normalizeLimits(raw, this.now());
      if (!limits) return;
      const changed = JSON.stringify(this.native?.groups) !== JSON.stringify(limits.groups);
      this.native = limits;
      if (changed) this.onChange();
    }
    async refresh(force = false) {
      if (this.native?.groups.some((group) => group.windows.some((w) => w.resetsAt == null || w.resetsAt > this.now()))) return;
      if (this.disposed || this.inflight || !force && this.now() - this.lastPoll < 3e4) return;
      this.lastPoll = this.now();
      this.inflight = true;
      try {
        const snapshot = await this.ipc.invoke(import_protocol4.default.READ_CHANNEL, { threadId: null, quotaOnly: true });
        if (this.disposed) return;
        const before = JSON.stringify(this.limits?.groups);
        this.useFallback(snapshot?.limits);
        if (before !== JSON.stringify(this.limits?.groups)) this.onChange();
      } catch (error) {
        if (!this.disposed) console.warn("[CodexUsageUI]", String(error));
      } finally {
        this.inflight = false;
      }
    }
    dispose() {
      if (this.disposed) return;
      this.disposed = true;
      this.ipc.removeListener(import_protocol4.default.NATIVE_FROM_VIEW, this.listener);
      this.native = null;
      this.fallback = null;
    }
  };

  // src/ui/elements.mjs
  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }
  function setText(node, text) {
    if (node.textContent !== text) node.textContent = text;
  }
  var icons = {
    speed: '<path d="M3 12a8 8 0 1 1 14 0M10 10l4-4"/><circle cx="10" cy="10" r="1"/>',
    token: '<ellipse cx="10" cy="4" rx="6" ry="2.5"/><path d="M4 4v10c0 3 12 3 12 0V4M4 8c0 3 12 3 12 0M4 12c0 3 12 3 12 0"/>',
    context: '<circle cx="10" cy="10" r="7" opacity=".35"/><path d="M10 3a7 7 0 0 1 7 7"/>'
  };
  function iconSvg(icon) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 20 20");
    svg.setAttribute("aria-hidden", "true");
    svg.innerHTML = icons[icon];
    return svg;
  }

  // src/ui/motion.mjs
  var ease = "cubic-bezier(.2,.8,.2,1)";
  function numericParts(text) {
    return text.split(/(\d+(?:,\d{3})*(?:\.\d+)?)/g);
  }
  function numericTransition(previous, next) {
    const before = numericParts(previous), after = numericParts(next);
    if (before.length !== after.length || before.some((part, index) => index % 2 === 0 && part !== after[index])) return [];
    return after.flatMap((target, index) => {
      if (index % 2 === 0 || target === before[index] || target.length !== before[index].length) return [];
      const from = Number(before[index].replaceAll(",", "")), to = Number(target.replaceAll(",", ""));
      const precision = target.split(".")[1]?.length ?? 0;
      const oldPrecision = before[index].split(".")[1]?.length ?? 0;
      if (!Number.isFinite(from) || !Number.isFinite(to) || precision !== oldPrecision || target.includes(",") !== before[index].includes(",")) return [];
      const formatter = new Intl.NumberFormat("en-US", {
        useGrouping: target.includes(","),
        minimumFractionDigits: precision,
        maximumFractionDigits: precision
      });
      return [{ index, from, to, target, format: formatter.format }];
    });
  }
  var MetricMotion = class {
    constructor(node) {
      this.node = node;
      this.animations = /* @__PURE__ */ new Map();
      this.numbers = /* @__PURE__ */ new Map();
      this.frame = null;
      this.reduced = matchMedia("(prefers-reduced-motion: reduce)");
      this.onPreference = () => this.cancel();
      this.reduced.addEventListener("change", this.onPreference);
    }
    play(node, frames, duration = 220) {
      this.animations.get(node)?.cancel();
      if (this.reduced.matches || !node.isConnected) return;
      const animation = node.animate(frames, { duration, easing: ease });
      this.animations.set(node, animation);
      const done = () => {
        if (this.animations.get(node) === animation) this.animations.delete(node);
      };
      animation.addEventListener("finish", done, { once: true });
      animation.addEventListener("cancel", done, { once: true });
    }
    capture() {
      const origin = this.node.getBoundingClientRect();
      return new Map([...this.node.children].map((node) => {
        const rect = node.getBoundingClientRect();
        return [node, { x: rect.x - origin.x, y: rect.y - origin.y }];
      }));
    }
    enter() {
      this.play(this.node, [{ opacity: 0, transform: "translateY(4px)" }, { opacity: 1, transform: "none" }]);
    }
    text(label, text) {
      if (label.dataset.cuText === text) return false;
      const previous = label.textContent, initialized = label.dataset.cuText !== void 0;
      this.finishNumbers(label, false);
      label.dataset.cuText = text;
      const parts = numericParts(text);
      let nodes = [...label.childNodes];
      const reusable = nodes.length === parts.length && nodes.every((node, index) => index % 2 === 0 ? node.nodeType === 3 && node.data === parts[index] : node.className === "cu-number" && node.childNodes.length === 1 && node.firstChild.nodeType === 3);
      if (!reusable) {
        nodes = parts.map((part, index) => {
          if (index % 2 === 0) return document.createTextNode(part);
          const node = document.createElement("span");
          node.className = "cu-number";
          node.textContent = part;
          return node;
        });
        label.replaceChildren(...nodes);
      }
      const transitions = initialized && !this.reduced.matches ? numericTransition(previous, text) : [];
      if (transitions.length) {
        const values = transitions.map((transition) => {
          const node = nodes[transition.index];
          node.dataset.cuTween = "";
          return { ...transition, node, digits: node.firstChild };
        });
        this.numbers.set(label, { values, started: null });
        this.schedule();
      }
      if (reusable) for (let i = 1; i < parts.length; i += 2) {
        const number = nodes[i];
        if (number.dataset.cuTween === void 0 && number.firstChild.data !== parts[i]) number.firstChild.data = parts[i];
      }
      return previous !== text;
    }
    schedule() {
      if (this.frame !== null || !this.numbers.size) return;
      this.frame = requestAnimationFrame((now) => {
        this.frame = null;
        for (const [label, job] of this.numbers) {
          job.started ??= now;
          const progress = Math.min(1, Math.max(0, (now - job.started) / 220));
          const amount = 1 - Math.pow(1 - progress, 3);
          for (const value of job.values) {
            const text = value.format(value.from + (value.to - value.from) * amount);
            if (value.digits.data !== text) value.digits.data = text;
          }
          if (progress === 1 || !label.isConnected) this.finishNumbers(label);
        }
        this.schedule();
      });
    }
    finishNumbers(label, settle = true) {
      const job = this.numbers.get(label);
      if (!job) return;
      for (const value of job.values) {
        if (settle && value.digits.data !== value.target) value.digits.data = value.target;
        delete value.node.dataset.cuTween;
      }
      this.numbers.delete(label);
    }
    update(previous) {
      for (const [node, animation] of this.animations) if (node !== this.node) {
        animation.cancel();
        this.animations.delete(node);
      }
      const positions = this.capture();
      for (const [button, position] of positions) {
        const old = previous.get(button);
        if (!old) {
          this.play(button, [{ opacity: 0, transform: "translateY(3px)" }, { opacity: 1, transform: "none" }]);
          continue;
        }
        const x = old.x - position.x, y = old.y - position.y;
        if (Math.abs(x) > 0.5 || Math.abs(y) > 0.5) {
          this.play(button, [{ transform: `translate(${x}px,${y}px)` }, { transform: "none" }]);
        }
      }
    }
    cancel() {
      for (const animation of this.animations.values()) animation.cancel();
      this.animations.clear();
      cancelAnimationFrame(this.frame);
      this.frame = null;
      for (const label of this.numbers.keys()) this.finishNumbers(label);
    }
    dispose() {
      this.cancel();
      this.reduced.removeEventListener("change", this.onPreference);
    }
  };

  // src/ui/metrics.mjs
  var textMeasure = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  var glyphs = /* @__PURE__ */ new Map();
  var pendingAlignment = /* @__PURE__ */ new Set();
  var measuredParents = /* @__PURE__ */ new WeakMap();
  var alignmentQueued = false;
  function metric(icon, text, kind, turnId2, onActivate) {
    const el = element("button", "cu-metric");
    el.type = "button";
    el.dataset.cuKind = kind;
    el.dataset.cuTurn = turnId2 ?? "";
    el.setAttribute("aria-haspopup", "dialog");
    el.setAttribute("aria-expanded", "false");
    el.setAttribute("aria-controls", "cu-metric-popover");
    el.addEventListener("click", () => onActivate(el));
    if (icon) el.append(iconSvg(icon));
    el.append(element("span", "cu-metric-label", text));
    return el;
  }
  function alignMetrics(container) {
    if (!container || !textMeasure) return;
    pendingAlignment.add(container);
    if (alignmentQueued) return;
    alignmentQueued = true;
    queueMicrotask(flushAlignment);
  }
  function invalidateMetricLayout() {
    measuredParents = /* @__PURE__ */ new WeakMap();
  }
  function flushAlignment() {
    alignmentQueued = false;
    const containers = [...pendingAlignment].filter((node) => node.isConnected);
    const labels = containers.flatMap((node) => [...node.querySelectorAll(".cu-metric-label")]);
    pendingAlignment.clear();
    const rows = labels.map((label) => {
      const row = label.parentElement, svg = row.querySelector("svg");
      label.style.removeProperty("transform");
      svg?.style.removeProperty("transform");
      const marker = element("span");
      marker.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline;margin:0;padding:0;border:0";
      label.append(marker);
      return { label, row, svg, marker };
    });
    const offsets = rows.map(({ label, row, svg, marker }) => {
      const bounds = row.getBoundingClientRect(), target = bounds.top + bounds.height / 2;
      const style = getComputedStyle(label);
      const scale = label.getBoundingClientRect().height / (parseFloat(style.height) || 20);
      if (!scale) return { label, svg, marker, shift: 0, iconShift: 0 };
      const text = label.textContent, font = [style.fontStyle, style.fontWeight, style.fontSize, style.fontFamily].join(" ");
      const baseline = marker.getBoundingClientRect().top;
      const dpr = devicePixelRatio || 1, pixelScale = dpr * scale, size = parseFloat(style.fontSize);
      const reference = Math.ceil(size * 2 * pixelScale) + baseline * dpr % 1;
      const key = JSON.stringify([font, text, pixelScale, reference]);
      let glyph = glyphs.get(key);
      if (glyph === void 0) {
        textMeasure.font = font;
        const width = textMeasure.measureText(text).width;
        textMeasure.canvas.width = Math.max(1, Math.ceil((width + 8) * pixelScale));
        textMeasure.canvas.height = Math.ceil((size * 4 + 8) * pixelScale);
        textMeasure.setTransform(pixelScale, 0, 0, pixelScale, 0, 0);
        textMeasure.font = font;
        textMeasure.fillStyle = "#fff";
        textMeasure.fillText(text, 4, reference / pixelScale);
        const pixels = textMeasure.getImageData(0, 0, textMeasure.canvas.width, textMeasure.canvas.height);
        let top = pixels.height, bottom = -1;
        for (let y = 0; y < pixels.height; y++) for (let x = 0; x < pixels.width; x++) if (pixels.data[(y * pixels.width + x) * 4 + 3] > 24) {
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
          break;
        }
        glyph = bottom < 0 ? null : (top + bottom + 1) / 2 - reference;
        glyphs.set(key, glyph);
        while (glyphs.size > 512) glyphs.delete(glyphs.keys().next().value);
      }
      const center = glyph === null ? target : baseline + glyph / dpr;
      const shift = Math.round((target - center) * dpr) / dpr;
      const glyphCenter = center + shift;
      let iconShift = 0;
      if (svg) {
        const box = svg.getBBox(), matrix = svg.getScreenCTM();
        if (matrix) {
          const iconCenter = matrix.b * (box.x + box.width / 2) + matrix.d * (box.y + box.height / 2) + matrix.f;
          iconShift = (glyphCenter - iconCenter) / scale;
        }
      }
      return { label, svg, marker, shift: shift / scale, iconShift };
    });
    for (const { label, svg, marker, shift, iconShift } of offsets) {
      marker.remove();
      label.style.transform = `translateY(${shift}px)`;
      if (svg) svg.style.transform = `translateY(${iconShift}px)`;
    }
    for (const node of containers) measuredParents.set(node, new WeakRef(node.parentElement));
  }
  var MetricGroup = class {
    constructor(node, onActivate, onRemove, animated = false) {
      this.node = node;
      this.onActivate = onActivate;
      this.onRemove = onRemove;
      this.motion = animated ? new MetricMotion(node) : null;
      this.contentKey = null;
    }
    render(items) {
      const contentKey = JSON.stringify(items.map((item) => [item.key, item.icon, item.kind, item.turnId, item.text, item.live === true]));
      if (contentKey === this.contentKey) return;
      this.contentKey = contentKey;
      const old = new Map([...this.node.children].map((node) => [node.dataset.cuKey, node]));
      const numbersOnly = this.motion && this.node.isConnected && measuredParents.get(this.node)?.deref() === this.node.parentElement && this.node.childNodes.length === items.length && items.every((item, index) => {
        const button = old.get(item.key);
        if (!button || button !== this.node.children[index]) return false;
        const text = button.querySelector(".cu-metric-label")?.dataset.cuText;
        return text === item.text || text != null && text.replace(/\d+/g, "0") === item.text.replace(/\d+/g, "0");
      });
      const previous = numbersOnly ? null : this.motion?.capture();
      let changed = false;
      for (const text of [...this.node.childNodes]) if (text.nodeType === 3) {
        text.remove();
        changed = true;
      }
      items.forEach((item, index) => {
        let button = old.get(item.key);
        old.delete(item.key);
        if (!button) {
          button = metric(item.icon, item.text, item.kind, item.turnId, this.onActivate);
          button.dataset.cuKey = item.key;
          changed = true;
        }
        if (button.dataset.cuKind !== item.kind) button.dataset.cuKind = item.kind;
        const turn = item.turnId ?? "";
        if (button.dataset.cuTurn !== turn) button.dataset.cuTurn = turn;
        const label = button.querySelector(".cu-metric-label");
        if (this.motion) changed = this.motion.text(label, item.text) || changed;
        else if (label.textContent !== item.text) {
          setText(label, item.text);
          changed = true;
        }
        const accessibleText = `${item.text}\uFF0C\u70B9\u51FB\u67E5\u770B\u8BE6\u60C5`;
        if (button.getAttribute("aria-label") !== accessibleText) button.setAttribute("aria-label", accessibleText);
        button.toggleAttribute("data-cu-live", item.live === true);
        if (this.node.children[index] !== button) {
          this.node.insertBefore(button, this.node.children[index] ?? null);
          changed = true;
        }
      });
      for (const button of old.values()) {
        this.onRemove(button);
        button.remove();
        changed = true;
      }
      if (changed && !numbersOnly) {
        this.align();
        this.motion?.update(previous);
      }
    }
    message(text) {
      if (this.node.textContent === text) return;
      this.contentKey = null;
      this.onRemove(this.node);
      this.motion?.cancel();
      setText(this.node, text);
      this.motion?.enter();
    }
    mount(parent, before = null) {
      const moved = this.node.parentNode !== parent || this.node.nextSibling !== before;
      if (moved) {
        const entering = !this.node.isConnected || this.node.parentNode !== parent;
        parent.insertBefore(this.node, before);
        if (entering) this.motion?.enter();
      }
      if (this.motion ? moved : measuredParents.get(this.node)?.deref() !== parent) this.align();
    }
    align() {
      alignMetrics(this.node);
    }
    unmount() {
      this.onRemove(this.node);
      this.motion?.cancel();
      this.node.remove();
    }
    dispose() {
      this.unmount();
      this.motion?.dispose();
    }
  };

  // src/ui/details.mjs
  var import_usage_model2 = __toESM(require_usage_model(), 1);

  // src/ui/format.mjs
  var import_usage_model = __toESM(require_usage_model(), 1);
  var fmt = (n) => n == null || !Number.isFinite(n) ? "\u2014" : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : Math.round(n).toLocaleString("en-US");
  var pct = (n) => n == null ? "\u2014" : `${Math.round(n)}%`;
  var elapsed = (ms) => ms == null ? "\u2014" : ms >= 6e4 ? `${(ms / 6e4).toFixed(1)} \u5206\u949F` : `${(ms / 1e3).toFixed(1)} \u79D2`;
  var tokens = (n) => n == null ? "\u6682\u65E0\u6570\u636E" : `${Math.round(n).toLocaleString("en-US")} tok`;
  var completedDate = (turn) => turn?.completedAt ? new Date(turn.completedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) : null;
  var speedLabel = (turn) => turn?.estimatedGenerationTps != null ? `${Math.round(turn.estimatedGenerationTps)} tok/s` : turn?.averageTps != null ? `\u6574\u8F6E ${turn.averageTps.toFixed(1)} tok/s` : "\u901F\u5EA6 \u2014";
  function sessionSpeedReader(turns) {
    const stats = import_usage_model.default.statisticsFor(turns), label = speedLabel(stats), last = turns.at(-1);
    if (!last || last.completed || stats.estimatedGenerationTps != null) return () => label;
    let historyMs = 0, output = last.usage?.output_tokens ?? 0;
    for (let i = 0; i < turns.length - 1; i++) {
      const turn = turns[i];
      if (turn.durationMs == null) return () => label;
      historyMs += turn.durationMs;
      output += turn.usage?.output_tokens ?? 0;
    }
    return () => {
      const duration = last.durationMs == null ? null : historyMs + last.durationMs;
      return speedLabel({ averageTps: duration > 0 && output > 0 ? output * 1e3 / duration : null });
    };
  }
  function countdown(ms) {
    if (ms == null || !Number.isFinite(ms)) return "\u91CD\u7F6E\u65F6\u95F4\u4E0D\u53EF\u7528";
    if (ms <= 0) return "\u7B49\u5F85\u5237\u65B0";
    const m = Math.ceil(ms / 6e4), d = Math.floor(m / 1440), h = Math.floor(m % 1440 / 60);
    return d ? `${d}\u5929 ${h}\u5C0F\u65F6` : h ? `${h}\u5C0F\u65F6 ${m % 60}\u5206` : `${m}\u5206`;
  }

  // src/ui/details.mjs
  var { statisticsFor, usageParts } = import_usage_model2.default;
  function createDetailsPopover(onOpen) {
    let snapshot = null;
    let metricPanel = null, panelAnchor = null, panelCloseTimer = null, tokenModel = null;
    function statRow(label, value) {
      const row = element("div", "cu-stat-row");
      row.append(element("span", "cu-stat-label", label), element("span", "cu-stat-value", value ?? "\u6682\u65E0\u6570\u636E"));
      return row;
    }
    function panelHeader(title, icon, total) {
      const header = element("div", "cu-panel-header"), heading = element("strong", "cu-panel-heading");
      if (icon) heading.append(iconSvg(icon));
      heading.append(element("span", "", title));
      header.append(heading);
      if (total) header.append(element("strong", "cu-panel-total", total));
      return header;
    }
    function usageTrack(parts, percent = null) {
      const track = element("div", `cu-context-track${percent === null ? " cu-token-track" : ""}`), fill = element("div", "cu-context-fill");
      const total = parts.reduce((sum, p) => sum + (p.amount ?? 0), 0);
      if (percent === null) {
        track.role = "img";
        track.setAttribute("aria-label", parts.map((p) => `${p.label} ${tokens(p.amount)}`).join("\uFF0C"));
      } else {
        track.role = "progressbar";
        track.setAttribute("aria-label", "\u4E0A\u4E0B\u6587\u5360\u7528");
        track.setAttribute("aria-valuenow", String(Math.round(percent)));
        track.setAttribute("aria-valuemin", "0");
        track.setAttribute("aria-valuemax", "100");
        track.setAttribute("aria-valuetext", parts.map((p) => `${p.label} ${tokens(p.amount)}`).join("\uFF0C"));
      }
      fill.style.width = `${percent === null ? total > 0 ? 100 : 0 : Math.min(100, Math.max(0, percent))}%`;
      for (const part of parts) {
        const segment = element("span", `cu-context-segment cu-context-${part.key}`);
        segment.dataset.cuCategory = part.key;
        segment.style.width = `${total > 0 ? (part.amount ?? 0) / total * 100 : 0}%`;
        segment.setAttribute("aria-hidden", "true");
        fill.append(segment);
      }
      track.append(fill);
      return track;
    }
    function usageRow(part) {
      const row = statRow(part.label, part.amount == null ? "\u2014" : tokens(part.amount));
      row.dataset.cuCategory = part.key;
      row.classList.add(`cu-context-${part.key}`);
      const dot = element("span", "cu-context-dot");
      dot.setAttribute("aria-hidden", "true");
      row.firstElementChild.prepend(dot);
      return row;
    }
    function selectTokenModel(model) {
      tokenModel = model;
      renderMetricPanel();
      [...metricPanel.querySelectorAll(".cu-model-view")].find((button) => button.getAttribute("aria-pressed") === "true")?.focus({ preventScroll: true });
    }
    function tokenDetails(scope, turn) {
      const models = scope.models ?? [{ model: null, usage: scope.usage ?? scope.total }], key = (model) => model.model ?? "";
      if (tokenModel !== null && !models.some((model) => key(model) === tokenModel)) tokenModel = null;
      const selected = tokenModel === null ? scope : models.find((model) => key(model) === tokenModel), u = selected.usage ?? selected.total;
      const body = element("div", "cu-token-details"), views = element("div", "cu-model-views");
      views.role = "group";
      views.setAttribute("aria-label", "\u6A21\u578B");
      for (const view of [{ key: null, label: "\u603B\u89C8" }, ...models.map((model) => ({ key: key(model), label: model.model ?? "\u672A\u77E5\u6A21\u578B" }))]) {
        const button = element("button", "cu-model-view", view.label);
        button.type = "button";
        button.dataset.cuModel = view.key ?? "*";
        button.setAttribute("aria-pressed", String(tokenModel === view.key));
        button.addEventListener("click", () => selectTokenModel(view.key));
        views.append(button);
      }
      const parts = usageParts(u, true);
      body.append(
        panelHeader(turn ? "\u672C\u8F6E\u7528\u91CF" : "Token \u7528\u91CF", "token", tokens(u?.total_tokens)),
        views,
        usageTrack(parts),
        ...parts.map(usageRow),
        statRow("\u7F13\u5B58\u547D\u4E2D", pct(selected.cacheHitPercent))
      );
      if (tokenModel === null && models.length > 1) {
        const list = element("div", "cu-model-list");
        for (const model of models) {
          const button = element("button", "cu-model-summary");
          button.type = "button";
          button.dataset.cuModel = key(model);
          button.append(element("span", "", model.model ?? "\u672A\u77E5\u6A21\u578B"), element("span", "", tokens(model.usage?.total_tokens)));
          button.addEventListener("click", () => selectTokenModel(key(model)));
          list.append(button);
        }
        body.append(list);
      }
      return body;
    }
    function buildMetricDetails(anchor) {
      const kind = anchor.dataset.cuKind, id = anchor.dataset.cuTurn;
      const turn = id ? snapshot?.turns?.find((turn2) => turn2.id === id) : null, last = snapshot?.turns?.at(-1);
      const nodes = [];
      if (!snapshot?.available) return [element("p", "cu-note", "\u6682\u65E0\u53EF\u7528\u7EDF\u8BA1\u6570\u636E")];
      if (kind === "tokens") {
        nodes.push(tokenDetails(turn ?? snapshot, turn));
      } else if (kind === "context") {
        const usage = snapshot.lastUsage;
        const parts = usageParts(usage);
        nodes.push(panelHeader(`\u4E0A\u4E0B\u6587\u5DF2\u7528 ${pct(snapshot.contextPercent)}`, "context", `${fmt(usage?.total_tokens)} / ${fmt(snapshot.contextWindow)}`));
        if (snapshot.contextPercent != null) nodes.push(usageTrack(parts, snapshot.contextPercent));
        nodes.push(...parts.map(usageRow));
        nodes.push(statRow("\u6A21\u578B\u7A97\u53E3", tokens(snapshot.contextWindow)));
      } else {
        const active = kind === "live" ? last : turn, turns = active ? [active] : snapshot.turns ?? [];
        const statistics = statisticsFor(turns), generated = statistics.generatedMs, duration = statistics.durationMs;
        const firstTokens = turns.map((t) => t.timeToFirstTokenMs).filter((n) => n != null);
        const generation = statistics.estimatedGenerationTps != null;
        nodes.push(
          panelHeader(kind === "live" ? "\u5F53\u524D\u6267\u884C" : turn ? "\u672C\u8F6E\u7EDF\u8BA1" : "\u4F1A\u8BDD\u7EDF\u8BA1", "speed"),
          statRow(active ? "\u72B6\u6001" : "\u5BF9\u8BDD\u8F6E\u6570", active ? active.status : `${snapshot.turnCount} \u8F6E`),
          statRow("\u6A21\u578B\u8BF7\u6C42", `${turns.reduce((n, t) => n + t.requests, 0)} \u6B21`),
          statRow("\u6A21\u578B\u751F\u6210\u533A\u95F4", generated != null ? elapsed(generated) : "\u6682\u65E0\u5B8C\u6574\u8BA1\u65F6"),
          statRow("\u6574\u8F6E\u8017\u65F6", duration != null ? elapsed(duration) : null),
          statRow("\u5DE5\u5177\u8C03\u7528", `${turns.reduce((n, t) => n + t.tools, 0)} \u6B21`),
          statRow(active ? "\u9996 token \u7B49\u5F85\uFF08TTFT\uFF09" : "\u6BCF\u8F6E\u9996 token \u5E73\u5747", firstTokens.length ? elapsed(firstTokens.reduce((a, b) => a + b, 0) / firstTokens.length) : null),
          statRow(kind === "live" ? "\u5F53\u524D\u6574\u8F6E\u5E73\u5747" : generation ? "\u751F\u6210\u901F\u5EA6\uFF08\u4F30\u7B97\uFF09" : "\u6574\u8F6E\u5E73\u5747\u901F\u5EA6", kind === "live" ? `${statistics.averageTps?.toFixed(1) ?? "\u2014"} tok/s` : speedLabel(statistics).replace(/^整轮 /, ""))
        );
      }
      if (completedDate(turn)) nodes.push(statRow(turn?.endInferred ? "\u6700\u540E\u8BB0\u5F55\u65F6\u95F4" : "\u5B8C\u6210\u65F6\u95F4", completedDate(turn)));
      return nodes;
    }
    function renderMetricPanel() {
      if (!metricPanel || metricPanel.hidden || !panelAnchor) return;
      if (!panelAnchor.isConnected) {
        closeMetricPanel();
        return;
      }
      const nodes = buildMetricDetails(panelAnchor), signature = JSON.stringify([panelAnchor.dataset.cuKind, panelAnchor.dataset.cuTurn, tokenModel, ...nodes.map((n) => n.textContent)]);
      if (metricPanel.dataset.content !== signature) {
        const focused = metricPanel.contains(document.activeElement) ? document.activeElement.dataset.cuModel : void 0;
        const previous = metricPanel.querySelector(".cu-token-track"), next = nodes[0]?.querySelector(".cu-token-track");
        if (previous && next) {
          previous.setAttribute("aria-label", next.getAttribute("aria-label"));
          previous.firstElementChild.style.width = next.firstElementChild.style.width;
          const fill = previous.firstElementChild, segments = [...fill.children], keys = /* @__PURE__ */ new Set();
          for (const segment of [...next.firstElementChild.children]) {
            const key = segment.dataset.cuCategory, existing = segments.find((e) => e.dataset.cuCategory === key);
            keys.add(key);
            if (existing) {
              existing.style.width = segment.style.width;
              fill.append(existing);
            } else fill.append(segment);
          }
          for (const segment of segments) if (!keys.has(segment.dataset.cuCategory)) segment.remove();
          next.replaceWith(previous);
        }
        metricPanel.replaceChildren(...nodes);
        metricPanel.dataset.content = signature;
        if (focused !== void 0) [...metricPanel.querySelectorAll(".cu-model-view")].find((button) => button.dataset.cuModel === focused)?.focus({ preventScroll: true });
      }
      positionMetricPanel();
    }
    function toggleMetricPanel(anchor) {
      if (panelAnchor === anchor && metricPanel?.dataset.state === "open") {
        closeMetricPanel();
        return;
      }
      panelAnchor?.setAttribute("aria-expanded", "false");
      panelAnchor = anchor;
      anchor.setAttribute("aria-expanded", "true");
      tokenModel = null;
      clearTimeout(panelCloseTimer);
      if (!metricPanel) {
        metricPanel = element("div", "cu-panel");
        metricPanel.id = "cu-metric-popover";
        metricPanel.role = "dialog";
        metricPanel.tabIndex = -1;
        document.body.append(metricPanel);
      }
      metricPanel.setAttribute("aria-label", anchor.dataset.cuKind === "context" ? "\u4E0A\u4E0B\u6587\u8BE6\u60C5" : anchor.dataset.cuKind === "tokens" ? "Token \u7528\u91CF\u8BE6\u60C5" : "\u901F\u5EA6\u7EDF\u8BA1\u8BE6\u60C5");
      metricPanel.classList.toggle("cu-token-panel", anchor.dataset.cuKind === "tokens");
      metricPanel.dataset.state = "closed";
      metricPanel.hidden = false;
      renderMetricPanel();
      metricPanel.dataset.state = "open";
      onOpen();
    }
    function closeMetricPanel(returnFocus = false) {
      const previous = panelAnchor;
      previous?.setAttribute("aria-expanded", "false");
      panelAnchor = null;
      clearTimeout(panelCloseTimer);
      if (metricPanel) {
        metricPanel.dataset.state = "closed";
        panelCloseTimer = setTimeout(() => {
          if (metricPanel) metricPanel.hidden = true;
        }, 160);
      }
      if (returnFocus && previous?.isConnected) previous.focus({ preventScroll: true });
    }
    function positionMetricPanel() {
      if (!metricPanel || metricPanel.hidden || !panelAnchor?.isConnected) return;
      const a = panelAnchor.getBoundingClientRect(), p = { width: metricPanel.offsetWidth, height: metricPanel.offsetHeight };
      if (a.bottom < 0 || a.top > innerHeight) {
        closeMetricPanel();
        return;
      }
      const above = a.top - p.height - 10, below = a.bottom + 10;
      const top = above >= 12 ? above : below + p.height <= innerHeight - 12 ? below : Math.max(12, Math.min(above, innerHeight - p.height - 12));
      metricPanel.style.left = `${Math.max(12, Math.min(a.left, innerWidth - p.width - 12))}px`;
      metricPanel.style.top = `${top}px`;
      metricPanel.style.transformOrigin = top < a.top ? "bottom left" : "top left";
    }
    return {
      toggle: toggleMetricPanel,
      close: closeMetricPanel,
      position: positionMetricPanel,
      update(value) {
        snapshot = value;
        renderMetricPanel();
      },
      remove(node) {
        if (node === panelAnchor || node.contains(panelAnchor)) closeMetricPanel();
      },
      outside(event) {
        if (panelAnchor && !panelAnchor.contains(event.target) && !metricPanel?.contains(event.target)) closeMetricPanel();
      },
      keydown(event) {
        if (event.key === "Escape" && panelAnchor) {
          event.preventDefault();
          event.stopPropagation();
          closeMetricPanel(true);
        }
      },
      dispose() {
        clearTimeout(panelCloseTimer);
        panelAnchor?.setAttribute("aria-expanded", "false");
        metricPanel?.remove();
        panelAnchor = null;
        metricPanel = null;
        snapshot = null;
      }
    };
  }

  // src/ui/quota.mjs
  var import_quota_model2 = __toESM(require_quota_model(), 1);
  var remainingRadius = 14;
  var timeRadius = 10;
  function createQuotaWidget(onOpen) {
    let snapshot = null, ring = null, ringButton = null, panel = null;
    let closeTimer = null;
    function svgCircle(radius, className) {
      const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      for (const [k, v] of Object.entries({ cx: 16, cy: 16, r: radius, class: className })) c.setAttribute(k, String(v));
      return c;
    }
    function makeRing() {
      ring = element("div", "cu-ring");
      ringButton = element("button");
      ringButton.type = "button";
      ringButton.setAttribute("aria-label", "Codex \u5269\u4F59\u989D\u5EA6\u4E0E\u91CD\u7F6E\u65F6\u95F4");
      ringButton.setAttribute("aria-haspopup", "dialog");
      ringButton.setAttribute("aria-expanded", "false");
      ringButton.setAttribute("aria-controls", "cu-quota-popover");
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 32 32");
      svg.append(
        svgCircle(remainingRadius, "cu-track"),
        svgCircle(remainingRadius, "cu-remaining"),
        svgCircle(timeRadius, "cu-track"),
        svgCircle(timeRadius, "cu-time")
      );
      const symbol = document.createElementNS("http://www.w3.org/2000/svg", "g");
      symbol.setAttribute("transform", "translate(16 16) scale(1.1428571429) translate(-6 -6)");
      symbol.setAttribute("class", "cu-diamond");
      const diamond = document.createElementNS("http://www.w3.org/2000/svg", "path");
      diamond.setAttribute("d", "M5.00978 1.81069C5.55652 1.26395 6.44352 1.26395 6.99025 1.81069L10.1895 5.0099C10.7361 5.55665 10.7362 6.44367 10.1895 6.99037L6.99025 10.1896C6.44355 10.7363 5.55652 10.7362 5.00978 10.1896L1.81056 6.99037C1.26383 6.44364 1.26383 5.55664 1.81056 5.0099L5.00978 1.81069Z");
      symbol.append(diamond);
      svg.append(symbol);
      svg.setAttribute("aria-hidden", "true");
      ringButton.append(svg);
      ring.append(ringButton);
      panel = element("div", "cu-quota-panel");
      panel.id = "cu-quota-popover";
      panel.role = "dialog";
      panel.setAttribute("aria-label", "Codex \u989D\u5EA6");
      panel.hidden = true;
      document.body.append(panel);
      ringButton.addEventListener("click", () => panel.dataset.state === "open" ? hideQuota() : showQuota());
    }
    function showQuota() {
      clearTimeout(closeTimer);
      onOpen();
      panel.dataset.state = "closed";
      panel.hidden = false;
      renderPanel();
      positionPanel();
      panel.getBoundingClientRect();
      panel.dataset.state = "open";
      ringButton.setAttribute("aria-expanded", "true");
    }
    function hideQuota(immediate = false) {
      clearTimeout(closeTimer);
      ringButton?.setAttribute("aria-expanded", "false");
      if (!panel) return;
      panel.dataset.state = "closed";
      if (immediate) panel.hidden = true;
      else closeTimer = setTimeout(() => {
        if (panel) panel.hidden = true;
      }, 160);
    }
    function selectedWindow() {
      return import_quota_model2.default.quotaWindow(snapshot?.limits);
    }
    function positionPanel() {
      if (!panel || panel.hidden || !ring?.isConnected) return;
      const r = ring.getBoundingClientRect(), t = { width: panel.offsetWidth, height: panel.offsetHeight };
      panel.style.left = `${Math.min(innerWidth - t.width - 12, Math.max(12, r.right + 10))}px`;
      panel.style.top = `${Math.max(12, Math.min(r.top, innerHeight - t.height - 12))}px`;
    }
    function renderPanel() {
      if (!panel || panel.hidden) return;
      const nodes = [];
      if (!snapshot?.limits) nodes.push(element("p", "", "\u6682\u65E0\u53EF\u7528\u989D\u5EA6\u6570\u636E"));
      for (const group of snapshot?.limits?.groups ?? []) for (const w of group.windows) {
        const expired = w.resetsAt != null && w.resetsAt <= Date.now();
        const box = element("div", "cu-quota-detail");
        box.append(
          element("strong", "", `${group.name} \xB7 ${w.label}`),
          element("p", "", `\u5269\u4F59 ${pct(expired ? null : w.remainingPercent)} \xB7 \u5DF2\u7528 ${pct(expired ? null : w.usedPercent)}`),
          element("p", "", `\u8DDD\u91CD\u7F6E ${countdown(w.resetsAt == null ? null : w.resetsAt - Date.now())}`),
          element("p", "cu-muted", w.resetsAt == null ? "\u91CD\u7F6E\u65F6\u95F4\u4E0D\u53EF\u7528" : `\u5317\u4EAC\u65F6\u95F4 ${new Date(w.resetsAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}`)
        );
        nodes.push(box);
      }
      const text = nodes.map((n) => n.textContent).join("|");
      if (panel.dataset.content !== text) {
        panel.replaceChildren(...nodes);
        panel.dataset.content = text;
      }
    }
    function render(value, mount) {
      snapshot = value;
      if (!mount) {
        ring?.remove();
        hideQuota(true);
        return;
      }
      if (!ring) makeRing();
      if (!panel.isConnected) document.body.append(panel);
      if (ring.parentNode !== mount.parent || ring.nextSibling !== mount.before) mount.parent.insertBefore(ring, mount.before);
      const w = selectedWindow(), expired = w?.resetsAt != null && w.resetsAt <= Date.now(), remain = expired ? null : w?.remainingPercent;
      const left = w?.resetsAt == null ? null : w.resetsAt - Date.now();
      const ratio = w && left != null ? Math.min(1, Math.max(0, left / (w.windowMinutes * 6e4))) : 0;
      const outer = ring.querySelector(".cu-remaining"), inner = ring.querySelector(".cu-time");
      outer.style.stroke = remain == null ? "var(--color-usage-meter-track,#72757c)" : remain <= 10 ? "var(--color-usage-meter-warning,#d87474)" : remain <= 30 ? "var(--color-usage-meter-warning,#c6a66f)" : "var(--color-usage-meter-fill,#a2a6ad)";
      outer.style.strokeDasharray = `${2 * Math.PI * remainingRadius}`;
      outer.style.strokeDashoffset = `${2 * Math.PI * remainingRadius * (1 - (remain ?? 0) / 100)}`;
      outer.style.opacity = remain > 0 ? "1" : "0";
      inner.style.stroke = "color-mix(in srgb,var(--color-usage-meter-fill,#a2a6ad) 60%,transparent)";
      inner.style.strokeDasharray = `${2 * Math.PI * timeRadius}`;
      inner.style.strokeDashoffset = `${2 * Math.PI * timeRadius * (1 - ratio)}`;
      inner.style.opacity = ratio > 0 ? "1" : "0";
      ringButton.setAttribute("aria-label", expired ? "Codex \u989D\u5EA6\u5F85\u66F4\u65B0" : w ? `${w.label}\u5269\u4F59 ${pct(remain)}\uFF0C\u8DDD\u91CD\u7F6E ${countdown(left)}` : "Codex \u989D\u5EA6\u6682\u4E0D\u53EF\u7528");
      renderPanel();
      positionPanel();
    }
    return {
      render,
      hide: hideQuota,
      position: positionPanel,
      outside(event) {
        if (panel?.dataset.state === "open" && !ring?.contains(event.target) && !panel.contains(event.target)) hideQuota();
      },
      keydown(event) {
        if (event.key === "Escape" && panel?.dataset.state === "open") {
          event.preventDefault();
          hideQuota();
          ringButton?.focus({ preventScroll: true });
        }
      },
      dispose() {
        clearTimeout(closeTimer);
        ring?.remove();
        panel?.remove();
        snapshot = null;
        ring = null;
        ringButton = null;
        panel = null;
      }
    };
  }

  // src/ui/app.mjs
  var import_protocol5 = __toESM(require_protocol(), 1);

  // src/ui/styles.css
  var styles_default = '.cu-strip,.cu-turn{font-family:var(--font-sans,var(--font-sans-default,"Segoe UI",sans-serif));font-size:var(--text-sm,12px);font-weight:400;line-height:20px;color:var(--color-text-secondary,var(--app-color-text-secondary,#979b9f));font-variant-numeric:tabular-nums;user-select:none}\n.cu-footer:has(.cu-strip){padding-bottom:0!important}\n.cu-footer:has(.cu-strip)[class~="after:h-(--thread-composer-bottom-inset)"]::after{height:0!important}\n.cu-strip{display:flex;align-items:center;align-content:center;justify-content:center;gap:0 8px;flex-wrap:wrap;min-height:var(--cu-strip-height,30px);padding:0 6px;margin:0;flex-shrink:0}\n.cu-strip>.cu-metric,.cu-turn>.cu-metric{display:flex;align-items:center;gap:5px;box-sizing:border-box;height:calc(var(--spacing,4px)*6);margin:0;padding:0 6px;white-space:nowrap;font:inherit;line-height:20px;border:0;border-radius:var(--radius-md,6px);color:inherit;background:transparent;cursor:pointer;outline-offset:2px;transition:background-color .15s var(--ease-out,ease-out),color .15s var(--ease-out,ease-out)}\n.cu-metric:hover,.cu-metric[aria-expanded=true]{background:var(--color-background-primary-ghost-hover,#ffffff12);color:var(--color-text,var(--app-color-text-foreground,#e3e5e8))}.cu-metric:focus-visible{outline:2px solid var(--color-ring,#79acfe)}\n.cu-metric>.cu-metric-label{display:block;margin:0;padding:0;border:0;font:inherit;font-weight:400;line-height:20px;letter-spacing:normal}\n.cu-strip svg,.cu-turn svg,.cu-panel svg{display:block;width:14px;height:14px;overflow:visible;stroke:currentColor;fill:none;stroke-width:1.5;flex-shrink:0}\n.cu-turn{display:flex;flex-wrap:wrap;align-items:center;gap:2px;padding:5px 0 12px;min-width:0;clear:both}\n.cu-turn-inline{padding:0;margin-inline-start:6px;clear:none}.cu-action-row{column-gap:2px}\n.cu-action-row>.opacity-0{opacity:1!important}\n.turn-action-controls [class~="opacity-(--actions-opacity)"],.cu-action-row[class~="opacity-(--actions-opacity)"]{--actions-opacity:1!important}\n.cu-turn>span{white-space:nowrap}.cu-turn [data-cu-usage]{display:inline-flex;align-items:center;gap:4px}\n[data-app-navigation-rail]:has(.cu-ring) button:has([data-transition-phase]){display:none!important}\n.cu-ring{width:36px;height:36px;min-height:36px;flex-shrink:0;display:flex;align-items:center;justify-content:center;align-self:center;margin:0;position:relative;color:var(--color-text-secondary,var(--app-color-text-secondary,#a5abb3))}\n.cu-ring button{box-sizing:border-box;border:0;margin:0;padding:2px;width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;background:transparent;color:inherit;outline-offset:2px;transition:background-color .15s var(--ease-out,ease-out)}\n.cu-ring button:hover,.cu-ring button:focus-visible,.cu-ring button[aria-expanded=true]{background:var(--color-background-primary-ghost-hover,#ffffff12)}\n.cu-ring svg{display:block;width:28px;height:28px;overflow:visible;flex:none}.cu-ring .cu-diamond{fill:var(--color-usage-meter-symbol,currentColor)}.cu-ring circle{fill:none;stroke-width:2;transform:rotate(-90deg);transform-origin:center;stroke-linecap:round;transition:stroke-dashoffset .35s var(--ease-out,ease-out),stroke .2s}\n.cu-ring .cu-track{stroke:var(--color-usage-meter-track,color-mix(in srgb,currentColor 20%,transparent))}\n.cu-quota-panel,.cu-panel{position:fixed;z-index:2147483647;box-sizing:border-box;min-width:min(280px,calc(100vw - 24px));max-width:min(380px,calc(100vw - 24px));max-height:calc(100vh - 24px);overflow:auto;padding:16px;border-radius:var(--radius-2xl,16px);background:color-mix(in srgb,var(--color-surface-elevated-secondary,#262626) 90%,transparent);color:var(--color-text,var(--app-color-text-foreground,#e3e5e8));box-shadow:0 0 0 var(--dropdown-overlay-ring-width,.5px) var(--color-border-overlay,#ffffff26),var(--shadow-dropdown-overlay,0 8px 32px #0005);backdrop-filter:blur(var(--blur-sm,8px));border:0;font:400 var(--text-base,14px)/20px var(--font-sans,var(--font-sans-default,"Segoe UI",sans-serif));font-variant-numeric:tabular-nums;user-select:text;opacity:0;transform:translateY(4px) scale(.98);transform-origin:bottom center;transition:opacity .16s var(--ease-out,ease-out),transform .16s var(--ease-out,ease-out)}\n.cu-quota-panel{transform:none;transition-property:opacity}\n.cu-quota-panel[data-state=open],.cu-panel[data-state=open]{opacity:1;transform:none}.cu-quota-panel[hidden],.cu-panel[hidden]{display:none}.cu-quota-panel[data-state=closed],.cu-panel[data-state=closed]{pointer-events:none}\n.cu-quota-panel strong,.cu-panel strong{font:inherit;font-weight:600}.cu-quota-panel p{margin:8px 0 0}.cu-muted,.cu-note{color:var(--color-text-secondary,#999)}.cu-quota-panel .cu-muted,.cu-note{font-size:var(--text-sm,12px)}.cu-quota-panel .cu-quota-detail+.cu-quota-detail{border-top:1px solid var(--color-border-overlay,#ffffff26);margin-top:12px;padding-top:12px}\n.cu-panel-header{display:flex;align-items:center;justify-content:space-between;gap:20px;padding-bottom:12px;margin-bottom:10px;border-bottom:1px solid var(--color-border-overlay,#ffffff26)}.cu-panel-heading{display:flex;align-items:center;gap:8px}.cu-panel-total{white-space:nowrap}.cu-stat-row{display:flex;align-items:baseline;justify-content:space-between;gap:24px;padding:4px 0}.cu-stat-label{color:var(--color-text-secondary,#999)}.cu-stat-value{text-align:right;overflow-wrap:anywhere}.cu-note{margin:10px 0 0;line-height:18px}.cu-context-track{height:5px;border-radius:99px;background:var(--color-background-primary-ghost-hover,#ffffff12);overflow:hidden;margin:4px 0 12px}.cu-context-fill{display:flex;height:100%;border-radius:inherit;overflow:hidden;transition:width .25s var(--ease-out,ease-out)}\n.cu-context-segment{display:block;flex:0 0 auto;height:100%;background:var(--cu-context-color);transition:width .25s var(--ease-out,ease-out)}.cu-context-uncached{--cu-context-color:var(--purple-400,#a78bfa)}.cu-context-cached{--cu-context-color:var(--blue-400,#60a5fa)}.cu-context-output{--cu-context-color:var(--green-400,#4ade80)}.cu-context-unknown{--cu-context-color:var(--color-text-tertiary,#878b93)}.cu-stat-row[data-cu-category]>.cu-stat-label{display:inline-flex;align-items:center;gap:8px}.cu-context-dot{display:inline-block;flex-shrink:0;width:8px;height:8px;border-radius:2px;background:var(--cu-context-color)}\n.cu-token-panel{font-size:var(--text-sm,12px);padding:14px}.cu-token-panel .cu-panel-header{gap:16px;padding-bottom:10px;margin-bottom:8px}.cu-model-views{display:flex;gap:4px;overflow-x:auto;max-width:100%;padding:0 0 8px;scrollbar-width:thin}.cu-model-view,.cu-model-summary{border:0;border-radius:var(--radius-md,6px);background:transparent;color:var(--color-text-secondary,#999);font:inherit;line-height:20px;cursor:pointer;transition:background-color .15s var(--ease-out,ease-out),color .15s var(--ease-out,ease-out)}.cu-model-view{flex:0 0 auto;padding:2px 7px;white-space:nowrap}.cu-model-view:hover,.cu-model-summary:hover,.cu-model-view[aria-pressed=true]{background:var(--color-background-primary-ghost-hover,#ffffff12);color:var(--color-text,var(--app-color-text-foreground,#e3e5e8))}.cu-model-view:focus-visible,.cu-model-summary:focus-visible{outline:2px solid var(--color-ring,#79acfe);outline-offset:-2px}.cu-model-list{border-top:1px solid var(--color-border-overlay,#ffffff26);margin-top:8px;padding-top:6px}.cu-model-summary{display:flex;align-items:center;justify-content:space-between;gap:16px;width:100%;padding:4px 6px;text-align:left}.cu-model-summary>span:first-child{min-width:0;overflow-wrap:anywhere}.cu-model-summary>span:last-child{white-space:nowrap;color:var(--color-text,var(--app-color-text-foreground,#e3e5e8))}\n@media(max-width:620px){.cu-strip{gap:2px 4px}.cu-turn{gap:2px}}\n@media(prefers-reduced-motion:reduce){.cu-metric,.cu-ring button,.cu-ring circle,.cu-quota-panel,.cu-panel,.cu-context-fill,.cu-context-segment,.cu-model-view,.cu-model-summary{transition:none}}\n';

  // src/ui/app.mjs
  var UsagePlugin = class {
    constructor(ipc) {
      this.life = new Lifetime();
      this.dom = new CodexDOM();
      this.replies = /* @__PURE__ */ new Map();
      this.replyCache = new ReplyCache((thread) => {
        if (this.replyThread === thread && document.visibilityState !== "hidden")
          this.replyScan.request(() => this.renderReplies(thread), true);
      });
      this.sessionSpeeds = /* @__PURE__ */ new WeakMap();
      this.replyScan = new BackgroundScan();
      this.readTimer = null;
      this.renderTimer = null;
      this.lastSync = 0;
      this.details = createDetailsPopover(() => this.quota.hide());
      this.quota = createQuotaWidget(() => {
        this.details.close();
        void this.quotaState.refresh(true);
      });
      this.quotaState = new QuotaController(ipc, () => this.renderQuota());
      const changed = (_event, message) => {
        if (message?.threadId !== this.controller.threadId) return;
        if (this.controller.snapshot) this.controller.snapshot.eventDriven = message.watching !== false;
        if (document.visibilityState !== "hidden") this.refreshData();
      };
      ipc.on(import_protocol5.default.CHANGE_CHANNEL, changed);
      this.life.own(() => ipc.removeListener(import_protocol5.default.CHANGE_CHANNEL, changed));
      this.controller = new ConversationController(
        (id, knownRevision) => ipc.invoke(import_protocol5.default.READ_CHANNEL, { threadId: id, knownRevision }),
        (changed2, liveOnly) => {
          if (changed2) {
            this.details.close();
            return;
          }
          if (liveOnly) this.renderLive();
          else this.renderUsage();
        }
      );
      const strip = element("div", "cu-strip");
      strip.setAttribute("aria-label", "\u5F53\u524D\u5BF9\u8BDD\u7528\u91CF\u7EDF\u8BA1");
      strip.setAttribute("data-markdown-copy", "exclude");
      this.strip = this.group(strip, true);
      this.style = element("style");
      this.style.id = "codex-usage-ui-style";
      this.style.textContent = styles_default;
    }
    group(node, animated = false) {
      return new MetricGroup(node, (button) => this.details.toggle(button), (node2) => this.details.remove(node2), animated);
    }
    refreshData(immediate = false) {
      if (this.life.disposed || document.visibilityState === "hidden" || !this.controller.threadId) return;
      if (immediate) {
        clearTimeout(this.readTimer);
        this.readTimer = null;
      }
      if (this.readTimer !== null) return;
      const delay = immediate ? 0 : Math.max(0, 5e3 - (Date.now() - this.lastSync));
      this.readTimer = setTimeout(() => {
        this.readTimer = null;
        if (this.life.disposed || document.visibilityState === "hidden") return;
        this.lastSync = Date.now();
        void this.controller.refresh();
      }, delay);
    }
    synchronize(context = this.dom.context(), immediate = false) {
      if (this.life.disposed) return;
      const switched = this.controller.select(context.id);
      if (switched) {
        this.replyScan.cancel();
        clearTimeout(this.readTimer);
        this.readTimer = null;
        this.leaveReplies();
      }
      this.render(context);
      if (document.visibilityState === "hidden") return;
      this.refreshData(switched || immediate);
      void this.quotaState.refresh();
    }
    renderStrip(snapshot, id) {
      if (!snapshot?.available) {
        this.details.remove(this.strip.node);
        this.strip.message(id ? "\u7528\u91CF\u7EDF\u8BA1 \xB7 \u7B49\u5F85\u672C\u5730\u4F1A\u8BDD\u6570\u636E" : "\u7528\u91CF\u7EDF\u8BA1 \xB7 \u5F00\u59CB\u5BF9\u8BDD\u540E\u663E\u793A");
        return;
      }
      const last = snapshot.turns?.at(-1);
      let speed = this.sessionSpeeds.get(snapshot);
      if (!speed) {
        speed = sessionSpeedReader(snapshot.turns ?? []);
        this.sessionSpeeds.set(snapshot, speed);
      }
      const items = [
        { key: "session", icon: "speed", kind: "session", text: `${snapshot.turnCount} \u8F6E ${snapshot.requests} \u6B65 \xB7 ${speed()}` },
        { key: "tokens", icon: "token", kind: "tokens", text: `${fmt(snapshot.total.total_tokens)} tok \xB7 \u7F13\u5B58\u547D\u4E2D ${pct(snapshot.cacheHitPercent)}` },
        { key: "context", icon: "context", kind: "context", text: pct(snapshot.contextPercent) }
      ];
      if (last && !last.completed) items.push({ key: "live", icon: "speed", kind: "live", text: `\u5F53\u524D ${last.averageTps?.toFixed(1) ?? "\u2014"} tok/s`, live: true });
      this.strip.render(items);
    }
    renderLive() {
      const snapshot = this.controller.snapshot;
      if (!snapshot || !this.strip.node.isConnected) return;
      this.renderStrip(snapshot, this.controller.threadId);
      this.details.update(snapshot);
    }
    renderQuota(mount) {
      if (this.life.disposed || document.visibilityState === "hidden") return;
      this.lastQuotaPaint = Date.now();
      this.quota.render({ limits: this.quotaState.limits }, mount === void 0 ? this.dom.quotaMount() : mount);
    }
    render(context = this.dom.context()) {
      if (this.life.disposed || !document.body) return;
      if (context.id !== this.controller.threadId) {
        this.synchronize(context);
        return;
      }
      const mount = this.dom.quotaMount();
      if (context.composer && !this.dom.chatMode(context.composer)) {
        this.dom.alignComposer(context.composer);
        this.strip.mount(context.composer);
        const id = context.id ?? "";
        if (this.strip.node.dataset.cuThread !== id) this.strip.node.dataset.cuThread = id;
      } else this.strip.unmount();
      this.renderUsage(mount);
      this.dom.reconcile();
    }
    renderUsage(mount) {
      if (this.life.disposed || document.visibilityState === "hidden") return;
      const { snapshot, threadId } = this.controller;
      if (this.strip.node.isConnected) this.renderStrip(snapshot, threadId);
      if (snapshot?.available) {
        const thread = this.replyCache.select(threadId, snapshot);
        if (this.replyThread !== thread) {
          this.replyThread = thread;
          this.replies = thread.groups;
          thread.restore();
        }
        if (!thread.indexed || thread.dirty.size) this.replyScan.request(() => this.renderReplies(thread));
      } else {
        this.replyScan.cancel();
        this.leaveReplies();
      }
      const limits = this.quotaState.limits;
      this.quotaState.useFallback(snapshot?.limits);
      if (mount !== void 0 || this.quotaState.limits !== limits) this.renderQuota(mount);
      this.details.update(snapshot);
    }
    leaveReplies() {
      if (!this.replyThread) return;
      for (const group of this.replies.values()) {
        this.dom.setActionParent(group.node, null);
        group.unmount();
      }
      this.replyThread = null;
      this.replies = /* @__PURE__ */ new Map();
    }
    renderReply(threadId, id, mount, turn) {
      let group = this.replies.get(id);
      if (!group) {
        const node = element("div", "cu-turn");
        node.setAttribute("data-markdown-copy", "exclude");
        node.dataset.cuThread = threadId;
        node.dataset.cuTurn = id;
        group = this.group(node);
        this.replies.set(id, group);
      }
      group.node.classList.toggle("cu-turn-inline", mount.inline);
      this.dom.setActionParent(group.node, mount.inline ? mount.parent : null);
      group.mount(mount.parent);
      group.render([
        { key: "tokens", icon: "token", kind: "tokens", turnId: id, text: `\u7528\u91CF ${fmt(turn.usage.total_tokens)} tok` },
        { key: "cache", kind: "tokens", turnId: id, text: `\u7F13\u5B58 ${pct(turn.cacheHitPercent)}` },
        { key: "speed", kind: "session", turnId: id, text: speedLabel(turn) }
      ]);
    }
    *renderReplies(thread) {
      for (const change of thread.changes()) {
        if (this.life.disposed || document.visibilityState === "hidden" || this.replyThread !== thread) return;
        if (!change) {
          yield;
          continue;
        }
        const { key, turn, mount } = change;
        yield (deferred) => {
          if (this.replyThread !== thread || thread.dirty.has(key)) return;
          if (mount) {
            if ((!thread.viewport || thread.nearby.has(mount.response)) && mount.parent.isConnected && (!deferred || mount.stillCurrent()))
              this.renderReply(thread.id, key, mount, turn);
          } else {
            const group = thread.groups.get(key);
            if (group) {
              this.dom.setActionParent(group.node, null);
              if (turn?.completed && thread.byTurn.has(key)) group.unmount();
              else {
                group.dispose();
                thread.groups.delete(key);
              }
            }
          }
        };
      }
      return () => this.dom.reconcile();
    }
    align() {
      invalidateMetricLayout();
      const composer = this.dom.composer();
      this.dom.cachedQuotaMount = void 0;
      this.renderQuota();
      if (!this.dom.chatMode(composer)) this.dom.alignComposer(composer, true);
      this.strip.align();
      if (this.replyThread) {
        const thread = this.replyThread;
        thread.restore();
        this.replyScan.request(() => this.renderReplies(thread));
      }
      this.details.position();
      this.quota.position();
    }
    start() {
      if (this.life.disposed || this.started) return;
      this.started = true;
      document.head.append(this.style);
      document.documentElement.dataset.cuUi = "ready";
      const reconcile = (delay = 200) => {
        const deadline = performance.now() + delay;
        if (this.renderTimer !== null) {
          if (this.renderDeadline <= deadline) return;
          clearTimeout(this.renderTimer);
        }
        this.renderDeadline = deadline;
        this.renderTimer = setTimeout(() => {
          this.renderTimer = null;
          if (document.visibilityState === "hidden") return;
          const context = this.dom.context();
          if (context.id !== this.controller.threadId) this.synchronize(context);
          else {
            this.render(context);
          }
        }, delay);
      };
      this.dom.watchVisibility((scopes) => {
        this.dom.fallbackThread = null;
        for (const scope of scopes) this.replyCache.visibility(scope);
        reconcile(0);
      });
      this.dom.watchQuota(() => reconcile(80));
      const observer = new MutationObserver((batch) => {
        const records = batch.filter((record) => this.replyCache.relevantDuringStream(record, this.replyThread));
        if (!records.length) return;
        const revision = this.replyThread?.domRevision;
        this.replyCache.observe(records, this.replyThread, this.dom);
        if (document.visibilityState === "hidden") return;
        let needsRender = false;
        for (const record of records) {
          if (this.dom.remountActions(record, this.controller.threadId, this.replies)) continue;
          needsRender ||= this.dom.relevant(record);
        }
        if (needsRender || this.replyThread?.domRevision !== revision) {
          const navigating = records.some((record) => record.attributeName === "data-above-composer-conversation-id" || record.type === "attributes" && this.dom.visibilityNodes.has(record.target));
          reconcile(navigating ? 0 : records.some((record) => record.type === "attributes") ? 80 : 200);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: [
        "data-above-composer-conversation-id",
        "data-content-search-turn-key",
        "data-response-annotation-conversation",
        "data-chatgpt-composer",
        "data-thread-find-composer",
        "data-app-navigation-rail",
        "aria-hidden",
        "hidden",
        "inert"
      ] });
      this.life.own(() => observer.disconnect());
      this.life.listen(window, "resize", () => this.align());
      this.life.listen(window, "focus", () => this.synchronize());
      this.life.listen(document, "visibilitychange", () => {
        if (document.visibilityState !== "hidden") {
          this.replyThread?.restore();
          this.synchronize(this.dom.context(), true);
        } else {
          this.replyScan.cancel();
          clearTimeout(this.readTimer);
          this.readTimer = null;
        }
      });
      this.life.listen(window, "popstate", () => this.synchronize());
      this.life.listen(window, "hashchange", () => this.synchronize());
      this.life.listen(document, "pointerdown", (event) => {
        this.details.outside(event);
        this.quota.outside(event);
      }, { capture: true });
      this.life.listen(document, "keydown", (event) => {
        this.details.keydown(event);
        this.quota.keydown(event);
      }, { capture: true });
      this.life.listen(document, "scroll", () => this.details.position(), { capture: true });
      this.life.interval(() => {
        if (document.visibilityState === "hidden") return;
        const turns = this.controller.snapshot?.turns ?? [];
        const live = Boolean(turns.at(-1) && !turns.at(-1).completed);
        const snapshot = this.controller.snapshot;
        const interval = snapshot?.eventDriven ? 6e4 : !snapshot?.available || live ? 5e3 : 3e4;
        if (Date.now() - this.lastSync >= interval) this.refreshData();
        else if (live && snapshot?.eventDriven) {
          const turn = turns.at(-1), duration = turn.startedAt == null ? null : Math.max(0, Date.now() - turn.startedAt);
          if (duration != null) {
            turn.durationMs = duration;
            turn.averageTps = duration > 0 ? turn.usage.output_tokens * 1e3 / duration : null;
            this.renderLive();
          }
        }
        if (Date.now() - (this.lastQuotaPaint ?? 0) >= 6e4) this.renderQuota();
      }, 2500);
      this.life.listen(window, "beforeunload", () => this.dispose(), { once: true });
      document.fonts?.ready.then(() => {
        if (!this.life.disposed) this.align();
      });
      this.synchronize();
    }
    dispose() {
      if (this.life.disposed) return;
      this.life.dispose();
      clearTimeout(this.renderTimer);
      clearTimeout(this.readTimer);
      this.replyScan.dispose();
      this.controller.dispose();
      this.quotaState.dispose();
      this.strip.dispose();
      this.replyCache.dispose();
      this.details.dispose();
      this.quota.dispose();
      this.dom.dispose();
      this.style.remove();
      delete document.documentElement.dataset.cuUi;
    }
  };

  // src/ui/index.mjs
  window.__codexUsagePluginDispose?.();
  var plugin = new UsagePlugin(import_electron.ipcRenderer);
  var dispose = () => {
    plugin.dispose();
    if (window.__codexUsagePluginDispose === dispose) window.__codexUsagePluginDispose = null;
  };
  window.__codexUsagePluginDispose = dispose;
  if (document.readyState === "loading") plugin.life.listen(document, "DOMContentLoaded", () => plugin.start(), { once: true });
  else plugin.start();
})();
