(function (root) {
  'use strict';
  // One writer per form: coalesce typing and serialize changes made during a save.
  class AutoSaveQueue {
    constructor(write, { delay = 700, onState = () => {} } = {}) {
      this.write = write; this.delay = delay; this.onState = onState;
      this.pending = undefined; this.hasPending = false; this.running = null; this.timer = null;
    }
    schedule(value) {
      this.pending = value; this.hasPending = true;
      clearTimeout(this.timer);
      this.onState('pending');
      this.timer = setTimeout(() => this.flush(), this.delay);
    }
    cancelPending() { clearTimeout(this.timer); this.timer = null; this.pending = undefined; this.hasPending = false; }
    async flush() {
      clearTimeout(this.timer); this.timer = null;
      if (this.running) { await this.running; return this.hasPending ? this.flush() : true; }
      if (!this.hasPending) return true;
      const value = this.pending;
      this.pending = undefined; this.hasPending = false;
      this.onState('saving');
      this.running = (async () => {
        try {
          const result = await this.write(value);
          if (!this.hasPending) this.onState(result === false ? 'waiting' : 'saved');
          return result !== false;
        } catch (error) { this.onState('error', error); return false; }
      })();
      const success = await this.running;
      this.running = null;
      return this.hasPending ? this.flush() : success;
    }
  }
  if (typeof module === 'object' && module.exports) module.exports = { AutoSaveQueue };
  else root.AutoSaveQueue = AutoSaveQueue;
})(typeof window === 'object' ? window : globalThis);
