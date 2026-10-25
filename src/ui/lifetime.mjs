export class Lifetime {
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
  own(dispose) {
    this.cleanup.push(dispose);
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.abort.abort();
    for (const dispose of this.cleanup.reverse()) dispose();
    this.cleanup.length = 0;
  }
}
