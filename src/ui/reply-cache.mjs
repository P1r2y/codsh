import protocol from '../protocol.cjs';
import { OWN, turnId, visible } from './dom.mjs';

const RESPONSE = '[data-response-annotation-conversation]';
const TURN = '[data-content-search-turn-key]';
const ACTION = '.turn-action-controls';
const SHELL = '[data-thread-find-composer],[data-app-navigation-rail]';
const MARKERS = [RESPONSE, ACTION, SHELL].join(',');
const VIEWPORT_HISTORY_SIZE = 96;

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
  constructor(id, owners, onVisible) {
    this.id = id;
    this.owners = owners;
    this.onVisible = onVisible;
    this.nearby = new Set();
    this.streamRoots = new Set();
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

  watchViewport() {
    if (this.viewport || typeof IntersectionObserver !== 'function') return;
    this.viewport = new IntersectionObserver(entries => {
      let changed = false;
      for (const entry of entries) {
        const row = this.nodes.get(entry.target);
        if (!row) continue;
        if (!entry.isIntersecting) { this.nearby.delete(entry.target); continue; }
        if (this.nearby.has(entry.target)) continue;
        this.nearby.add(entry.target);
        if (row.key != null && this.turns.get(row.key)?.completed) {
          this.invalidate(row.key);
          changed = true;
        }
      }
      if (changed) this.onVisible(this);
    }, {rootMargin:'400px 0px', scrollMargin:'400px 0px'});
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
    const row = {response, root, key};
    this.nodes.set(response, row);
    if (!known) this.viewport?.observe(response);
    if (key == null) return;
    if (!this.byTurn.has(key)) this.byTurn.set(key, new Set());
    this.byTurn.get(key).add(row);
    // Initial discovery runs newest first. An older alternative cannot displace an already chosen reply.
    if (fromInitialList && this.mounts.has(key)) {
      const chosen = this.mounts.get(key);
      if (!chosen && this.viewport && !this.nearby.has(response)) return;
      if (chosen ? (response.compareDocumentPosition(chosen.response) & Node.DOCUMENT_POSITION_FOLLOWING) : !visible(response)) return;
    }
    this.invalidate(key);
  }

  setSnapshot(snapshot) {
    if (this.snapshot === snapshot) return;
    this.snapshot = snapshot;
    const previous = this.turns;
    this.turns = new Map((snapshot.turns ?? []).map(turn => [turn.id, turn]));
    const priorLive = this.liveId;
    const last = snapshot.turns?.at(-1);
    this.liveId = last && !last.completed ? last.id : null;
    if (this.liveId || this.turns.size >= VIEWPORT_HISTORY_SIZE) this.watchViewport();
    const rebind = new Set();
    let added = false;
    for (const [id, turn] of this.turns) {
      const prior = previous.get(id);
      if (!prior) added = true;
      if (!this.byTurn.has(id) && !this.groups.has(id)) continue;
      if (prior?.completed !== turn.completed) this.invalidate(id);
      else if (turn.completed && this.nearTurn(id) && statsChanged(prior, turn)) this.dirty.add(id);
    }
    for (const id of previous.keys()) {
      if (this.turns.has(id) || (!this.byTurn.has(id) && !this.groups.has(id))) continue;
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
      if (protocol.normalizeThreadId(response.dataset.responseAnnotationConversation) !== this.id) return false;
    } else if (!this.streamRoots.has(root) && !protocol.normalizeThreadId(this.liveId) &&
      ![...(this.byTurn.get(this.liveId) ?? [])].some(row => row.root === root)) return false;
    // A tool call can precede the first annotated message. Its native turn UUID still identifies it.
    if (!this.streamRoots.has(root)) {
      for (const previous of this.streamRoots) if (!previous.isConnected) this.streamRoots.delete(previous);
      this.streamRoots.add(root);
    }
    return true;
  }

  finishStream(key) {
    if (!this.streamRoots.size) return;
    for (const row of [...(this.byTurn.get(key) ?? [])]) {
      if (!row.response.isConnected || !row.root.contains(row.response)) {
        this.remove(row.response);
        if (this.owners.get(row.response) === this) this.owners.delete(row.response);
      }
    }
    for (const root of this.streamRoots) {
      if (!root.isConnected) continue;
      const responses = root.querySelectorAll(RESPONSE);
      const bind = response => {
        if (protocol.normalizeThreadId(response.dataset.responseAnnotationConversation) !== this.id) return;
        this.bind(response);
        this.owners.set(response, this);
      };
      if (root.matches(RESPONSE)) bind(root);
      for (const response of responses) bind(response);
    }
    this.streamRoots.clear();
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
      if (this.viewport && !this.nearby.has(response)) break;
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
    if (this.viewport) {
      for (const response of this.nearby) {
        const key=this.nodes.get(response)?.key;
        if (key != null) this.dirty.add(key);
      }
      return;
    }
    for (const key of this.byTurn.keys()) this.dirty.add(key);
    for (const key of this.groups.keys()) this.dirty.add(key);
  }

  changeFor(key) {
    const turn = this.turns.get(key);
    return {key, turn, mount:turn?.completed && this.nearTurn(key) ? this.mountFor(key) : null};
  }

  *pendingChanges() {
    for (const key of this.dirty) {
      this.dirty.delete(key);
      yield this.changeFor(key);
    }
  }

  *changes() {
    // The first visit uses the same time budget as mounts. A switch can pause and resume this list.
    if (!this.indexed) {
      this.initialRows ??= Array.from(document.querySelectorAll(`[data-response-annotation-conversation="${this.id}" i]`));
      let registered = 0;
      while (this.initialRows.length) {
        const response = this.initialRows.pop();
        if (!this.nodes.has(response) && response.isConnected &&
          protocol.normalizeThreadId(response.dataset.responseAnnotationConversation) === this.id) {
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
}

export class ReplyCache {
  constructor(onVisible = () => {}) {
    this.threads = new Map();
    this.owners = new WeakMap();
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
    if (!scope.firstElementChild && !scope.matches(RESPONSE + ',' + ACTION)) return;
    for (const thread of this.threads.values()) {
      const responses = thread.viewport ? thread.nearby : thread.nodes.keys();
      for (const response of responses) {
        const row = thread.nodes.get(response);
        if (scope.contains(row.response) || row.root?.contains(scope) &&
          (row.actions?.some(node => scope.contains(node)) || row.siblings?.some(node => scope.contains(node)))) {
          thread.invalidate(row.key);
        }
      }
    }
  }

  relevantDuringStream(record, active) {
    const target = record.target;
    if (target.nodeType !== 1 || target.closest(OWN)) return false;
    if (record.type === 'childList') {
      if (record.addedNodes.length <= 1 && record.removedNodes.length <= 1 &&
        record.addedNodes[0]?.nodeType !== 1 && record.removedNodes[0]?.nodeType !== 1) return false;
    } else if (!['aria-hidden','hidden','inert'].includes(record.attributeName)) return true;
    const response = target.closest(RESPONSE);
    const thread = response ? this.owners.get(response) ??
      this.threads.get(protocol.normalizeThreadId(response.dataset.responseAnnotationConversation)) : active;
    return !thread?.deferStreamMutation(target, response);
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
