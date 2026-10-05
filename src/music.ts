// A goofy, breakneck ragtime chase tune (an original, in the spirit of an old slapstick
// TV chase), synthesised live: honky sax lead, oom-pah tuba and piano, a tinny drum
// kit, and a slide whistle at the end of each chorus. No audio files.

/** 16 bars of eighth notes. '-' is a rest, '~' holds the previous note. */
const MELODY = [
  'D5 B4 D5 G5 F#5 G5 B5 G5', 'A5 G5 F#5 G5 D5 - B4 -',
  'C5 A4 C5 F#5 E5 F#5 A5 F#5', 'G5 F#5 E5 F#5 C5 - A4 -',
  'A4 C5 D5 F#5 A5 F#5 D5 C5', 'B4 C5 C#5 D5 E5 F#5 G5 A5',
  'B5 - G5 - D5 G5 B5 G5', 'G5 ~ ~ - G4 - - -',
  'F5 D5 B4 D5 F5 G5 F5 D5', 'E5 C5 G4 C5 E5 G5 E5 C5',
  'D#5 E5 G5 A5 G5 E5 C5 E5', 'D5 B4 G4 B4 D5 G5 D5 B4',
  'G#4 B4 D5 E5 G#5 E5 D5 B4', 'C#5 E5 G5 A5 G5 E5 C#5 A4',
  'D5 E5 F#5 G5 A5 B5 C6 C#6', 'D6 - B5 G5 D5 - G4 -',
].map((bar) => bar.split(' '));

/** Per bar: [bass on beat 1, bass on beat 3, the off-beat chord]. */
const HARMONY: [string, string, string[]][] = [
  ['G2', 'D2', ['G3', 'B3', 'D4']], ['G2', 'D2', ['G3', 'B3', 'D4']],
  ['D2', 'A1', ['F#3', 'A3', 'C4']], ['D2', 'A1', ['F#3', 'A3', 'C4']],
  ['D2', 'A1', ['F#3', 'A3', 'C4']], ['D2', 'F#2', ['F#3', 'A3', 'C4']],
  ['G2', 'D2', ['G3', 'B3', 'D4']], ['G2', 'B1', ['G3', 'B3', 'D4']],
  ['G2', 'F2', ['F3', 'B3', 'D4']], ['C2', 'G2', ['G3', 'C4', 'E4']],
  ['C2', 'G1', ['G3', 'C4', 'E4']], ['G2', 'D2', ['G3', 'B3', 'D4']],
  ['E2', 'B1', ['G#3', 'B3', 'D4']], ['A1', 'E2', ['G3', 'C#4', 'E4']],
  ['D2', 'A1', ['F#3', 'A3', 'C4']], ['G2', 'D2', ['G3', 'B3', 'D4']],
];

const STEPS = MELODY.length * 8;
const BASE_BPM = 168;
const NAMES: Record<string, number> = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };

function freq(note: string): number {
  const m = /^([A-G]#?)(\d)$/.exec(note)!;
  const midi = NAMES[m[1]] + (Number(m[2]) + 1) * 12;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export class Music {
  enabled = true;
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private step = 0;
  private nextTime = 0;
  private bpm = BASE_BPM;
  /** Slow-mo: everything drags, tempo and pitch, like a tape running down. */
  private slow = false;

  /** Call from a click or key press (browsers block audio until then). */
  start(): void {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.out = this.ctx.createGain();
      this.out.gain.value = this.enabled ? 0.28 : 0;
      this.out.connect(this.ctx.destination);
      const n = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, n, n);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    }
    void this.ctx.resume();
    if (this.timer) return;
    this.nextTime = this.ctx.currentTime + 0.08;
    this.timer = setInterval(() => this.schedule(), 25);
  }

  toggle(): void {
    this.enabled = !this.enabled;
    if (this.ctx && this.out) this.out.gain.setTargetAtTime(this.enabled && !this.ducked ? 0.28 : 0, this.ctx.currentTime, 0.05);
  }

  setSlow(on: boolean): void {
    this.slow = on;
  }

  /** Drop the band out (for the ascension) or bring it back in. */
  duck(on: boolean): void {
    if (this.ctx && this.out) this.out.gain.setTargetAtTime(this.enabled && !on ? 0.28 : 0, this.ctx.currentTime, 0.3);
    this.ducked = on;
  }
  private ducked = false;

  /** A chase is on: even more frantic. */
  setChase(on: boolean): void {
    this.chase = on;
  }
  private chase = false;

  private get tempo(): number {
    return this.bpm * (this.slow ? 0.55 : 1) * (this.chase ? 1.25 : 1);
  }

  private pitch(f: number): number {
    return f * (this.slow ? 0.75 : 1);
  }

  /** It gets more frantic every level. */
  setLevel(level: number): void {
    this.bpm = BASE_BPM * (1 + 0.06 * (level - 1));
  }

  /** Queue up everything due in the next 150 ms. */
  private schedule(): void {
    const ctx = this.ctx!;
    while (this.nextTime < ctx.currentTime + 0.15) {
      this.playStep(this.step, this.nextTime);
      this.nextTime += 60 / this.tempo / 2;
      this.step = (this.step + 1) % STEPS;
    }
  }

  private playStep(step: number, t: number): void {
    const bar = Math.floor(step / 8), i = step % 8;
    const eighth = 60 / this.tempo / 2;

    const note = MELODY[bar][i];
    if (note !== '-' && note !== '~') {
      let len = 1;
      while (MELODY[bar][i + len] === '~') len++;
      this.sax(t, this.pitch(freq(note)), eighth * (len - 0.25));
    }

    const [oom, oom2, chord] = HARMONY[bar];
    if (i === 0) this.tuba(t, this.pitch(freq(oom)), eighth * 1.6);
    if (i === 4) this.tuba(t, this.pitch(freq(oom2)), eighth * 1.6);
    if (i === 2 || i === 6) for (const n of chord) this.pah(t, this.pitch(freq(n)), eighth * 0.7);

    if (i === 0 || i === 4) this.kick(t);
    if (i === 2 || i === 6) this.snare(t);
    this.hat(t, i % 2 ? 0.05 : 0.09);
    if (bar === MELODY.length - 1 && i === 4) this.slideWhistle(t, eighth * 4);
  }

  // ---- instruments ---------------------------------------------------------------

  /** Honky sax: buzzy saw + square, scooped up into pitch, with a little vibrato. */
  private sax(t: number, f: number, dur: number): void {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.32, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.18, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 4;
    filter.frequency.setValueAtTime(900, t);
    filter.frequency.exponentialRampToValueAtTime(3200, t + 0.04);
    filter.frequency.exponentialRampToValueAtTime(1400, t + dur);
    const vib = ctx.createOscillator();
    vib.frequency.value = 6.5;
    const vibDepth = ctx.createGain();
    vibDepth.gain.value = f * 0.012;
    vib.connect(vibDepth);
    for (const [type, level] of [['sawtooth', 0.6], ['square', 0.35]] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f * 0.94, t); // scoop up from a touch flat
      o.frequency.exponentialRampToValueAtTime(f, t + 0.035);
      vibDepth.connect(o.frequency);
      const lv = ctx.createGain();
      lv.gain.value = level;
      o.connect(lv).connect(filter);
      o.start(t);
      o.stop(t + dur + 0.02);
    }
    vib.start(t);
    vib.stop(t + dur + 0.02);
    filter.connect(g).connect(this.out!);
  }

  /** Oom: a round, slightly blatty tuba note. */
  private tuba(t: number, f: number, dur: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(f * 1.03, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.03);
    const sq = ctx.createOscillator();
    sq.type = 'square';
    sq.frequency.value = f;
    const sqLevel = ctx.createGain();
    sqLevel.gain.value = 0.12;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.55, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 700;
    o.connect(g);
    sq.connect(sqLevel).connect(g);
    g.connect(filter).connect(this.out!);
    for (const osc of [o, sq]) {
      osc.start(t);
      osc.stop(t + dur + 0.02);
    }
  }

  /** Pah: a plunky honky-tonk piano stab (two slightly detuned strings). */
  private pah(t: number, f: number, dur: number): void {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.09, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 2400;
    for (const detune of [-9, 9]) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      o.detune.value = detune;
      o.connect(filter);
      o.start(t);
      o.stop(t + dur + 0.02);
    }
    filter.connect(g).connect(this.out!);
  }

  private kick(t: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.1);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    o.connect(g).connect(this.out!);
    o.start(t);
    o.stop(t + 0.16);
  }

  private noiseHit(t: number, dur: number, gain: number, type: BiquadFilterType, f: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = f;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(g).connect(this.out!);
    src.start(t, Math.random() * 0.5, dur + 0.02);
  }

  private snare(t: number): void {
    this.noiseHit(t, 0.12, 0.28, 'bandpass', 1800);
  }

  private hat(t: number, gain: number): void {
    this.noiseHit(t, 0.03, gain, 'highpass', 7000);
  }

  /** Wheee-oop: down then back up, to wrap up each chorus. */
  private slideWhistle(t: number, dur: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(1800, t);
    o.frequency.exponentialRampToValueAtTime(500, t + dur * 0.55);
    o.frequency.exponentialRampToValueAtTime(2200, t + dur);
    const vib = ctx.createOscillator();
    vib.frequency.value = 9;
    const vg = ctx.createGain();
    vg.gain.value = 25;
    vib.connect(vg).connect(o.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.05);
    g.gain.setValueAtTime(0.16, t + dur * 0.9);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.out!);
    for (const osc of [o, vib]) {
      osc.start(t);
      osc.stop(t + dur + 0.02);
    }
  }
}
