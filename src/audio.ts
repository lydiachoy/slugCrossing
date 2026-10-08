// Synthesised sound effects (Web Audio), so the game ships no audio files.

export class Sfx {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  enabled = true;

  /** Browsers only allow sound after a click or key press, so call this from one. */
  unlock(): void {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.out = this.ctx.createGain();
      this.out.gain.value = 0.6;
      this.out.connect(this.ctx.destination);
      const n = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, n, n);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    }
    void this.ctx.resume();
  }

  private ready(): AudioContext | null {
    return this.enabled && this.ctx?.state === 'running' ? this.ctx : null;
  }

  /** A burst of filtered noise with an envelope. */
  private hiss(t: number, dur: number, gain: number, type: BiquadFilterType, f0: number, f1: number, q = 1, pan = 0): void {
    const ctx = this.ctx!;
    t = Math.max(t, ctx.currentTime); // (random jitter mustn't schedule it in the past)
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true; // the noise sample is 1 s long; longer hisses (rumbles, crowds) need it to repeat
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(f0, t);
    filter.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.03, dur / 3));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    src.connect(filter).connect(g).connect(p).connect(this.out!);
    src.start(t, Math.random() * 0.5, dur + 0.05);
  }

  private tone(t: number, dur: number, gain: number, type: OscillatorType, f0: number, f1: number): void {
    const ctx = this.ctx!;
    t = Math.max(t, ctx.currentTime);
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.out!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** A vehicle tearing past: a Doppler-ish swoop, louder the closer it was. */
  whoosh(closeness: number, pan: number): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    this.hiss(t, 0.35, 0.15 + 0.5 * closeness, 'bandpass', 1800, 400, 0.8, pan);
    this.tone(t, 0.3, 0.04 + 0.08 * closeness, 'sawtooth', 220, 110);
  }

  squish(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    this.hiss(t, 0.12, 0.9, 'lowpass', 900, 200, 2); // tyre thump
    this.tone(t, 0.08, 0.5, 'square', 90, 45);
    this.hiss(t + 0.05, 0.4, 0.6, 'bandpass', 600, 180, 6); // splorch
    this.tone(t + 0.06, 0.35, 0.25, 'sine', 300, 70);
  }

  dried(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    this.hiss(t, 1.2, 0.35, 'highpass', 5000, 1500, 0.7); // sizzle
    this.tone(t, 1.1, 0.12, 'triangle', 520, 130); // sad slide
  }

  /** A big, noisy, open-mouthed chomp-chomp-chomp lasting `secs`, then a satisfied "mmm". */
  munch(secs: number, loud = true): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    const v = loud ? 1 : 0.4;
    for (let k = 0; k * 0.31 < secs - 0.4; k++) {
      const at = t + k * 0.31 + (Math.random() - 0.5) * 0.03;
      this.hiss(at, 0.09, 0.9 * v, 'bandpass', 2600, 1100, 2.5); // crunch
      this.hiss(at + 0.04, 0.07, 0.6 * v, 'bandpass', 1800, 900, 3);
      this.tone(at, 0.08, 0.35 * v, 'square', 150, 70); // jaw thump
      this.hiss(at + 0.12, 0.1, 0.25 * v, 'lowpass', 900, 400, 1); // squelch
    }
    this.tone(t + secs - 0.45, 0.4, 0.2 * v, 'triangle', 300, 420); // mmm!
  }

  /** Across a lane: a small bright ding. */
  ding(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    this.tone(t, 0.35, 0.12, 'sine', 1568, 1568);
    this.tone(t, 0.2, 0.04, 'sine', 3136, 3136);
  }

  /** Slow-mo grabbed: a tape-stop "wuuuhh", winding down. */
  slowDown(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    this.tone(t, 0.9, 0.2, 'sawtooth', 700, 90);
    this.tone(t, 0.9, 0.12, 'square', 350, 45);
  }

  /** Slow-mo over: winding back up to speed. */
  speedUp(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    this.tone(t, 0.6, 0.16, 'sawtooth', 90, 700);
  }

  /** 1UP: a quick, bright, rising jingle. */
  oneUp(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    [660, 784, 1319, 1047, 1175, 1568].forEach((f, i) => this.tone(t + i * 0.075, 0.12, 0.15, 'square', f, f));
  }

  /** A rival bounced off the player: BOINNNG. */
  boing(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(180, t);
    o.frequency.exponentialRampToValueAtTime(520, t + 0.12);
    const wob = ctx.createOscillator();
    wob.frequency.value = 22;
    const wg = ctx.createGain();
    wg.gain.setValueAtTime(90, t);
    wg.gain.exponentialRampToValueAtTime(1, t + 0.7);
    wob.connect(wg).connect(o.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.75);
    o.connect(g).connect(this.out!);
    for (const osc of [o, wob]) {
      osc.start(t);
      osc.stop(t + 0.8);
    }
    this.tone(t + 0.15, 0.5, 0.08, 'sine', 900, 2400); // whee
  }

  /** The salt truck's air horn. */
  horn(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    for (const [at, len] of [[0, 0.22], [0.3, 0.5]]) {
      this.tone(t + at, len, 0.14, 'sawtooth', 233, 228);
      this.tone(t + at, len, 0.1, 'sawtooth', 294, 290);
    }
  }

  /** Salt: a fizzing hiss and a wilting slide. */
  salted(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    this.hiss(t, 0.7, 0.5, 'highpass', 7000, 2500, 0.8);
    this.hiss(t + 0.05, 0.5, 0.3, 'bandpass', 3000, 1200, 4);
    this.tone(t + 0.1, 0.6, 0.12, 'triangle', 700, 160);
  }

  /** The bird's dive: a falling, raspy SKREEEE. */
  screech(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    this.tone(t, 0.75, 0.16, 'sawtooth', 2600, 1400);
    this.tone(t, 0.75, 0.08, 'square', 2700, 1500);
    this.hiss(t, 0.7, 0.25, 'bandpass', 3500, 2000, 3);
  }

  /** Snatched up: a flap and a startled "yoink". */
  grabbed(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    for (let i = 0; i < 3; i++) this.hiss(t + i * 0.09, 0.07, 0.4, 'lowpass', 900, 300, 1);
    this.tone(t + 0.05, 0.25, 0.18, 'square', 300, 900);
  }

  /** Each wriggle: a squeak that climbs as the slug gets closer to breaking free. */
  squeak(progress: number): void {
    const ctx = this.ready();
    if (!ctx) return;
    const f = 500 + progress * 900;
    this.tone(ctx.currentTime, 0.07, 0.12, 'square', f, f * 1.3);
  }

  /** Let go at the checkpoint. */
  wheee(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    this.tone(t, 0.6, 0.14, 'sine', 600, 1500);
    this.tone(t + 0.2, 0.5, 0.1, 'triangle', 900, 1800);
  }

  /** Eaten: GULP, and a burp. */
  gulp(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime + 0.6;
    this.tone(t, 0.25, 0.4, 'sine', 320, 70);
    this.hiss(t, 0.15, 0.3, 'lowpass', 600, 200, 2);
    this.tone(t + 0.45, 0.35, 0.2, 'sawtooth', 110, 80);
  }

  /** The heavens open: a swelling choir and a harp glissando. */
  choir(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    // Harp: a quick run up a major scale.
    [523, 587, 659, 784, 880, 1047, 1175, 1319, 1568, 1760, 2093].forEach((f, i) => this.tone(t + i * 0.05, 0.6, 0.06, 'triangle', f, f));
    // Choir: an "aah" chord, swelling for the shell's descent.
    for (const [f, d] of [[262, 0], [330, 0.1], [392, 0.2], [523, 0.3], [659, 0.4]]) {
      for (const detune of [-6, 6]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f;
        o.detune.value = detune;
        const vowel = ctx.createBiquadFilter();
        vowel.type = 'bandpass';
        vowel.frequency.value = 800; // an "ah" formant
        vowel.Q.value = 1.5;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t + d);
        g.gain.exponentialRampToValueAtTime(0.05, t + d + 1.2);
        g.gain.setValueAtTime(0.05, t + 2.4);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 4.2);
        o.connect(vowel).connect(g).connect(this.out!);
        o.start(t + d);
        o.stop(t + 4.3);
      }
    }
  }

  /** The shell lands: a big bright bell. */
  bell(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    for (const [f, g] of [[784, 0.3], [1568, 0.15], [2352, 0.08], [3136, 0.05]]) this.tone(t, 2.2, g, 'sine', f, f);
    this.hiss(t, 0.6, 0.2, 'highpass', 9000, 6000, 0.7); // shimmer
  }

  /** A crunchy veggie bite. */
  crunch(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    this.hiss(t, 0.08, 0.55, 'bandpass', 3000, 1500, 2.5);
    this.tone(t, 0.06, 0.2, 'square', 160, 80);
  }

  /** Finished a vegetable: a pop and a happy "mm!" */
  gobble(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    this.tone(t, 0.12, 0.25, 'sine', 400, 1200);
    this.tone(t + 0.12, 0.25, 0.15, 'triangle', 500, 650);
  }

  /** The gardener spots you: a brassy alarm stab. */
  alarm(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    for (const [at, f] of [[0, 523], [0.14, 784]]) {
      this.tone(t + at, 0.22, 0.2, 'sawtooth', f, f);
      this.tone(t + at, 0.22, 0.14, 'square', f * 1.5, f * 1.5);
    }
  }

  /** Hurled off the map: a rising "yeeeet" and a whoosh. */
  yeet(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    this.tone(t, 0.7, 0.18, 'square', 300, 1400);
    this.hiss(t, 0.8, 0.4, 'bandpass', 600, 3000, 1);
  }

  /** Back again behind a rock. */
  pop(): void {
    const ctx = this.ready();
    if (!ctx) return;
    this.tone(ctx.currentTime, 0.1, 0.2, 'sine', 700, 1400);
  }

  /** The music stops dead: a record scratch. */
  scratch(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    this.hiss(t, 0.25, 0.6, 'bandpass', 3000, 400, 2);
    this.tone(t, 0.22, 0.2, 'sawtooth', 900, 120);
  }

  /** The gardener's tantrum: furious grumbling and stomping. */
  tantrum(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime + 0.3;
    // "ARRGH!" — a growling, wobbling shout, three times over.
    for (const at of [0, 0.9, 1.9]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(170, t + at);
      o.frequency.exponentialRampToValueAtTime(95, t + at + 0.6);
      const wob = ctx.createOscillator();
      wob.frequency.value = 28;
      const wg = ctx.createGain();
      wg.gain.value = 18;
      wob.connect(wg).connect(o.frequency);
      const vowel = ctx.createBiquadFilter();
      vowel.type = 'bandpass';
      vowel.frequency.value = 700;
      vowel.Q.value = 2;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + at);
      g.gain.exponentialRampToValueAtTime(0.35, t + at + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.65);
      o.connect(vowel).connect(g).connect(this.out!);
      for (const osc of [o, wob]) {
        osc.start(t + at);
        osc.stop(t + at + 0.7);
      }
    }
    // Stomp, stomp, stomp.
    for (let i = 0; i < 9; i++) {
      this.tone(t + i * 0.35, 0.12, 0.45, 'sine', 110, 40);
      this.hiss(t + i * 0.35, 0.08, 0.25, 'lowpass', 500, 150, 1);
    }
  }

  /** The trophy: a triumphant brass fanfare and a cheering crowd. */
  fanfare(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    const notes: [number, number, number][] = [[0, 523, 0.14], [0.15, 523, 0.14], [0.3, 523, 0.14], [0.45, 659, 0.5], [0.95, 587, 0.2], [1.15, 659, 0.2], [1.35, 784, 0.9]];
    for (const [at, f, len] of notes) {
      this.tone(t + at, len, 0.2, 'sawtooth', f, f);
      this.tone(t + at, len, 0.1, 'square', f / 2, f / 2);
    }
    this.hiss(t + 0.3, 2.5, 0.18, 'bandpass', 1200, 900, 0.5); // the crowd goes wild
  }

  /** The portal from hell: a deep rumble, a roar of flame and an evil organ chord. */
  hellfire(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    // Lasting until the world fades to black (about 6 s).
    this.hiss(t, 6.2, 0.6, 'lowpass', 300, 80, 1); // rumble
    this.hiss(t + 0.3, 5.5, 0.35, 'bandpass', 900, 300, 0.7); // flames
    // A dissonant pipe-organ stab, swelling: D minor with a tritone on top.
    for (const [f, d] of [[73.4, 0], [146.8, 0], [174.6, 0.1], [220, 0.2], [207.7, 0.35]]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + d);
      g.gain.exponentialRampToValueAtTime(0.09, t + d + 0.8);
      g.gain.setValueAtTime(0.09, t + 5);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 6.4);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1400;
      o.connect(lp).connect(g).connect(this.out!);
      o.start(t + d);
      o.stop(t + 6.5);
    }
  }

  /** Snail into worm: a wet, wobbly squelch. */
  squelch(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    this.tone(t, 0.5, 0.3, 'sine', 600, 90);
    this.hiss(t, 0.35, 0.4, 'bandpass', 700, 250, 5);
    this.tone(t + 0.3, 0.3, 0.2, 'triangle', 200, 520);
  }

  /** Burrowing: a soft gritty scrape. */
  dig(): void {
    const ctx = this.ready();
    if (!ctx) return;
    this.hiss(ctx.currentTime, 0.12, 0.22, 'bandpass', 1400 + Math.random() * 800, 500, 1.5);
  }

  /** Head-butting a stone. */
  bonk(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    this.tone(t, 0.12, 0.3, 'square', 260, 120);
    this.hiss(t, 0.06, 0.3, 'highpass', 3000, 2000, 1);
  }

  /** A mole jolted awake: a startled snort, then a nasty little sting. */
  snort(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    this.hiss(t, 0.18, 0.6, 'bandpass', 500, 300, 3);
    this.tone(t, 0.15, 0.3, 'sawtooth', 140, 90);
    this.tone(t + 0.2, 0.25, 0.15, 'square', 880, 830);
    this.tone(t + 0.2, 0.25, 0.1, 'square', 932, 880); // a sour semitone
  }

  /** A mole stirring for a wander: a sleepy yawn (quieter the further away it is). */
  yawn(volume: number): void {
    const ctx = this.ready();
    if (!ctx || volume <= 0.02) return;
    const t = ctx.currentTime;
    this.tone(t, 0.9, 0.12 * volume, 'triangle', 300, 180);
    this.hiss(t, 0.8, 0.15 * volume, 'bandpass', 900, 500, 2);
  }

  /** …and settling down again: a contented little sigh. */
  sigh(volume: number): void {
    const ctx = this.ready();
    if (!ctx || volume <= 0.02) return;
    this.hiss(ctx.currentTime, 0.6, 0.18 * volume, 'lowpass', 700, 300, 1);
  }

  /** Snoring, quiet or loud depending on how close the mole is. */
  snore(volume: number): void {
    const ctx = this.ready();
    if (!ctx || volume <= 0.02) return;
    const t = ctx.currentTime;
    this.hiss(t, 0.9, 0.35 * volume, 'lowpass', 400, 250, 4); // in…
    this.tone(t, 0.9, 0.12 * volume, 'sawtooth', 70, 62);
    this.hiss(t + 1, 0.6, 0.18 * volume, 'bandpass', 1800, 1200, 2); // …and a whistly out
  }

  /** Growing: a rising, sparkly glissando. */
  grow(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    [392, 494, 587, 784, 988].forEach((f, i) => this.tone(t + i * 0.07, 0.3, 0.12, 'triangle', f, f * 1.02));
    this.tone(t, 0.6, 0.1, 'sine', 300, 900);
  }

  /** Night falls: a soft, low, falling chime (and crickets). */
  dusk(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    [523, 392, 330].forEach((f, i) => this.tone(t + i * 0.12, 0.6, 0.07, 'sine', f, f));
    for (let i = 0; i < 6; i++) this.tone(t + 0.3 + i * 0.12, 0.05, 0.03, 'square', 4200, 4300);
  }

  /** Morning: a bright, rising chirrup. */
  dawn(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    [523, 659, 784].forEach((f, i) => this.tone(t + i * 0.1, 0.5, 0.07, 'sine', f, f));
    this.tone(t + 0.35, 0.12, 0.05, 'sine', 2200, 3200);
    this.tone(t + 0.5, 0.12, 0.05, 'sine', 2400, 3400);
  }

  /** A car horn, somewhere down the street. */
  honk(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime, f = 380 + Math.random() * 120;
    const n = Math.random() < 0.5 ? 1 : 2;
    for (let i = 0; i < n; i++) {
      this.tone(t + i * 0.22, 0.16, 0.05, 'square', f, f);
      this.tone(t + i * 0.22, 0.16, 0.04, 'square', f * 1.26, f * 1.26);
    }
  }

  /** Bombs away: a little falling whistle. */
  plop(): void {
    const ctx = this.ready();
    if (!ctx) return;
    this.tone(ctx.currentTime, 0.4, 0.08, 'sine', 1400, 500);
  }

  /** Splat! (Louder when it hits something.) */
  splat(hit: boolean): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    this.hiss(t, 0.15, hit ? 0.6 : 0.3, 'lowpass', 1500, 300, 3);
    this.tone(t, 0.1, hit ? 0.2 : 0.1, 'sine', 300, 120);
  }

  /** A person, pooped on: "EWWW!" */
  eww(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(420, t);
    o.frequency.linearRampToValueAtTime(520, t + 0.15);
    o.frequency.exponentialRampToValueAtTime(260, t + 0.6);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1100; // an "ee" vowel
    f.Q.value = 3;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.62);
    o.connect(f).connect(g).connect(this.out!);
    o.start(t);
    o.stop(t + 0.65);
  }

  /** A firework: a bang and a crackle. */
  firework(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    this.hiss(t, 0.4, 0.5, 'lowpass', 900, 120, 1);
    this.tone(t, 0.25, 0.2, 'sine', 120, 50);
    for (let i = 0; i < 6; i++) this.hiss(t + 0.15 + Math.random() * 0.5, 0.03, 0.15, 'highpass', 5000, 4000, 1);
  }

  /** A howling gust of wind. */
  gale(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    this.hiss(t, 2.4, 0.6, 'bandpass', 400, 1800, 0.8);
    this.hiss(t + 0.2, 2, 0.35, 'bandpass', 1200, 600, 2);
    this.tone(t, 2.2, 0.06, 'sine', 300, 700);
  }

  /** A departing soul: a soft, rising heavenly chord. */
  soul(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime + 0.25;
    for (const [f, d] of [[523, 0], [659, 0.08], [784, 0.16], [1047, 0.3]]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(f, t + d);
      o.frequency.exponentialRampToValueAtTime(f * 1.06, t + d + 1.4);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + d);
      g.gain.exponentialRampToValueAtTime(0.07, t + d + 0.35);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d + 1.5);
      const trem = ctx.createOscillator();
      trem.frequency.value = 5;
      const tg = ctx.createGain();
      tg.gain.value = 0.02;
      trem.connect(tg).connect(g.gain);
      o.connect(g).connect(this.out!);
      for (const osc of [o, trem]) {
        osc.start(t + d);
        osc.stop(t + d + 1.6);
      }
    }
  }

  /** The traffic light changing: a relay clunk and a little beep (low for red). */
  signal(red: boolean): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    this.hiss(t, 0.05, 0.25, 'bandpass', 800, 600, 2);
    this.tone(t + 0.02, 0.16, 0.1, 'square', red ? 440 : 880, red ? 440 : 880);
  }

  checkpoint(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    [587, 880].forEach((f, i) => this.tone(t + i * 0.09, 0.18, 0.14, 'triangle', f, f));
  }

  levelUp(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    [523, 659, 784, 1047].forEach((f, i) => this.tone(t + i * 0.1, 0.25, 0.18, 'triangle', f, f));
  }

  gameOver(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    [392, 330, 262].forEach((f, i) => this.tone(t + i * 0.22, 0.4, 0.18, 'triangle', f, f * 0.97));
  }
}
