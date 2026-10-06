/** A stand-in for Web Audio that records what is scheduled and what is still connected. */
export class FakeParam {
  value = 0;
  calls: Array<{ method: string; value: number; time: number }> = [];
  constructor(private ctx: FakeContext) {}
  private note(method: string, value: number, time: number): this {
    this.calls.push({ method, value, time });
    this.ctx.scheduled.push({ method, value, time, at: this.ctx.currentTime });
    return this;
  }
  setValueAtTime(v: number, t: number): this { return this.note('setValueAtTime', v, t); }
  linearRampToValueAtTime(v: number, t: number): this { return this.note('linearRamp', v, t); }
  exponentialRampToValueAtTime(v: number, t: number): this { return this.note('exponentialRamp', v, t); }
  setTargetAtTime(v: number, t: number): this { return this.note('setTarget', v, t); }
  cancelScheduledValues(): this { return this; }
}

export class FakeNode {
  connected = 0;
  disconnected = false;
  started: number | null = null;
  stopped = false;
  type = '';
  buffer: unknown = null;
  loop = false;
  gain: FakeParam; frequency: FakeParam; detune: FakeParam; Q: FakeParam; pan: FakeParam; delayTime: FakeParam; threshold: FakeParam; ratio: FakeParam;
  constructor(public ctx: FakeContext, public kind: string) {
    const p = (): FakeParam => new FakeParam(ctx);
    this.gain = p(); this.frequency = p(); this.detune = p(); this.Q = p(); this.pan = p(); this.delayTime = p(); this.threshold = p(); this.ratio = p();
    ctx.created.push(this);
  }
  connect<T>(to: T): T { this.connected++; return to; }
  disconnect(): void { this.disconnected = true; }
  start(t = 0): void { this.started = t; this.ctx.starts.push({ time: t, at: this.ctx.currentTime }); }
  stop(): void { this.stopped = true; }
  setPeriodicWave(): void {}
}

export class FakeContext {
  currentTime = 0;
  sampleRate = 4000;
  state = 'running';
  created: FakeNode[] = [];
  scheduled: Array<{ method: string; value: number; time: number; at: number }> = [];
  starts: Array<{ time: number; at: number }> = [];
  resumed = 0;
  destination = new FakeNode(this, 'destination');
  constructor() { this.created = []; }
  private make(kind: string): FakeNode { return new FakeNode(this, kind); }
  createGain(): FakeNode { return this.make('gain'); }
  createOscillator(): FakeNode { return this.make('oscillator'); }
  createBiquadFilter(): FakeNode { return this.make('filter'); }
  createStereoPanner(): FakeNode { return this.make('panner'); }
  createConvolver(): FakeNode { return this.make('convolver'); }
  createDelay(): FakeNode { return this.make('delay'); }
  createDynamicsCompressor(): FakeNode { return this.make('compressor'); }
  createBufferSource(): FakeNode { return this.make('source'); }
  createPeriodicWave(): object { return {}; }
  createBuffer(channels: number, length: number): { getChannelData(c: number): Float32Array } {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { getChannelData: (c: number) => data[c] };
  }
  resume(): Promise<void> { this.resumed++; this.state = 'running'; return Promise.resolve(); }
  suspend(): Promise<void> { this.state = 'suspended'; return Promise.resolve(); }
  close(): Promise<void> { this.state = 'closed'; return Promise.resolve(); }
  get live(): FakeNode[] { return this.created.filter((n) => !n.disconnected); }
}
