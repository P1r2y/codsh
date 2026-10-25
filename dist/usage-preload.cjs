// codsh-source-sha256:36d7ab201fc2a5604b739f765831e93c70228172810b8f9b948dd3c2a673a80c
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
      var STATE_CHANNEL = "codex-enhancement-loader:state-v1";
      var UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
      var normalizeThreadId2 = (value) => typeof value === "string" && UUID.test(value) ? value.toLowerCase() : null;
      module.exports = { READ_CHANNEL, STATE_CHANNEL, UUID, normalizeThreadId: normalizeThreadId2 };
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

  // src/ui/controller.mjs
  var import_protocol = __toESM(require_protocol(), 1);
  var ConversationController = class {
    constructor(read, onChange) {
      this.read = read;
      this.onChange = onChange;
      this.threadId = null;
      this.snapshot = null;
      this.revision = 0;
      this.inflight = null;
      this.pending = false;
      this.disposed = false;
    }
    select(value) {
      if (this.disposed) return false;
      const id = import_protocol.default.normalizeThreadId(value);
      if (id === this.threadId) return false;
      this.threadId = id;
      this.snapshot = null;
      this.revision++;
      this.onChange(true);
      return true;
    }
    async refresh() {
      if (this.disposed) return;
      if (this.inflight) {
        this.pending = true;
        return;
      }
      const id = this.threadId;
      const revision = this.revision;
      const task = Promise.resolve().then(() => this.read(id));
      this.inflight = task;
      try {
        const next = await task;
        if (!this.disposed && revision === this.revision && next?.threadId === id) {
          this.snapshot = next;
          this.onChange(false);
        }
      } catch (error) {
        if (!this.disposed) console.warn("[CodexUsageUI]", String(error));
      } finally {
        this.inflight = null;
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
    }
  };

  // src/ui/dom.mjs
  var import_protocol2 = __toESM(require_protocol(), 1);
  var { normalizeThreadId } = import_protocol2.default;
  var OWN = ".cu-strip,.cu-turn,.cu-ring,.cu-tooltip,.cu-panel,#codex-usage-ui-style";
  function visible(node) {
    return node && node.getClientRects().length > 0 && node.closest('[aria-hidden="true"],[hidden],[inert]') == null && !["hidden", "collapse"].includes(getComputedStyle(node).visibility);
  }
  function uniqueThread(nodes, attribute) {
    const ids = new Set(nodes.map((node) => normalizeThreadId(node.getAttribute(attribute))));
    return ids.size === 1 ? [...ids][0] : null;
  }
  function turnId(root, turns) {
    const key = root.getAttribute("data-content-search-turn-key") ?? "";
    const candidates = [key, ...key.match(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/gi) ?? [], ...key.split(/[^\w-]+/)];
    return candidates.find((candidate) => turns.has(candidate)) ?? null;
  }
  var CodexDOM = class {
    constructor() {
      this.footers = /* @__PURE__ */ new Set();
      this.actions = /* @__PURE__ */ new Set();
    }
    composer() {
      const nodes = [...document.querySelectorAll("[data-thread-find-composer]")].filter(visible);
      return nodes.find((node) => node.contains(document.activeElement)) ?? nodes.at(-1) ?? null;
    }
    thread(composer = this.composer()) {
      for (const scope of [composer, composer?.closest("[data-thread-scroll-footer]")]) {
        const portals = scope ? [...scope.querySelectorAll("[data-above-composer-conversation-id]")].filter((node) => !node.closest("[data-thread-find-composer]") || node.closest("[data-thread-find-composer]") === composer) : [];
        if (portals.length) return uniqueThread(portals, "data-above-composer-conversation-id");
      }
      const responses = [...document.querySelectorAll("[data-response-annotation-conversation]")].filter(visible);
      return uniqueThread(responses, "data-response-annotation-conversation");
    }
    scan(snapshot) {
      const composer = this.composer();
      const id = this.thread(composer);
      const turns = new Map((snapshot?.threadId === id ? snapshot.turns ?? [] : []).map((turn) => [turn.id, turn]));
      const replies = /* @__PURE__ */ new Map();
      for (const response of document.querySelectorAll("[data-response-annotation-conversation]")) {
        if (!visible(response) || normalizeThreadId(response.getAttribute("data-response-annotation-conversation")) !== id) continue;
        let root = response.closest("[data-content-search-turn-key]");
        let key = null;
        while (root && !(key = turnId(root, turns))) root = root.parentElement?.closest("[data-content-search-turn-key]");
        const turn = turns.get(key);
        if (!turn?.completed) continue;
        const actions = [...response.querySelectorAll(".turn-action-controls")].filter(visible).at(-1);
        replies.set(key, { turn, parent: actions ?? response, inline: Boolean(actions) });
      }
      return { id, composer, replies, quota: this.quotaMount() };
    }
    quotaMount() {
      const rail = [...document.querySelectorAll("[data-app-navigation-rail]")].find(visible);
      if (!rail) return null;
      const buttons = [...rail.querySelectorAll('button,[role="button"]')].filter((node) => !node.closest(OWN));
      let anchor = buttons.find((node) => /^(下载|Downloads?)(?:\b|$)|查看下载/i.test(node.getAttribute("aria-label") ?? node.getAttribute("title") ?? "")) ?? buttons.at(-1);
      if (!anchor) return { parent: rail, before: null };
      while (anchor.parentElement !== rail && anchor.parentElement && !/column/.test(getComputedStyle(anchor.parentElement).flexDirection)) anchor = anchor.parentElement;
      return { parent: anchor.parentElement, before: anchor };
    }
    alignComposer(composer, remeasure = false) {
      const footer = composer?.closest("[data-thread-scroll-footer]");
      if (!footer || this.footers.has(footer) && !remeasure) return;
      footer.classList.remove("cu-footer");
      const inset = parseFloat(getComputedStyle(footer).paddingBottom) || 0;
      footer.style.setProperty("--cu-strip-height", `${30 + Math.max(0, inset - 8)}px`);
      footer.classList.add("cu-footer");
      this.footers.add(footer);
    }
    markActions(node) {
      node.classList.add("cu-action-row");
      this.actions.add(node);
    }
    reconcile() {
      for (const row of this.actions) {
        if (row.isConnected && row.querySelector(".cu-turn")) continue;
        row.classList.remove("cu-action-row");
        this.actions.delete(row);
      }
      for (const footer of this.footers) {
        if (footer.isConnected && footer.querySelector(".cu-strip")) continue;
        footer.classList.remove("cu-footer");
        footer.style.removeProperty("--cu-strip-height");
        this.footers.delete(footer);
      }
    }
    relevant(records) {
      return records.some((record) => !(record.target.nodeType === 1 && record.target.closest(OWN)));
    }
    dispose() {
      for (const footer of this.footers) {
        footer.classList.remove("cu-footer");
        footer.style.removeProperty("--cu-strip-height");
      }
      for (const row of this.actions) row.classList.remove("cu-action-row");
      this.footers.clear();
      this.actions.clear();
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

  // src/ui/metrics.mjs
  var textMeasure = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
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
    for (const label of container.querySelectorAll(".cu-metric-label")) {
      const row = label.parentElement, svg = row.querySelector("svg");
      label.style.removeProperty("transform");
      svg?.style.removeProperty("transform");
      const bounds = row.getBoundingClientRect(), target = bounds.top + bounds.height / 2;
      const style = getComputedStyle(label);
      const scale = label.getBoundingClientRect().height / (parseFloat(style.height) || 20);
      textMeasure.font = [style.fontStyle, style.fontWeight, style.fontSize, style.fontFamily].join(" ");
      const text = label.textContent, font = [style.fontStyle, style.fontWeight, style.fontSize, style.fontFamily].join(" ");
      const width = textMeasure.measureText(text).width;
      const marker = element("span");
      marker.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline;margin:0;padding:0;border:0";
      label.append(marker);
      const baseline = marker.getBoundingClientRect().top;
      marker.remove();
      const dpr = devicePixelRatio || 1, pixelScale = dpr * scale, size = parseFloat(style.fontSize);
      textMeasure.canvas.width = Math.max(1, Math.ceil((width + 8) * pixelScale));
      textMeasure.canvas.height = Math.ceil((size * 4 + 8) * pixelScale);
      const reference = Math.ceil(size * 2 * pixelScale) + baseline * dpr % 1;
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
      const center = bottom < 0 ? target : baseline + ((top + bottom + 1) / 2 - reference) / dpr;
      const shift = Math.round((target - center) * dpr) / dpr;
      label.style.transform = `translateY(${shift / scale}px)`;
      const glyphCenter = center + shift;
      if (svg) {
        const box = svg.getBBox(), matrix = svg.getScreenCTM();
        const iconCenter = matrix.b * (box.x + box.width / 2) + matrix.d * (box.y + box.height / 2) + matrix.f;
        svg.style.transform = `translateY(${(glyphCenter - iconCenter) / scale}px)`;
      }
    }
  }
  var MetricGroup = class {
    constructor(node, onActivate, onRemove) {
      this.node = node;
      this.onActivate = onActivate;
      this.onRemove = onRemove;
    }
    render(items) {
      const old = new Map([...this.node.children].map((node) => [node.dataset.cuKey, node]));
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
        button.dataset.cuKind = item.kind;
        button.dataset.cuTurn = item.turnId ?? "";
        const label = button.querySelector(".cu-metric-label");
        if (label.textContent !== item.text) {
          setText(label, item.text);
          changed = true;
        }
        button.setAttribute("aria-label", `${item.text}\uFF0C\u70B9\u51FB\u67E5\u770B\u8BE6\u60C5`);
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
      if (changed) this.align();
    }
    mount(parent, before = null) {
      if (this.node.parentNode !== parent || this.node.nextSibling !== before) {
        parent.insertBefore(this.node, before);
        this.align();
      }
    }
    align() {
      alignMetrics(this.node);
    }
    dispose() {
      this.onRemove(this.node);
      this.node.remove();
    }
  };

  // src/ui/details.mjs
  var import_usage_model = __toESM(require_usage_model(), 1);

  // src/ui/format.mjs
  var fmt = (n) => n == null || !Number.isFinite(n) ? "\u2014" : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : Math.round(n).toLocaleString("en-US");
  var pct = (n) => n == null ? "\u2014" : `${Math.round(n)}%`;
  var elapsed = (ms) => ms == null ? "\u2014" : ms >= 6e4 ? `${(ms / 6e4).toFixed(1)} \u5206\u949F` : `${(ms / 1e3).toFixed(1)} \u79D2`;
  var tokens = (n) => n == null ? "\u6682\u65E0\u6570\u636E" : `${Math.round(n).toLocaleString("en-US")} tok`;
  var completedDate = (turn) => turn?.completedAt ? new Date(turn.completedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) : null;
  var speedLabel = (turn) => turn?.estimatedGenerationTps != null ? `${Math.round(turn.estimatedGenerationTps)} tok/s` : turn?.averageTps != null ? `\u6574\u8F6E ${turn.averageTps.toFixed(1)} tok/s` : "\u901F\u5EA6 \u2014";
  function countdown(ms) {
    if (ms == null || !Number.isFinite(ms)) return "\u91CD\u7F6E\u65F6\u95F4\u4E0D\u53EF\u7528";
    if (ms <= 0) return "\u7B49\u5F85\u5237\u65B0";
    const m = Math.ceil(ms / 6e4), d = Math.floor(m / 1440), h = Math.floor(m % 1440 / 60);
    return d ? `${d}\u5929 ${h}\u5C0F\u65F6` : h ? `${h}\u5C0F\u65F6 ${m % 60}\u5206` : `${m}\u5206`;
  }
  function shortTime(ms) {
    if (ms == null) return "\u2014";
    if (ms <= 0) return "\u5F85\u5237\u65B0";
    return ms >= 864e5 ? `${Math.ceil(ms / 864e5)}\u5929` : ms >= 36e5 ? `${Math.ceil(ms / 36e5)}\u65F6` : `${Math.ceil(ms / 6e4)}\u5206`;
  }

  // src/ui/details.mjs
  var { statisticsFor, usageParts } = import_usage_model.default;
  function createDetailsPopover(onOpen) {
    let snapshot = null;
    let metricPanel = null, panelAnchor = null, panelCloseTimer = null, tokenModel = null;
    let byId = /* @__PURE__ */ new Map();
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
      const turn = id ? byId.get(id) : null, last = snapshot?.turns?.at(-1);
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
        byId = new Map((value?.turns ?? []).map((turn) => [turn.id, turn]));
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
        byId.clear();
      }
    };
  }

  // src/ui/quota.mjs
  function createQuotaWidget(onOpen) {
    let snapshot = null, ring = null, ringButton = null, tooltip = null;
    let quotaHideTimer = null, quotaCloseTimer = null;
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
      ringButton.setAttribute("aria-describedby", "cu-quota-tooltip");
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 32 32");
      svg.append(svgCircle(13, "cu-track"), svgCircle(13, "cu-remaining"), svgCircle(8, "cu-track"), svgCircle(8, "cu-time"));
      const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
      text.setAttribute("x", "16");
      text.setAttribute("y", "16");
      svg.append(text);
      ringButton.append(svg);
      ring.append(ringButton);
      tooltip = element("div", "cu-tooltip");
      tooltip.id = "cu-quota-tooltip";
      tooltip.role = "tooltip";
      tooltip.hidden = true;
      document.body.append(tooltip);
      const show = () => {
        clearTimeout(quotaHideTimer);
        clearTimeout(quotaCloseTimer);
        onOpen();
        tooltip.dataset.state = "closed";
        tooltip.hidden = false;
        renderTooltip();
        positionTooltip();
        tooltip.dataset.state = "open";
      };
      const hide = () => {
        clearTimeout(quotaHideTimer);
        quotaHideTimer = setTimeout(() => {
          if (tooltip && ring && !tooltip.matches(":hover") && !ring.matches(":hover") && document.activeElement !== ringButton) hideQuota();
        }, 140);
      };
      ring.addEventListener("mouseenter", show);
      ring.addEventListener("mouseleave", hide);
      ringButton.addEventListener("focus", show);
      ringButton.addEventListener("blur", hide);
      ringButton.addEventListener("click", () => tooltip.hidden || tooltip.dataset.state === "closed" ? show() : hideQuota());
      tooltip.addEventListener("mouseenter", () => clearTimeout(quotaHideTimer));
      tooltip.addEventListener("mouseleave", hide);
    }
    function hideQuota() {
      clearTimeout(quotaHideTimer);
      clearTimeout(quotaCloseTimer);
      if (tooltip) {
        tooltip.dataset.state = "closed";
        quotaCloseTimer = setTimeout(() => {
          if (tooltip) tooltip.hidden = true;
        }, 160);
      }
    }
    function selectedWindow() {
      const windows = snapshot?.limits?.groups?.flatMap((g) => g.windows.map((w) => ({ ...w, groupName: g.name }))) ?? [];
      return windows.sort((a, b) => a.remainingPercent - b.remainingPercent || a.windowMinutes - b.windowMinutes)[0] ?? null;
    }
    function positionTooltip() {
      if (!tooltip || tooltip.hidden || !ring?.isConnected) return;
      const r = ring.getBoundingClientRect(), t = { width: tooltip.offsetWidth, height: tooltip.offsetHeight };
      tooltip.style.left = `${Math.min(innerWidth - t.width - 12, Math.max(12, r.right + 10))}px`;
      tooltip.style.top = `${Math.max(12, Math.min(r.top, innerHeight - t.height - 12))}px`;
    }
    function renderTooltip() {
      if (!tooltip || tooltip.hidden) return;
      const nodes = [];
      if (!snapshot?.limits) nodes.push(element("p", "", "\u6682\u65E0\u53EF\u7528\u989D\u5EA6\u6570\u636E"));
      for (const group of snapshot?.limits?.groups ?? []) for (const w of group.windows) {
        const box = element("div", "cu-quota-detail");
        box.append(
          element("strong", "", `${group.name} \xB7 ${w.label}`),
          element("p", "", `\u5269\u4F59 ${pct(w.remainingPercent)} \xB7 \u5DF2\u7528 ${pct(w.usedPercent)}`),
          element("p", "", `\u8DDD\u91CD\u7F6E ${countdown(w.resetsAt == null ? null : w.resetsAt - Date.now())}`),
          element("p", "cu-muted", w.resetsAt == null ? "\u91CD\u7F6E\u65F6\u95F4\u4E0D\u53EF\u7528" : `\u5317\u4EAC\u65F6\u95F4 ${new Date(w.resetsAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}`)
        );
        nodes.push(box);
      }
      const text = nodes.map((n) => n.textContent).join("|");
      if (tooltip.dataset.content !== text) {
        tooltip.replaceChildren(...nodes);
        tooltip.dataset.content = text;
      }
    }
    function render(value, mount) {
      snapshot = value;
      if (!mount) {
        ring?.remove();
        if (tooltip) tooltip.hidden = true;
        return;
      }
      if (!ring) makeRing();
      if (!tooltip.isConnected) document.body.append(tooltip);
      if (ring.parentNode !== mount.parent || ring.nextSibling !== mount.before) mount.parent.insertBefore(ring, mount.before);
      const w = selectedWindow(), remain = w?.remainingPercent, expired = w?.resetsAt != null && w.resetsAt <= Date.now();
      const left = w?.resetsAt == null ? null : w.resetsAt - Date.now();
      const ratio = w && left != null ? Math.min(1, Math.max(0, left / (w.windowMinutes * 6e4))) : 0;
      const outer = ring.querySelector(".cu-remaining"), inner = ring.querySelector(".cu-time");
      outer.style.stroke = remain == null ? "#8793a3" : remain <= 10 ? "#f26767" : remain <= 30 ? "#eeb866" : "#79acfe";
      outer.style.strokeDasharray = `${2 * Math.PI * 13}`;
      outer.style.strokeDashoffset = `${2 * Math.PI * 13 * (1 - (remain ?? 0) / 100)}`;
      outer.style.opacity = remain == null || expired ? ".45" : "1";
      inner.style.stroke = "#5ccbd9";
      inner.style.strokeDasharray = `${2 * Math.PI * 8}`;
      inner.style.strokeDashoffset = `${2 * Math.PI * 8 * (1 - ratio)}`;
      setText(ring.querySelector("text"), shortTime(left));
      ringButton.setAttribute("aria-label", w ? `${w.label}\u5269\u4F59 ${pct(remain)}\uFF0C\u8DDD\u91CD\u7F6E ${countdown(left)}` : "Codex \u989D\u5EA6\u6682\u4E0D\u53EF\u7528");
      renderTooltip();
      positionTooltip();
    }
    return {
      render,
      hide: hideQuota,
      position: positionTooltip,
      outside(event) {
        if (tooltip && !tooltip.hidden && !ring?.contains(event.target) && !tooltip.contains(event.target)) hideQuota();
      },
      keydown(event) {
        if (event.key === "Escape" && tooltip && !tooltip.hidden) hideQuota();
      },
      dispose() {
        clearTimeout(quotaHideTimer);
        clearTimeout(quotaCloseTimer);
        ring?.remove();
        tooltip?.remove();
        snapshot = null;
        ring = null;
        ringButton = null;
        tooltip = null;
      }
    };
  }

  // src/ui/app.mjs
  var import_usage_model2 = __toESM(require_usage_model(), 1);
  var import_protocol3 = __toESM(require_protocol(), 1);

  // src/ui/styles.css
  var styles_default = '.cu-strip,.cu-turn{font-family:var(--font-sans,var(--font-sans-default,"Segoe UI",sans-serif));font-size:var(--text-sm,12px);font-weight:400;line-height:20px;color:var(--color-text-secondary,var(--app-color-text-secondary,#979b9f));font-variant-numeric:tabular-nums;user-select:none}\r\n.cu-footer:has(.cu-strip){padding-bottom:0!important}\r\n.cu-strip{display:flex;align-items:center;align-content:center;justify-content:center;gap:0 8px;flex-wrap:wrap;min-height:var(--cu-strip-height,30px);padding:0 6px;margin:0;flex-shrink:0}\r\n.cu-strip>.cu-metric,.cu-turn>.cu-metric{display:flex;align-items:center;gap:5px;box-sizing:border-box;height:calc(var(--spacing,4px)*6);margin:0;padding:0 6px;white-space:nowrap;font:inherit;line-height:20px;border:0;border-radius:var(--radius-md,6px);color:inherit;background:transparent;cursor:pointer;outline-offset:2px;transition:background-color .15s var(--ease-out,ease-out),color .15s var(--ease-out,ease-out)}\r\n.cu-metric:hover,.cu-metric[aria-expanded=true]{background:var(--color-background-primary-ghost-hover,#ffffff12);color:var(--color-text,var(--app-color-text-foreground,#e3e5e8))}.cu-metric:focus-visible{outline:2px solid var(--color-ring,#79acfe)}\r\n.cu-metric>.cu-metric-label{display:block;margin:0;padding:0;border:0;font:inherit;font-weight:400;line-height:20px;letter-spacing:normal}\r\n.cu-strip svg,.cu-turn svg,.cu-panel svg{display:block;width:14px;height:14px;overflow:visible;stroke:currentColor;fill:none;stroke-width:1.5;flex-shrink:0}\r\n.cu-turn{display:flex;flex-wrap:wrap;align-items:center;gap:2px;padding:5px 0 12px;min-width:0;clear:both}\r\n.cu-turn-inline{padding:0;margin-inline-start:6px;clear:none}.cu-action-row{column-gap:2px}\r\n.cu-action-row>.opacity-0{opacity:1!important}\r\n.cu-turn>span{white-space:nowrap}.cu-turn [data-cu-usage]{display:inline-flex;align-items:center;gap:4px}\r\n.cu-ring{width:36px;height:36px;min-height:36px;flex-shrink:0;display:flex;align-items:center;justify-content:center;align-self:center;margin:2px 0;position:relative}\r\n.cu-ring button{border:0;padding:2px;width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;background:transparent;color:inherit;outline-offset:2px;transition:background-color .15s var(--ease-out,ease-out)}\r\n.cu-ring button:hover,.cu-ring button:focus-visible{background:var(--color-background-primary-ghost-hover,#ffffff12)}\r\n.cu-ring svg{width:32px;height:32px;overflow:visible}.cu-ring circle{fill:none;stroke-width:3;transform:rotate(-90deg);transform-origin:center;stroke-linecap:round;transition:stroke-dashoffset .35s var(--ease-out,ease-out),stroke .2s}\r\n.cu-ring .cu-track{stroke:currentColor;opacity:.12}.cu-ring text{fill:var(--color-text-secondary,var(--app-color-text-secondary,#a5abb3));font:6.5px "Segoe UI",sans-serif;text-anchor:middle;dominant-baseline:central}\r\n.cu-tooltip,.cu-panel{position:fixed;z-index:2147483647;box-sizing:border-box;min-width:min(280px,calc(100vw - 24px));max-width:min(380px,calc(100vw - 24px));max-height:calc(100vh - 24px);overflow:auto;padding:16px;border-radius:var(--radius-2xl,16px);background:color-mix(in srgb,var(--color-surface-elevated-secondary,#262626) 90%,transparent);color:var(--color-text,var(--app-color-text-foreground,#e3e5e8));box-shadow:0 0 0 var(--dropdown-overlay-ring-width,.5px) var(--color-border-overlay,#ffffff26),var(--shadow-dropdown-overlay,0 8px 32px #0005);backdrop-filter:blur(var(--blur-sm,8px));border:0;font:400 var(--text-base,14px)/20px var(--font-sans,var(--font-sans-default,"Segoe UI",sans-serif));font-variant-numeric:tabular-nums;user-select:text;opacity:0;transform:translateY(4px) scale(.98);transform-origin:bottom center;transition:opacity .16s var(--ease-out,ease-out),transform .16s var(--ease-out,ease-out)}\r\n.cu-tooltip[data-state=open],.cu-panel[data-state=open]{opacity:1;transform:none}.cu-tooltip[hidden],.cu-panel[hidden]{display:none}.cu-tooltip[data-state=closed],.cu-panel[data-state=closed]{pointer-events:none}\r\n.cu-tooltip strong,.cu-panel strong{font:inherit;font-weight:600}.cu-tooltip p{margin:8px 0 0}.cu-muted,.cu-note{color:var(--color-text-secondary,#999)}.cu-tooltip .cu-muted,.cu-note{font-size:var(--text-sm,12px)}.cu-tooltip .cu-quota-detail+.cu-quota-detail{border-top:1px solid var(--color-border-overlay,#ffffff26);margin-top:12px;padding-top:12px}\r\n.cu-panel-header{display:flex;align-items:center;justify-content:space-between;gap:20px;padding-bottom:12px;margin-bottom:10px;border-bottom:1px solid var(--color-border-overlay,#ffffff26)}.cu-panel-heading{display:flex;align-items:center;gap:8px}.cu-panel-total{white-space:nowrap}.cu-stat-row{display:flex;align-items:baseline;justify-content:space-between;gap:24px;padding:4px 0}.cu-stat-label{color:var(--color-text-secondary,#999)}.cu-stat-value{text-align:right;overflow-wrap:anywhere}.cu-note{margin:10px 0 0;line-height:18px}.cu-context-track{height:5px;border-radius:99px;background:var(--color-background-primary-ghost-hover,#ffffff12);overflow:hidden;margin:4px 0 12px}.cu-context-fill{display:flex;height:100%;border-radius:inherit;overflow:hidden;transition:width .25s var(--ease-out,ease-out)}\r\n.cu-context-segment{display:block;flex:0 0 auto;height:100%;background:var(--cu-context-color);transition:width .25s var(--ease-out,ease-out)}.cu-context-uncached{--cu-context-color:var(--purple-400,#a78bfa)}.cu-context-cached{--cu-context-color:var(--blue-400,#60a5fa)}.cu-context-output{--cu-context-color:var(--green-400,#4ade80)}.cu-context-unknown{--cu-context-color:var(--color-text-tertiary,#878b93)}.cu-stat-row[data-cu-category]>.cu-stat-label{display:inline-flex;align-items:center;gap:8px}.cu-context-dot{display:inline-block;flex-shrink:0;width:8px;height:8px;border-radius:2px;background:var(--cu-context-color)}\r\n.cu-token-panel{font-size:var(--text-sm,12px);padding:14px}.cu-token-panel .cu-panel-header{gap:16px;padding-bottom:10px;margin-bottom:8px}.cu-model-views{display:flex;gap:4px;overflow-x:auto;max-width:100%;padding:0 0 8px;scrollbar-width:thin}.cu-model-view,.cu-model-summary{border:0;border-radius:var(--radius-md,6px);background:transparent;color:var(--color-text-secondary,#999);font:inherit;line-height:20px;cursor:pointer;transition:background-color .15s var(--ease-out,ease-out),color .15s var(--ease-out,ease-out)}.cu-model-view{flex:0 0 auto;padding:2px 7px;white-space:nowrap}.cu-model-view:hover,.cu-model-summary:hover,.cu-model-view[aria-pressed=true]{background:var(--color-background-primary-ghost-hover,#ffffff12);color:var(--color-text,var(--app-color-text-foreground,#e3e5e8))}.cu-model-view:focus-visible,.cu-model-summary:focus-visible{outline:2px solid var(--color-ring,#79acfe);outline-offset:-2px}.cu-model-list{border-top:1px solid var(--color-border-overlay,#ffffff26);margin-top:8px;padding-top:6px}.cu-model-summary{display:flex;align-items:center;justify-content:space-between;gap:16px;width:100%;padding:4px 6px;text-align:left}.cu-model-summary>span:first-child{min-width:0;overflow-wrap:anywhere}.cu-model-summary>span:last-child{white-space:nowrap;color:var(--color-text,var(--app-color-text-foreground,#e3e5e8))}\r\n@media(max-width:620px){.cu-strip{gap:2px 4px}.cu-turn{gap:2px}}\r\n@media(prefers-reduced-motion:reduce){.cu-metric,.cu-ring button,.cu-ring circle,.cu-tooltip,.cu-panel,.cu-context-fill,.cu-context-segment,.cu-model-view,.cu-model-summary{transition:none}}\r\n';

  // src/ui/app.mjs
  var UsagePlugin = class {
    constructor(ipc) {
      this.life = new Lifetime();
      this.dom = new CodexDOM();
      this.replies = /* @__PURE__ */ new Map();
      this.renderTimer = null;
      this.details = createDetailsPopover(() => this.quota.hide());
      this.quota = createQuotaWidget(() => this.details.close());
      this.controller = new ConversationController(
        (id) => ipc.invoke(import_protocol3.default.READ_CHANNEL, { threadId: id }),
        (changed) => {
          if (changed) this.details.close();
          this.render();
        }
      );
      const strip = element("div", "cu-strip");
      strip.setAttribute("aria-label", "\u5F53\u524D\u5BF9\u8BDD\u7528\u91CF\u7EDF\u8BA1");
      strip.setAttribute("data-markdown-copy", "exclude");
      this.strip = this.group(strip);
      this.style = element("style");
      this.style.id = "codex-usage-ui-style";
      this.style.textContent = styles_default;
    }
    group(node) {
      return new MetricGroup(node, (button) => this.details.toggle(button), (node2) => this.details.remove(node2));
    }
    synchronize() {
      if (this.life.disposed) return;
      this.controller.select(this.dom.thread());
      void this.controller.refresh();
    }
    render() {
      if (this.life.disposed || !document.body) return;
      const snapshot = this.controller.snapshot;
      const view = this.dom.scan(snapshot);
      if (view.id !== this.controller.threadId) {
        this.synchronize();
        return;
      }
      if (view.composer) {
        this.dom.alignComposer(view.composer);
        this.strip.mount(view.composer);
        this.strip.node.dataset.cuThread = view.id ?? "";
        if (!snapshot?.available) {
          this.details.remove(this.strip.node);
          setText(this.strip.node, view.id ? "\u7528\u91CF\u7EDF\u8BA1 \xB7 \u7B49\u5F85\u672C\u5730\u4F1A\u8BDD\u6570\u636E" : "\u7528\u91CF\u7EDF\u8BA1 \xB7 \u5F00\u59CB\u5BF9\u8BDD\u540E\u663E\u793A");
        } else {
          const items = [
            { key: "session", icon: "speed", kind: "session", text: `${snapshot.turnCount} \u8F6E ${snapshot.requests} \u6B65 \xB7 ${speedLabel(import_usage_model2.default.statisticsFor(snapshot.turns ?? []))}` },
            { key: "tokens", icon: "token", kind: "tokens", text: `${fmt(snapshot.total.total_tokens)} tok \xB7 \u7F13\u5B58\u547D\u4E2D ${pct(snapshot.cacheHitPercent)}` },
            { key: "context", icon: "context", kind: "context", text: pct(snapshot.contextPercent) }
          ];
          const last = snapshot.turns?.at(-1);
          if (last && !last.completed) items.push({ key: "live", icon: "speed", kind: "live", text: `\u5F53\u524D ${last.averageTps?.toFixed(1) ?? "\u2014"} tok/s`, live: true });
          this.strip.render(items);
        }
      } else this.strip.node.remove();
      for (const [id, group] of this.replies) if (!view.replies.has(id)) {
        group.dispose();
        this.replies.delete(id);
      }
      for (const [id, mount] of view.replies) {
        let group = this.replies.get(id);
        if (!group) {
          const node = element("div", "cu-turn");
          node.setAttribute("data-markdown-copy", "exclude");
          group = this.group(node);
          this.replies.set(id, group);
        }
        group.node.dataset.cuThread = view.id;
        group.node.dataset.cuTurn = id;
        group.node.classList.toggle("cu-turn-inline", mount.inline);
        if (mount.inline) this.dom.markActions(mount.parent);
        group.mount(mount.parent);
        const turn = mount.turn;
        group.render([
          { key: "tokens", icon: "token", kind: "tokens", turnId: id, text: `\u7528\u91CF ${fmt(turn.usage.total_tokens)} tok` },
          { key: "cache", kind: "tokens", turnId: id, text: `\u7F13\u5B58 ${pct(turn.cacheHitPercent)}` },
          { key: "speed", kind: "session", turnId: id, text: speedLabel(turn) }
        ]);
      }
      this.quota.render(snapshot, view.quota);
      this.details.update(snapshot);
      this.dom.reconcile();
    }
    align() {
      this.dom.alignComposer(this.dom.composer(), true);
      this.strip.align();
      for (const group of this.replies.values()) group.align();
      this.details.position();
      this.quota.position();
    }
    start() {
      if (this.life.disposed || this.started) return;
      this.started = true;
      document.head.append(this.style);
      document.documentElement.dataset.cuUi = "ready";
      const observer = new MutationObserver((records) => {
        if (!this.dom.relevant(records)) return;
        if (this.dom.thread() !== this.controller.threadId) {
          this.synchronize();
          return;
        }
        if (this.renderTimer) return;
        this.renderTimer = setTimeout(() => {
          this.renderTimer = null;
          this.render();
        }, 180);
      });
      observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: [
        "data-above-composer-conversation-id",
        "data-content-search-turn-key",
        "data-response-annotation-conversation",
        "aria-hidden",
        "hidden",
        "inert"
      ] });
      this.life.own(() => observer.disconnect());
      this.life.listen(window, "resize", () => this.align());
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
      this.life.interval(() => this.synchronize(), 1800);
      this.life.listen(window, "beforeunload", () => this.dispose(), { once: true });
      document.fonts?.ready.then(() => {
        if (!this.life.disposed) this.align();
      });
      this.synchronize();
      this.render();
    }
    dispose() {
      if (this.life.disposed) return;
      this.life.dispose();
      clearTimeout(this.renderTimer);
      this.controller.dispose();
      this.strip.dispose();
      for (const group of this.replies.values()) group.dispose();
      this.replies.clear();
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
