import protocol from '../protocol.cjs';

const { normalizeThreadId } = protocol;
const OWN = '.cu-strip,.cu-turn,.cu-ring,.cu-quota-panel,.cu-panel,#codex-usage-ui-style';
const MARKERS = '[data-thread-find-composer],[data-thread-scroll-footer],[data-above-composer-conversation-id],'+
  '[data-content-search-turn-key],[data-response-annotation-conversation],.turn-action-controls,'+
  '[data-app-navigation-rail],[data-transition-phase],[data-chatgpt-composer]';

function structural(node) {
  return node.nodeType === 1 && !node.closest(OWN) &&
    (node.matches(MARKERS) || node.querySelector(MARKERS) !== null);
}

export function visible(node) {
  return node && node.getClientRects().length > 0 &&
    node.closest('[aria-hidden="true"],[hidden],[inert]') == null &&
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

function turnId(root, turns) {
  const key = root.getAttribute('data-content-search-turn-key') ?? '';
  const candidates = [key, ...(key.match(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/gi) ?? []), ...key.split(/[^\w-]+/)];
  return candidates.find(candidate => turns.has(candidate)) ?? null;
}

export class CodexDOM {
  constructor() {
    this.footers = new Set();
    this.actions = new Set();
  }
  composer() {
    const nodes = [...new Set([...document.querySelectorAll('[data-thread-find-composer]')]
      .filter(node => !node.matches('button,input,textarea') && visible(node)).map(composerRoot))];
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
    const responses = [...(container ?? document).querySelectorAll('[data-response-annotation-conversation]')].filter(visible);
    return uniqueThread(responses, 'data-response-annotation-conversation');
  }
  chatMode(composer) {
    return Boolean(composer?.matches('[data-chatgpt-composer]') ||
      [...(composer?.querySelectorAll('[data-chatgpt-composer]') ?? [])].some(visible));
  }
  scan(snapshot) {
    const composer = this.composer();
    const id = this.thread(composer);
    const turns = new Map((snapshot?.threadId === id ? snapshot.turns ?? [] : []).map(turn => [turn.id, turn]));
    const replies = new Map();
    const latest = new Map();
    for (const response of document.querySelectorAll('[data-response-annotation-conversation]')) {
      if (normalizeThreadId(response.getAttribute('data-response-annotation-conversation')) !== id || !visible(response)) continue;
      let root = response.closest('[data-content-search-turn-key]');
      let key = null;
      while (root && !(key = turnId(root, turns))) root = root.parentElement?.closest('[data-content-search-turn-key]');
      const turn = turns.get(key);
      if (!turn?.completed) continue;
      latest.set(key, {turn, response, root});
    }
    for (const [key, {turn, response, root}] of latest) {
      const actions = [...response.querySelectorAll('.turn-action-controls')].filter(visible).at(-1) ??
        [...root.querySelectorAll('.turn-action-controls')].filter(node => visible(node) &&
          !node.closest('[data-response-annotation-conversation]') &&
          Boolean(response.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)).at(-1);
      // 同一轮只保留最后一条原生回复的操作栏；操作栏稍后出现时会移动同一个统计节点。
      replies.set(key, { turn, parent: actions ?? response, inline: Boolean(actions) });
    }
    return { id, composer, chat: this.chatMode(composer), replies, quota: this.quotaMount() };
  }
  quotaMount() {
    const rail = [...document.querySelectorAll('[data-app-navigation-rail]')].find(visible);
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
  markActions(node) {
    node.classList.add('cu-action-row');
    this.actions.add(node);
  }
  reconcile() {
    for (const row of this.actions) {
      if (row.isConnected && row.querySelector('.cu-turn')) continue;
      row.classList.remove('cu-action-row');
      this.actions.delete(row);
    }
    for (const footer of this.footers) {
      if (footer.isConnected && footer.querySelector('.cu-strip')) continue;
      footer.classList.remove('cu-footer');
      footer.style.removeProperty('--cu-strip-height');
      this.footers.delete(footer);
    }
  }
  relevant(records) {
    return records.some(record => {
      const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
      if (target?.closest(OWN)) return false;
      if (record.type === 'attributes') {
        return !['hidden','aria-hidden','inert'].includes(record.attributeName) || structural(target);
      }
      const nodes=[...record.addedNodes,...record.removedNodes];
      if(nodes.some(structural))return true;
      // Reconcile native siblings of the strip without depending on periodic scans.
      return target?.matches('[data-thread-find-composer],[data-thread-scroll-footer],.turn-action-controls,[data-app-navigation-rail]')&&
        nodes.some(node=>node.nodeType===1&&!node.matches(OWN));
    });
  }
  dispose() {
    for (const footer of this.footers) {
      footer.classList.remove('cu-footer');
      footer.style.removeProperty('--cu-strip-height');
    }
    for (const row of this.actions) row.classList.remove('cu-action-row');
    this.footers.clear();
    this.actions.clear();
  }
}
