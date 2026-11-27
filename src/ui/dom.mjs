import protocol from '../protocol.cjs';

const { normalizeThreadId } = protocol;
export const OWN = '.cu-strip,.cu-turn,.cu-ring,.cu-quota-panel,.cu-panel,#codex-usage-ui-style';
export const STRUCTURAL_MARKERS = '[data-thread-find-composer],[data-thread-scroll-footer],[data-above-composer-conversation-id],'+
  '[data-content-search-turn-key],[data-response-annotation-conversation],.turn-action-controls,'+
  '[data-app-navigation-rail],[data-transition-phase],[data-chatgpt-composer]';

function structural(node) {
  return node.nodeType === 1 && !node.closest(OWN) &&
    (node.matches(STRUCTURAL_MARKERS) || node.querySelector(STRUCTURAL_MARKERS) !== null);
}

export function visible(node) {
  return node && node.closest('[aria-hidden="true"],[hidden],[inert]') == null &&
    node.getClientRects().length > 0 &&
    !['hidden', 'collapse'].includes(getComputedStyle(node).visibility);
}

function uniqueThread(nodes, attribute) {
  const ids = new Set(nodes.map(node => normalizeThreadId(node.getAttribute(attribute))).filter(Boolean));
  return ids.size === 1 ? [...ids][0] : null;
}

function composerRoot(node) {
  const footer = node.closest('[data-thread-scroll-footer]');
  if (!footer) return node;
  let parent;
  while ((parent = node.parentElement?.closest('[data-thread-find-composer]')) && footer.contains(parent)) node = parent;
  return node;
}

export function turnId(root, turns) {
  const key = root.getAttribute('data-content-search-turn-key') ?? '';
  if (turns.has(key)) return key;
  const candidates = [key, ...(key.match(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/gi) ?? []), ...key.split(/[^\w-]+/)];
  return candidates.find(candidate => turns.has(candidate)) ?? null;
}

export class CodexDOM {
  constructor() {
    this.footers = new Set();
    this.actions = new Map();
    this.actionParents = new WeakMap();
    this.visibilityNodes = new Set();
  }
  invalidateShell() {
    this.composerNodes = null;
    this.rails = null;
    this.fallbackThread = null;
  }
  responseChanged(response) {
    if (!this.fallbackResponses) return;
    this.fallbackThread = null;
    if (response.isConnected && response.hasAttribute('data-response-annotation-conversation')) this.fallbackResponses.add(response);
    else this.fallbackResponses.delete(response);
  }
  watchVisibility(callback) {
    // Observe only composer ancestors, not every class/style mutation in streamed text.
    this.visibilityObserver = new MutationObserver(records => {
      const normalize = (value, name) => name === 'class'
        ? (value ?? '').split(/\s+/).filter(x => x && !x.startsWith('cu-')).sort().join(' ')
        : (value ?? '').split(';').map(x=>x.trim()).filter(x=>/^(?:display|visibility|content-visibility)\s*:/.test(x)).sort().join(';');
      const changed = records.filter(r => normalize(r.oldValue,r.attributeName) !== normalize(r.target.getAttribute(r.attributeName),r.attributeName));
      if (changed.length) callback(new Set(changed.map(r => r.target)));
    });
  }
  trackVisibility(nodes) {
    const next = new Set();
    for(const node of nodes)for(let parent=node;parent;parent=parent.parentElement)next.add(parent);
    if(next.size === this.visibilityNodes.size && [...next].every(node=>this.visibilityNodes.has(node)))return;
    this.visibilityNodes=next;
    this.visibilityObserver?.disconnect();
    for(const node of next)this.visibilityObserver?.observe(node,{attributes:true,attributeOldValue:true,attributeFilter:['class','style']});
  }
  composer() {
    if (!this.composerNodes) {
      this.composerNodes = [...document.querySelectorAll('[data-thread-find-composer]')].filter(node=>!node.matches('button,input,textarea'));
      this.trackVisibility(this.composerNodes);
    }
    const all = this.composerNodes;
    const nodes = [...new Set(all.filter(visible).map(composerRoot))];
    const footers = nodes.filter(node => node.closest('[data-thread-scroll-footer]'));
    const candidates = footers.length ? footers : nodes;
    return candidates.find(node => node.contains(document.activeElement)) ?? candidates.at(-1) ?? null;
  }
  thread(composer = this.composer()) {
    for (const scope of [composer, composer?.closest('[data-thread-scroll-footer]')]) {
      const portals = scope ? [...scope.querySelectorAll('[data-above-composer-conversation-id]')] : [];
      // 原生 portal 可以零高度，所属输入框的可见性才决定其是否有效。
      if (portals.length) return uniqueThread(portals, 'data-above-composer-conversation-id');
    }
    const container = composer?.closest('.thread-scroll-container');
    if (composer && !container) return null;
    const scope = container ?? document;
    if (this.fallbackThread?.scope === scope) return this.fallbackThread.id;
    this.fallbackResponses ??= new Set(document.querySelectorAll('[data-response-annotation-conversation]'));
    const responses = [...this.fallbackResponses].filter(node => (scope === document || scope.contains(node)) && visible(node));
    const id = uniqueThread(responses, 'data-response-annotation-conversation');
    this.fallbackThread = {scope, id};
    return id;
  }
  chatMode(composer) {
    return Boolean(composer?.matches('[data-chatgpt-composer]') ||
      [...(composer?.querySelectorAll('[data-chatgpt-composer]') ?? [])].some(visible));
  }
  context() {
    const composer=this.composer();
    return {composer,id:this.thread(composer)};
  }
  quotaMount() {
    this.rails ??= [...document.querySelectorAll('[data-app-navigation-rail]')];
    const rail = this.rails.find(visible);
    if (!rail) return null;
    const buttons = [...rail.querySelectorAll('button,[role="button"]')].filter(node => !node.closest(OWN));
    const nativeQuota = buttons.find(node => node.querySelector('[data-transition-phase]') &&
      !node.closest('[hidden],[aria-hidden="true"],[inert]'));
    if (nativeQuota) return { parent:nativeQuota.parentElement, before:nativeQuota };
    let anchor = buttons.find(node => /^(下载|Downloads?)(?:\b|$)|查看下载/i.test(node.getAttribute('aria-label') ?? node.getAttribute('title') ?? '')) ?? buttons.at(-1);
    if (!anchor) return { parent: rail, before: null };
    while (anchor.parentElement !== rail && anchor.parentElement && !/column/.test(getComputedStyle(anchor.parentElement).flexDirection)) anchor = anchor.parentElement;
    return { parent: anchor.parentElement, before: anchor };
  }
  alignComposer(composer, remeasure = false) {
    const footer = composer?.closest('[data-thread-scroll-footer]');
    if (!footer || this.footers.has(footer) && !remeasure) return;
    footer.classList.remove('cu-footer');
    const padding = parseFloat(getComputedStyle(footer).paddingBottom) || 0;
    const nativeAfter = footer.classList.contains('after:h-(--thread-composer-bottom-inset)')
      ? getComputedStyle(footer, '::after') : null;
    const after = nativeAfter && nativeAfter.display !== 'none' && nativeAfter.content !== 'none'
      ? parseFloat(nativeAfter.height) || 0 : 0;
    const inset = padding + after;
    footer.style.setProperty('--cu-strip-height', `${30 + Math.max(0, inset - 8)}px`);
    footer.classList.add('cu-footer');
    this.footers.add(footer);
  }
  setActionParent(stats, row) {
    const old = this.actionParents.get(stats);
    if (old && old !== row && this.actions.get(old) === stats) {
      old.classList.remove('cu-action-row');
      this.actions.delete(old);
    }
    if (row) {
      if (!row.classList.contains('cu-action-row')) row.classList.add('cu-action-row');
      this.actions.set(row, stats);
      this.actionParents.set(stats, row);
    } else this.actionParents.delete(stats);
  }
  reconcile() {
    for (const footer of this.footers) {
      if (footer.isConnected && footer.querySelector('.cu-strip')) continue;
      footer.classList.remove('cu-footer');
      footer.style.removeProperty('--cu-strip-height');
      this.footers.delete(footer);
    }
  }
  remountActions(record, threadId, replies) {
    if (record.removedNodes.length !== 1 || record.addedNodes.length !== 1) return false;
    const old = record.removedNodes[0], row = record.addedNodes[0];
    if (!this.actions.has(old) || old.isConnected || !row.matches?.('.turn-action-controls')) return false;
    const response = row.closest('[data-response-annotation-conversation]');
    if (!response || normalizeThreadId(response.dataset.responseAnnotationConversation) !== threadId) return false;
    const root = response.closest('[data-content-search-turn-key]');
    const group = root && replies.get(turnId(root, replies));
    if (!group || group.node.parentElement !== old || row.querySelector('.cu-turn') || !visible(row)) return false;
    this.setActionParent(group.node, row);
    group.mount(row);
    return true;
  }
  relevant(record) {
    const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
    if (target?.closest(OWN)) return false;
    if (record.type === 'attributes') {
      return !['hidden','aria-hidden','inert'].includes(record.attributeName) || structural(target);
    }
    const nodes=[...record.addedNodes,...record.removedNodes];
    // React may remove an injected row without changing any native marker.
    if([...record.removedNodes].some(node=>node.nodeType===1&&node.matches('.cu-strip,.cu-turn')&&!node.isConnected))return true;
    if(nodes.some(structural))return true;
    return target?.matches('[data-thread-find-composer],[data-thread-scroll-footer],.turn-action-controls,[data-app-navigation-rail]')&&
      nodes.some(node=>node.nodeType===1&&!node.matches(OWN));
  }
  dispose() {
    this.visibilityObserver?.disconnect();
    this.visibilityNodes.clear();
    for (const footer of this.footers) {
      footer.classList.remove('cu-footer');
      footer.style.removeProperty('--cu-strip-height');
    }
    for (const row of this.actions.keys()) row.classList.remove('cu-action-row');
    this.footers.clear();
    this.actions.clear();
  }
}
