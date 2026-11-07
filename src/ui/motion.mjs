const ease = 'cubic-bezier(.2,.8,.2,1)';

export class MetricMotion {
  constructor(node) {
    this.node = node;
    this.animations = new Map();
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
  update(previous, changed) {
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
      if (changed.has(button)) this.play(button.querySelector('.cu-metric-label'), [{opacity:.45}, {opacity:1}], 180);
    }
  }
  cancel() {
    for (const animation of this.animations.values()) animation.cancel();
    this.animations.clear();
  }
  dispose() {
    this.cancel();
    this.reduced.removeEventListener('change', this.onPreference);
  }
}
