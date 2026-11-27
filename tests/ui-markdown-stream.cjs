'use strict';

// Only the plugin runs in this isolated world. Include detached highlighting trees in the count.
const instrumentation = `(() => {
  let scans = null;
  for (const method of ['querySelector', 'querySelectorAll']) {
    const original = Element.prototype[method];
    Element.prototype[method] = function(selector) {
      if (scans !== null && selector.includes('data-response-annotation-conversation') &&
        this.closest('[data-fixture-markdown],[data-fixture-highlight]')) scans++;
      return original.call(this, selector);
    };
  }
  document.addEventListener('start-output-count', () => { scans = 0; });
  document.addEventListener('read-output-count', () => {
    document.documentElement.dataset.fixtureScans = String(scans);
    scans = null;
  });
})();\n`;

function prepareOutput(threadId, turnId) {
  const style = document.createElement('style');
  style.textContent = `
    :root { --motion-fade-in: fixture-word; }
    @keyframes fixture-word { from { opacity: 0 } to { opacity: 1 } }
    @keyframes fixture-marker { from { color: transparent } }
    @keyframes fixture-widget { to { transform: rotate(360deg) } }
    [data-markdown-animated] .word { opacity: 1; animation: var(--motion-fade-in) .3s ease both; }
    [data-markdown-animated] li::marker { animation: fixture-marker .3s ease forwards; }
    .fixture-widget { animation: fixture-widget 2s infinite; }
  `;
  document.head.append(style);
  const row = document.createElement('section');
  row.dataset.contentSearchTurnKey = turnId;
  row.innerHTML = `<div data-markdown-text-style="user-message" data-markdown-animated><span class="word">user</span></div>
    <div class="response"><div data-fixture-markdown data-markdown-text-style="assistant-message" data-markdown-animated>
      <p></p><pre><code></code></pre><ul></ul><span class="fixture-widget"></span>
    </div></div>`;
  row.querySelector('.response').dataset.responseAnnotationConversation = threadId;
  document.querySelector('main.chat').append(row);
}

async function streamOutput(batches) {
  const body = document.querySelector('[data-fixture-markdown]');
  const paragraph = body.querySelector('p'), code = body.querySelector('code'), list = body.querySelector('ul');
  const word = text => {
    const span = document.createElement('span');
    span.className = 'word'; span.textContent = text;
    return span;
  };
  document.dispatchEvent(new Event('start-output-count'));
  const expected = [];
  for (let i = 0; i < batches; i++) {
    const words = ['输出 ', String(i), ' '];
    paragraph.append(...words.map(word));
    expected.push(...words);
    const highlight = document.createElement('span');
    highlight.dataset.fixtureHighlight = '';
    const prefix = document.createElement('span');
    prefix.textContent = 'const step = ';
    highlight.append(prefix, document.createTextNode(String(i)));
    code.replaceChildren(highlight);
    if (i % 8 === 0) {
      const item = document.createElement('li');
      item.append(word('列表项')); list.append(item);
    }
    await new Promise(resolve => setTimeout(resolve, 12));
  }
  document.dispatchEvent(new Event('read-output-count'));
  const range = document.createRange();
  range.selectNodeContents(paragraph);
  const animations = body.getAnimations({subtree:true}).filter(a => a.animationName === 'fixture-word').length;
  return {
    batches, words:body.querySelectorAll('.word').length, animations,
    scans:Number(document.documentElement.dataset.fixtureScans),
    markerAnimation:getComputedStyle(list.firstElementChild, '::marker').animationName,
    userAnimation:getComputedStyle(document.querySelector('[data-markdown-text-style="user-message"] .word')).animationName,
    widgetAnimation:getComputedStyle(body.querySelector('.fixture-widget')).animationName,
    textIntact:range.toString() === expected.join('') && code.textContent === 'const step = ' + (batches - 1)
  };
}

async function markdownStream(win, snapshots, {snapshot}) {
  const page = script => win.webContents.executeJavaScript(script);
  const turnId = '11111111-0000-4000-8000-000000000009';
  await page('(' + prepareOutput + ')(' + JSON.stringify(snapshot.threadId) + ',' + JSON.stringify(turnId) + ')');
  const sample = await page('(' + streamOutput + ')(48)');
  // The renderer can finish a complete answer before its first usage record arrives.
  const row = 'document.querySelector(' + JSON.stringify('[data-content-search-turn-key="' + turnId + '"]') + ')';
  const nested = '<span><span data-fixture-final data-response-annotation-conversation="' + snapshot.threadId + '">end</span></span>';
  await page(row + '.querySelector("p").insertAdjacentHTML("beforeend", ' + JSON.stringify(nested) + ')');
  const turn = {...snapshot.turns.at(-1), id:turnId, completed:true};
  snapshots.set(snapshot.threadId, {...snapshot, revision:'markdown-done', turns:[...snapshot.turns, turn]});
  const ready = async selector => {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      if (await page(row + '.querySelector(' + JSON.stringify(selector) + ') !== null')) return true;
      await new Promise(resolve => setTimeout(resolve, 80));
    }
    return false;
  };
  const selector = '.cu-turn[data-cu-turn="' + turnId + '"]';
  const completed = await ready('[data-fixture-final] > ' + selector);
  // An opaque embedded control can arrive later, even when the native row is nested in the body.
  await page(row + '.querySelector("[data-fixture-final]").insertAdjacentHTML("beforeend", ' +
    JSON.stringify('<div><div class="turn-action-controls"><button aria-label="复制">复制</button></div></div>') + ')');
  const mounted = await ready('.turn-action-controls > ' + selector);
  return {sample, checks:{
    noContentScans:sample.scans === 0, noWordAnimations:sample.animations === 0,
    noMarkerFade:sample.markerAnimation === 'none', userMotion:sample.userAnimation === 'fixture-word',
    widgetMotion:sample.widgetAnimation === 'fixture-widget', textIntact:sample.textIntact,
    completed, mounted, noErrors:await page('window.fixtureErrors.length === 0')
  }};
}

module.exports = {instrumentation, markdownStream};
