import protocol from '../protocol.cjs';

const { normalizeThreadId } = protocol;
const OWN = '.cu-strip,.cu-turn,.cu-ring,.cu-tooltip,.cu-panel,#codex-usage-ui-style';

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
  scan(snapshot) {
    const composer = this.composer();
    const id = this.thread(composer);
    const turns = new Map((snapshot?.threadId === id ? snapshot.turns ?? [] : []).map(turn => [turn.id, turn]));
    const replies = new Map();
    for (const response of document.querySelectorAll('[data-response-annotation-conversation]')) {
      if (!visible(response) || normalizeThreadId(response.getAttribute('data-response-annotation-conversation')) !== id) continue;
      let root = response.closest('[data-content-search-turn-key]');
      let key = null;
      while (root && !(key = turnId(root, turns))) root = root.parentElement?.closest('[data-content-search-turn-key]');
      const turn = turns.get(key);
      if (!turn?.completed) continue;
      const actions = [...response.querySelectorAll('.turn-action-controls')].filter(visible).at(-1) ??
        [...root.querySelectorAll('.turn-action-controls')].filter(node => visible(node) &&
          !node.closest('[data-response-annotation-conversation]') &&
          Boolean(response.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)).at(-1);
      // 同一轮只保留最后一条原生回复的操作栏；操作栏稍后出现时会移动同一个统计节点。
      replies.set(key, { turn, parent: actions ?? response, inline: Boolean(actions) });
    }
    return { id, composer, replies, quota: this.quotaMount() };
  }
  quotaMount() {
    const rail = [...document.querySelectorAll('[data-app-navigation-rail]')].find(visible);
    if (!rail) return null;
    const buttons = [...rail.querySelectorAll('button,[role="button"]')].filter(node => !node.closest(OWN));
    let anchor = buttons.find(node => /^(下载|Downloads?)(?:\b|$)|查看下载/i.test(node.getAttribute('aria-label') ?? node.getAttribute('title') ?? '')) ?? buttons.at(-1);
    if (!anchor) return { parent: rail, before: null };
    while (anchor.parentElement !== rail && anchor.parentElement && !/column/.test(getComputedStyle(anchor.parentElement).flexDirection)) anchor = anchor.parentElement;
    return { parent: anchor.parentElement, before: anchor };
  }
  alignComposer(composer, remeasure = false) {
    const footer = composer?.closest('[data-thread-scroll-footer]');
    if (!footer || this.footers.has(footer) && !remeasure) return;
    footer.classList.remove('cu-footer');
    const inset = parseFloat(getComputedStyle(footer).paddingBottom) || 0;
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
    return records.some(record => !(record.target.nodeType === 1 && record.target.closest(OWN)));
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
