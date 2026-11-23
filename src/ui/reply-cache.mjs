import protocol from '../protocol.cjs';
import { OWN, turnId, visible } from './dom.mjs';

const RESPONSE = '[data-response-annotation-conversation]';
const TURN = '[data-content-search-turn-key]';
const ACTION = '.turn-action-controls';
const SHELL = '[data-thread-find-composer],[data-app-navigation-rail]';
const MARKERS = [RESPONSE, ACTION, SHELL].join(',');

function lastVisible(nodes) {
  return nodes.findLast(visible);
}

function statsChanged(previous, next) {
  return previous?.usage?.total_tokens !== next?.usage?.total_tokens ||
    previous?.cacheHitPercent !== next?.cacheHitPercent ||
    previous?.estimatedGenerationTps !== next?.estimatedGenerationTps ||
    previous?.averageTps !== next?.averageTps;
}

class ConversationReplies {
  constructor(id, owners) {
    this.id = id;
    this.owners = owners;
    this.indexed = false;
    this.nodes = new Map();
    this.byTurn = new Map();
    this.unresolved = new Set();
    this.turns = new Map();
    this.groups = new Map();
    this.mounts = new Map();
    this.dirty = new Set();
    this.domRevision = 0;
  }

  invalidate(key) {
    if (key == null) return;
    this.mounts.delete(key);
    this.dirty.add(key);
    this.domRevision++;
  }

  remove(response) {
    const row = this.nodes.get(response);
    if (!row) return;
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
    this.remove(response);
    let root = response.closest(TURN);
    let key = null;
    while (root && !(key = turnId(root, this.turns))) {
      this.unresolved.add(response);
      root = root.parentElement?.closest(TURN);
    }
    if (!key) this.unresolved.add(response);
    const row = {response, root, key};
    this.nodes.set(response, row);
    if (key == null) return;
    if (!this.byTurn.has(key)) this.byTurn.set(key, new Set());
    this.byTurn.get(key).add(row);
    // Initial discovery runs newest first. An older alternative cannot displace an already chosen reply.
    if (fromInitialList && this.mounts.has(key)) {
      const chosen = this.mounts.get(key);
      if (chosen ? (response.compareDocumentPosition(chosen.response) & Node.DOCUMENT_POSITION_FOLLOWING) : !visible(response)) return;
    }
    this.invalidate(key);
  }

  setSnapshot(snapshot) {
    if (this.snapshot === snapshot) return;
    this.snapshot = snapshot;
    const previous = this.turns;
    this.turns = new Map((snapshot.turns ?? []).map(turn => [turn.id, turn]));
    const rebind = new Set();
    let added = false;
    for (const [id, turn] of this.turns) {
      const prior = previous.get(id);
      if (!prior) added = true;
      if (!this.byTurn.has(id) && !this.groups.has(id)) continue;
      if (prior?.completed !== turn.completed) this.invalidate(id);
      else if (statsChanged(prior, turn)) this.dirty.add(id);
    }
    for (const id of previous.keys()) {
      if (this.turns.has(id) || (!this.byTurn.has(id) && !this.groups.has(id))) continue;
      this.invalidate(id);
      for (const row of this.byTurn.get(id) ?? []) rebind.add(row.response);
    }
    if (added) for (const response of this.unresolved) rebind.add(response);
    for (const response of rebind) this.bind(response);
  }

  mountFor(key) {
    if (this.mounts.has(key)) return this.mounts.get(key);
    const rows = [...(this.byTurn.get(key) ?? [])];
    // Separate native replies may share one turn. Prefer the last visible one.
    if (rows.length > 1) rows.sort((a,b) =>
      a.response.compareDocumentPosition(b.response) & Node.DOCUMENT_POSITION_FOLLOWING ? 1 : -1);
    let mount = null;
    for (const row of rows) {
      const {root, response} = row;
      if (!response.isConnected || !visible(response)) continue;
      row.actions ??= [...response.querySelectorAll(ACTION)];
      let actions = lastVisible(row.actions);
      if (!actions) {
        row.siblings ??= [...root.querySelectorAll(ACTION)].filter(node =>
          !node.closest(RESPONSE) && (response.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING));
        actions = lastVisible(row.siblings);
      }
      const parent = actions ?? response;
      mount = {response, parent, inline:Boolean(actions), stillCurrent:() =>
        this.mounts.get(key) === mount && root.contains(response) && root.contains(parent) &&
        visible(response) && (!actions || visible(actions))};
      break;
    }
    this.mounts.set(key, mount);
    return mount;
  }

  restore() {
    for (const key of this.byTurn.keys()) this.dirty.add(key);
    for (const key of this.groups.keys()) this.dirty.add(key);
  }

  changeFor(key) {
    const turn = this.turns.get(key);
    return {key, turn, mount:turn?.completed ? this.mountFor(key) : null};
  }

  *changes() {
    // The first visit uses the same time budget as mounts. A switch can pause and resume this list.
    if (!this.indexed) {
      this.initialRows ??= Array.from(document.querySelectorAll(`[data-response-annotation-conversation="${this.id}" i]`));
      while (this.initialRows.length) {
        const response = this.initialRows.pop();
        if (!this.nodes.has(response) && response.isConnected &&
          protocol.normalizeThreadId(response.dataset.responseAnnotationConversation) === this.id) {
          this.bind(response, true);
          this.owners.set(response, this);
        }
        const key = this.nodes.get(response)?.key;
        yield this.dirty.delete(key) ? this.changeFor(key) : null;
      }
      this.initialRows = null;
      this.indexed = true;
    }
    for (const key of this.dirty) {
      this.dirty.delete(key);
      yield this.changeFor(key);
    }
  }
}

export class ReplyCache {
  constructor() {
    this.threads = new Map();
    this.owners = new WeakMap();
  }

  select(id, snapshot) {
    const thread = this.threads.get(id) ?? new ConversationReplies(id, this.owners);
    this.threads.delete(id);
    this.threads.set(id, thread);
    if (this.threads.size > 6) this.drop(this.threads.values().next().value);
    thread.setSnapshot(snapshot);
    return thread;
  }

  drop(thread) {
    for (const node of thread.nodes.keys()) this.owners.delete(node);
    for (const group of thread.groups.values()) group.dispose();
    this.threads.delete(thread.id);
  }

  visibility(scope) {
    if (!scope.firstElementChild && !scope.matches(RESPONSE + ',' + ACTION)) return;
    for (const thread of this.threads.values()) {
      for (const row of thread.nodes.values()) {
        if (scope.contains(row.response) || row.root?.contains(scope) &&
          (row.actions?.some(node => scope.contains(node)) || row.siblings?.some(node => scope.contains(node)))) {
          thread.invalidate(row.key);
        }
      }
    }
  }

  observe(records, active, dom) {
    const changed = new Set();
    const actionScopes = new Set();
    const visibilityScopes = new Set();
    const collect = (node, target) => {
      if (node.matches(RESPONSE) || this.owners.has(node)) changed.add(node);
      if (node.matches(ACTION)) {
        const scope = node.closest(RESPONSE) ?? target.closest(RESPONSE) ?? node.closest(TURN) ?? target.closest(TURN);
        if (scope) actionScopes.add(scope);
      }
      if (node.matches(SHELL)) dom.invalidateShell();
    };
    for (const record of records) {
      const target = record.target;
      if (target.nodeType !== 1 || target.closest(OWN)) continue;
      if (record.type === 'attributes') {
        switch (record.attributeName) {
          case 'data-response-annotation-conversation': changed.add(target); break;
          case 'data-content-search-turn-key':
            if (target.matches(RESPONSE)) changed.add(target);
            for (const node of target.querySelectorAll(RESPONSE)) changed.add(node);
            break;
          case 'data-thread-find-composer': case 'data-app-navigation-rail': dom.invalidateShell(); break;
          case 'hidden': case 'aria-hidden': case 'inert': visibilityScopes.add(target); break;
        }
        continue;
      }
      for (const nodes of [record.addedNodes, record.removedNodes]) for (const node of nodes) {
        if (node.nodeType !== 1) continue;
        if (node.matches(OWN)) {
          const key = node.dataset.cuTurn;
          if (!node.isConnected && active?.groups.get(key)?.node === node) active.invalidate(key);
          continue;
        }
        collect(node, target);
        if (node.firstElementChild) for (const child of node.querySelectorAll(MARKERS)) collect(child, target);
      }
    }
    for (const scope of actionScopes) {
      if (scope.matches(RESPONSE)) changed.add(scope);
      else for (const response of scope.querySelectorAll(RESPONSE)) changed.add(response);
    }
    for (const response of changed) {
      dom.responseChanged(response);
      const old = this.owners.get(response);
      const id = protocol.normalizeThreadId(response.dataset.responseAnnotationConversation);
      const next = response.isConnected ? this.threads.get(id) : null;
      if (old && old !== next) { old.remove(response); this.owners.delete(response); }
      if (next) { next.bind(response); this.owners.set(response, next); }
    }
    if (visibilityScopes.size) dom.fallbackThread = null;
    for (const scope of visibilityScopes) this.visibility(scope);
  }

  dispose() {
    for (const thread of this.threads.values()) this.drop(thread);
  }
}
