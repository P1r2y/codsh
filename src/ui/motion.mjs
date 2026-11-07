const ease = 'cubic-bezier(.2,.8,.2,1)';

export function numericParts(text) {
  return text.split(/(\d+(?:,\d{3})*(?:\.\d+)?)/g);
}

export function numericTransition(previous, next) {
  const before = numericParts(previous), after = numericParts(next);
  if (before.length !== after.length || before.some((part, index) => index % 2 === 0 && part !== after[index])) return [];
  return after.flatMap((target, index) => {
    if (index % 2 === 0 || target === before[index] || target.length !== before[index].length) return [];
    const from = Number(before[index].replaceAll(',', '')), to = Number(target.replaceAll(',', ''));
    const precision = target.split('.')[1]?.length ?? 0;
    const oldPrecision = before[index].split('.')[1]?.length ?? 0;
    if (!Number.isFinite(from) || !Number.isFinite(to) || precision !== oldPrecision || target.includes(',') !== before[index].includes(',')) return [];
    return [{index, from, to, target, format:value => value.toLocaleString('en-US', {
      useGrouping:target.includes(','), minimumFractionDigits:precision, maximumFractionDigits:precision
    })}];
  });
}

export class MetricMotion {
  constructor(node) {
    this.node = node;
    this.animations = new Map();
    this.numbers = new Map();
    this.frame = null;
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)');
    this.onPreference = () => this.cancel();
    this.reduced.addEventListener('change', this.onPreference);
  }
  play(node, frames, duration = 220) {
    this.animations.get(node)?.cancel();
    if (this.reduced.matches || !node.isConnected) return;
    const animation = node.animate(frames, {duration, easing:ease});
    this.animations.set(node, animation);
    const done = () => {
      if (this.animations.get(node) === animation) this.animations.delete(node);
    };
    animation.addEventListener('finish', done, {once:true});
    animation.addEventListener('cancel', done, {once:true});
  }
  capture() {
    const origin = this.node.getBoundingClientRect();
    return new Map([...this.node.children].map(node => {
      const rect = node.getBoundingClientRect();
      return [node, {x:rect.x-origin.x, y:rect.y-origin.y}];
    }));
  }
  enter() {
    this.play(this.node, [{opacity:0, transform:'translateY(4px)'}, {opacity:1, transform:'none'}]);
  }
  text(label, text) {
    if (label.dataset.cuText === text) return false;
    const previous = label.textContent, initialized = label.dataset.cuText !== undefined;
    this.finishNumbers(label, false);
    label.dataset.cuText = text;
    const parts = numericParts(text), nodes = parts.map((part, index) => {
      if (index % 2 === 0) return document.createTextNode(part);
      const node = document.createElement('span');node.className='cu-number';node.textContent=part;return node;
    });
    label.replaceChildren(...nodes);
    const transitions = initialized && !this.reduced.matches ? numericTransition(previous, text) : [];
    if (transitions.length) {
      const values = transitions.map(transition => {
        const node = nodes[transition.index];node.dataset.cuTween='';
        return {...transition,node};
      });
      this.numbers.set(label, {values, started:null});
      this.schedule();
    }
    return previous !== text;
  }
  schedule() {
    if (this.frame !== null || !this.numbers.size) return;
    this.frame = requestAnimationFrame(now => {
      this.frame = null;
      for (const [label, job] of this.numbers) {
        job.started ??= now;
        const progress = Math.min(1, Math.max(0, (now-job.started)/220));
        const amount = 1-Math.pow(1-progress, 3);
        for (const value of job.values) {
          const text = value.format(value.from+(value.to-value.from)*amount);
          if (value.node.textContent !== text) value.node.textContent=text;
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
      if (settle) value.node.textContent=value.target;
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
        this.play(button, [{opacity:0, transform:'translateY(3px)'}, {opacity:1, transform:'none'}]);
        continue;
      }
      const x = old.x-position.x, y = old.y-position.y;
      if (Math.abs(x) > .5 || Math.abs(y) > .5) {
        this.play(button, [{transform:`translate(${x}px,${y}px)`}, {transform:'none'}]);
      }
    }
  }
  cancel() {
    for (const animation of this.animations.values()) animation.cancel();
    this.animations.clear();
    cancelAnimationFrame(this.frame);this.frame=null;
    for (const label of this.numbers.keys()) this.finishNumbers(label);
  }
  dispose() {
    this.cancel();
    this.reduced.removeEventListener('change', this.onPreference);
  }
}
