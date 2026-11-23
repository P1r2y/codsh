'use strict';

module.exports = async function retainedCache(win, snapshots, fixture) {
  const a = fixture.snapshot.threadId, b = '00000000-0000-4000-8000-000000000002';
  const total = 80;
  const evalPage = code => win.webContents.executeJavaScript(code);
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const waitFor = async expression => {
    for (let n=0; n<130; n++) {
      if (await evalPage(expression)) return;
      await delay(100);
    }
    throw Error('Retained page did not settle: ' + expression);
  };
  for (const id of [a,b]) {
    const snapshot = structuredClone(fixture.snapshot);
    snapshot.threadId = id;
    snapshot.turns = Array.from({length:total}, (_,i) => ({...snapshot.turns[0], id:'turn-'+i}));
    snapshot.turnCount = total;
    snapshot.revision = 'retained-'+id;
    snapshots.set(id,snapshot);
  }
  await evalPage(`(()=>{
    const main = document.querySelector('main.chat'), footer = document.querySelector('[data-thread-scroll-footer]');
    const template = main.querySelector('[data-content-search-turn-key]').cloneNode(true);
    template.querySelectorAll('.cu-turn').forEach(node => node.remove());
    const pane = document.createElement('section');
    main.before(pane); pane.append(main, footer); main.replaceChildren();
    const pane2 = pane.cloneNode(true);
    pane2.querySelectorAll('.cu-strip').forEach(node => node.remove()); pane.after(pane2);
    window.cachePanes = [pane,pane2];
    cachePanes.forEach((section,n) => {
      const id = [${JSON.stringify(a)},${JSON.stringify(b)}][n];
      section.hidden = n !== 0;
      section.querySelector('[data-above-composer-conversation-id]').setAttribute('data-above-composer-conversation-id',id);
      for (let i=0;i<${total};i++) {
        const row = template.cloneNode(true);
        row.dataset.contentSearchTurnKey = 'turn-'+i;
        row.querySelector('[data-response-annotation-conversation]').dataset.responseAnnotationConversation = id;
        section.querySelector('main').append(row);
      }
    });
    window.cacheSwitch = n => {cachePanes.forEach((p,i) => {p.hidden = i !== n;});};
    window.cacheReady = (n,id) => {
      const pane=cachePanes[n], groups=[...pane.querySelectorAll('.cu-turn')];
      return !pane.hidden && pane.querySelector('.cu-strip')?.dataset.cuThread===id && groups.length===${total} &&
        groups.every(g=>g.dataset.cuThread===id && g.dataset.cuTurn===g.closest('[data-content-search-turn-key]').dataset.contentSearchTurnKey);
    };
    document.dispatchEvent(new Event('visibilitychange'));
  })()`);
  const navigate = async (n,id) => {
    await evalPage(`cacheSwitch(${n})`);
    await waitFor(`cacheReady(${n},${JSON.stringify(id)})`);
  };
  const count = () => evalPage(`(()=>{document.dispatchEvent(new Event('count-cache-read'));return JSON.parse(document.documentElement.dataset.cacheCounts);})()`);
  const start = () => evalPage("document.dispatchEvent(new Event('count-cache-start'))");
  await waitFor(`cacheReady(0,${JSON.stringify(a)})`);
  await evalPage("window.cacheOriginal = new Map([...cachePanes[0].querySelectorAll('.cu-turn')].map(node=>[node.dataset.cuTurn,node]))");
  await navigate(1,b);
  await start(); await navigate(0,a); await delay(500);
  const revisit = await count();
  const reused = await evalPage("[...cachePanes[0].querySelectorAll('.cu-turn')].filter(n=>cacheOriginal.get(n.dataset.cuTurn)===n).length");
  await start();
  await evalPage(`(()=>{
    const row=cachePanes[0].querySelector('[data-content-search-turn-key="turn-3"] .turn-action-controls');
    const next=row.cloneNode(true); next.querySelector('.cu-turn')?.remove(); row.replaceWith(next);
  })()`);
  await waitFor("cachePanes[0].querySelector('[data-content-search-turn-key=\"turn-3\"] .turn-action-controls .cu-turn')");
  await delay(1500);
  const replaced = await count();
  await navigate(1,b);
  await evalPage(`(()=>{
    const old=cachePanes[0].querySelector('[data-content-search-turn-key="turn-3"]');
    const next=old.cloneNode(true); next.querySelector('.cu-turn')?.remove(); old.replaceWith(next);
  })()`);
  await start(); await navigate(0,a); await delay(450);
  const inactiveChanged = await count();
  await start();
  const updated = structuredClone(snapshots.get(a));
  updated.revision += '-updated';
  updated.turns[5].usage = {...updated.turns[5].usage, total_tokens:321000};
  snapshots.set(a,updated);
  await evalPage("document.dispatchEvent(new Event('visibilitychange'))");
  await waitFor(`cachePanes[0].querySelector('[data-content-search-turn-key="turn-5"] .cu-turn')?.textContent.includes('321K tok')`);
  const dataChanged = await count();
  const clean = await evalPage("cachePanes[1].querySelectorAll('.cu-turn').length===0 && !window.fixtureErrors.length");
  return {total,revisit,reused,replaced,inactiveChanged,dataChanged,checks:{
    warmHistory:revisit.history===0, warmActions:revisit.actions===0, reuseControls:reused===total,
    warmGeometry:revisit.measuredLabels===0,
    oneRow:replaced.history===0 && replaced.actions<=3,
    inactiveRow:inactiveChanged.history===0 && inactiveChanged.actions<=3,
    oneTurnUpdate:dataChanged.history===0 && dataChanged.actions===0 && dataChanged.measuredLabels<=3, clean
  }};
};
