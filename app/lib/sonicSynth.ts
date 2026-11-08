import { PLAYERS, type PlayerId, type SonicStyle } from "../data/sonicStyles";
import type { CrossfadeCurve } from "./labSettings";
import { hitPlayer, type Hit } from "./sonicPlayers";

/** Deck A plays a captured loop, deck B the live scan; the crossfader sets how much of each is heard. */
export type DeckId = "a" | "b";
export type DeckHit = { deck: DeckId; hit: Hit };

/**
 * alexsonicLAb's sound engine, synthesised in Web Audio with no samples. Drums go straight to the mix; each player
 * has its own channel (level, mute) with sends to a tempo-synced delay and a generated reverb. A look-ahead
 * scheduler asks for each sixteenth just before it is due; a new style waits for the next bar line.
 */

const LOOKAHEAD = 0.12;

export class SonicSynth {
  readonly context: AudioContext;
  readonly analyser: AnalyserNode;
  private style: SonicStyle;
  private pending: SonicStyle | null = null;
  private curve: CrossfadeCurve = "power";
  private xfade = 1;
  private bus: GainNode;
  private filter: BiquadFilterNode;
  private output: GainNode;
  private noise: AudioBuffer;
  private channels = new Map<string, GainNode>();
  private decks = new Map<DeckId, GainNode>();
  private delaySend: GainNode;
  private reverbSend: GainNode;
  private delay: DelayNode;
  private feedback: GainNode;
  private lastHit = new Map<string, number>();
  private timer = 0;
  private nextTime = 0;
  private step = 0;
  /** Sixteenths scheduled since the start, for loops and rolls. */
  private count = 0;
  private recorder: MediaRecorder | null = null;
  private lastBass = 0;
  private sends = { delay: 0.5, reverb: 0.5 };
  private scheduled: { time: number; step: number }[] = [];
  onBar: (style: SonicStyle) => void = () => {};

  constructor(style: SonicStyle, private compose: (style: SonicStyle, step: number, count: number) => DeckHit[]) {
    this.style = style;
    this.context = new AudioContext({ latencyHint: "interactive" });
    const ctx = this.context;
    this.output = ctx.createGain();
    this.output.gain.value = 0;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.2;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = 900;
    this.filter.Q.value = 2;
    this.bus = ctx.createGain();
    this.bus.gain.value = 0.8;
    this.bus.connect(this.filter).connect(limiter).connect(this.output).connect(ctx.destination);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0;
    this.output.connect(this.analyser);

    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;

    // A tempo-synced delay with a darkening feedback loop.
    this.delaySend = ctx.createGain();
    this.delay = ctx.createDelay(2);
    this.feedback = ctx.createGain();
    const darken = ctx.createBiquadFilter();
    darken.type = "lowpass";
    darken.frequency.value = 2400;
    this.delaySend.connect(this.delay).connect(darken).connect(this.bus);
    darken.connect(this.feedback).connect(this.delay);

    // A reverb from a generated impulse: two seconds and a half of decaying noise, a little different in each ear.
    this.reverbSend = ctx.createGain();
    const reverb = ctx.createConvolver();
    const seconds = 2.6;
    const impulse = ctx.createBuffer(2, Math.round(ctx.sampleRate * seconds), ctx.sampleRate);
    for (let c = 0; c < 2; c += 1) {
      const channel = impulse.getChannelData(c);
      for (let i = 0; i < channel.length; i += 1) channel[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / channel.length, 3);
    }
    reverb.buffer = impulse;
    this.reverbSend.connect(reverb).connect(this.bus);

    for (const deck of ["a", "b"] as DeckId[]) {
      const deckGain = ctx.createGain();
      deckGain.connect(this.bus);
      this.decks.set(deck, deckGain);
      for (const player of PLAYERS) {
        const channel = ctx.createGain();
        channel.gain.value = style.mix[player.id];
        channel.connect(deckGain);
        this.channels.set(`${deck}:${player.id}`, channel);
      }
    }
    this.setCrossfade(1);
    this.applyStyle(style);
  }

  private get stepTime() {
    return 60 / this.style.bpm / 4;
  }

  start() {
    const ctx = this.context;
    void ctx.resume();
    this.output.gain.cancelScheduledValues(ctx.currentTime);
    this.output.gain.setTargetAtTime(0.9, ctx.currentTime, 0.4);
    this.nextTime = ctx.currentTime + 0.08;
    const pump = () => {
      while (this.nextTime < ctx.currentTime + LOOKAHEAD) {
        if (this.step === 0 && this.pending) {
          this.applyStyle(this.pending);
          this.pending = null;
        }
        if (this.step === 0) this.onBar(this.style);
        const swing = this.step % 2 === 1 ? this.style.swing * this.stepTime : 0;
        for (const { deck, hit } of this.compose(this.style, this.step, this.count)) this.play(hit, this.nextTime + swing, deck);
        this.scheduled.push({ time: this.nextTime, step: this.step });
        if (this.scheduled.length > 32) this.scheduled.shift();
        this.nextTime += this.stepTime;
        this.step = (this.step + 1) % 16;
        this.count += 1;
      }
    };
    pump();
    this.timer = window.setInterval(pump, 25);
  }

  /** Change style at the next bar line, so the groove never breaks mid-bar. */
  setStyle(style: SonicStyle) {
    // The same style object is no change; a copy with changed numbers (tempo, swing) comes in at the bar line.
    this.pending = style === this.style || (style.id === this.style.id && sameNumbers(style, this.style)) ? null : style;
  }

  private applyStyle(style: SonicStyle) {
    this.style = style;
    const now = this.context.currentTime;
    this.delay.delayTime.setTargetAtTime((60 / style.bpm / 4) * style.fx.delaySteps, now, 0.05);
    this.feedback.gain.setTargetAtTime(style.fx.feedback, now, 0.05);
    this.updateSends();
  }

  /** Player level, 0 to 1; muting is a level of 0. */
  setLevel(player: PlayerId, level: number) {
    for (const deck of ["a", "b"]) this.channels.get(`${deck}:${player}`)?.gain.setTargetAtTime(Math.max(0, Math.min(1, level)), this.context.currentTime, 0.03);
  }

  /** The crossfader: 0 is deck A alone, 1 is deck B alone, with equal-power curves in between (or linear, or a cut). */
  setCrossfade(x: number) {
    const v = Math.max(0, Math.min(1, x));
    this.xfade = v;
    const now = this.context.currentTime;
    const [a, b] = this.curve === "linear" ? [1 - v, v] : this.curve === "cut" ? [v < 0.5 ? 1 : 0, v < 0.5 ? 0 : 1] : [Math.cos((v * Math.PI) / 2), Math.sin((v * Math.PI) / 2)];
    this.decks.get("a")?.gain.setTargetAtTime(a, now, 0.02);
    this.decks.get("b")?.gain.setTargetAtTime(b, now, 0.02);
  }

  setCurve(curve: CrossfadeCurve) {
    if (curve === this.curve) return;
    this.curve = curve;
    this.setCrossfade(this.xfade);
  }

  /** Delay and reverb amount, 0 to 1, where 0.5 is the style's own amount. */
  setSends(delay: number, reverb: number) {
    this.sends = { delay, reverb };
    this.updateSends();
  }

  private updateSends() {
    const now = this.context.currentTime;
    this.delaySend.gain.setTargetAtTime(this.style.fx.delay * this.sends.delay * 2, now, 0.05);
    this.reverbSend.gain.setTargetAtTime(this.style.fx.reverb * this.sends.reverb * 2, now, 0.05);
  }

  /** The master filter: the faster the page is scanned, the brighter it gets. Returns the cutoff in Hz. */
  setBrightness(amount: number, range = { min: 380, max: 9580 }) {
    const a = Math.max(0, Math.min(1, amount));
    const cutoff = range.min + Math.pow(a, 0.7) * (range.max - range.min);
    this.filter.frequency.setTargetAtTime(cutoff, this.context.currentTime, 0.08);
    this.filter.Q.setTargetAtTime(2 + a * 5, this.context.currentTime, 0.2);
    return cutoff;
  }

  /** How recently a player (or the drums) played, 0 to 1, for the meters. */
  activity(name: string) {
    const last = this.lastHit.get(name);
    if (last === undefined) return 0;
    const age = this.context.currentTime - last;
    return age < 0 ? 0 : Math.exp(-age / 0.22);
  }

  /** The next sixteenth to be scheduled, counted from the start. */
  get nextCount() {
    return this.count;
  }

  /** Record the mix as it is heard. Resolves with the recording when `stopRecording` is called. */
  startRecording(): Promise<Blob> | null {
    if (typeof MediaRecorder === "undefined" || this.recorder) return null;
    const destination = this.context.createMediaStreamDestination();
    this.output.connect(destination);
    const type = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((t) => MediaRecorder.isTypeSupported(t));
    const recorder = new MediaRecorder(destination.stream, type ? { mimeType: type } : undefined);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => event.data.size && chunks.push(event.data);
    const done = new Promise<Blob>((resolve) => {
      recorder.onstop = () => {
        try {
          this.output.disconnect(destination);
        } catch {
          // The context may already be closed.
        }
        resolve(new Blob(chunks, { type: recorder.mimeType }));
      };
    });
    recorder.start(1000);
    this.recorder = recorder;
    return done;
  }

  stopRecording() {
    this.recorder?.stop();
    this.recorder = null;
  }

  /** The sixteenth sounding now, for the step lights. */
  playhead() {
    const now = this.context.currentTime;
    let step = -1;
    for (const entry of this.scheduled) if (entry.time <= now) step = entry.step;
    return step;
  }

  stop(fade = 0.8) {
    const ctx = this.context;
    this.stopRecording();
    window.clearInterval(this.timer);
    this.output.gain.cancelScheduledValues(ctx.currentTime);
    this.output.gain.setTargetAtTime(0, ctx.currentTime, fade / 4);
    window.setTimeout(() => void ctx.close(), fade * 1000 + 200);
  }

  private play(hit: Hit, t: number, deck: DeckId) {
    const player = hitPlayer(hit);
    this.lastHit.set(player ?? "drums", t);
    this.lastHit.set(`deck:${deck}`, t);
    const deckOut = this.decks.get(deck)!;
    const out = player ? this.channels.get(`${deck}:${player}`)! : deckOut;
    switch (hit.voice) {
      case "kick": return this.kick(t, deckOut);
      case "clap": return this.clap(t, deckOut);
      case "snare": return this.snare(t, hit.gain, out);
      case "ghost": return this.snare(t, 0.28, out);
      case "hat": return this.hat(t, hit.open, out);
      case "click": return this.click(t, out);
      case "bass": return this.bass(t, hit.freq, hit.accent, hit.slide, out);
      case "stab": return this.stab(t, hit.freqs, out);
      case "pad": return this.pad(t, hit.freqs, hit.brightness, out);
      case "blip": return this.blip(t, hit.freq, out);
    }
  }

  /** A voice's output into its channel, plus some of it into the delay and reverb. */
  private route(node: AudioNode, out: AudioNode, delay = 0, reverb = 0) {
    node.connect(out);
    if (delay) {
      const send = this.context.createGain();
      send.gain.value = delay;
      node.connect(send).connect(this.delaySend);
    }
    if (reverb) {
      const send = this.context.createGain();
      send.gain.value = reverb;
      node.connect(send).connect(this.reverbSend);
    }
  }

  private noiseSource(t: number, length: number) {
    const src = this.context.createBufferSource();
    src.buffer = this.noise;
    src.start(t, Math.random() * 0.5);
    src.stop(t + length);
    return src;
  }

  private kick(t: number, out: AudioNode) {
    const ctx = this.context;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.setValueAtTime(160, t);
    osc.frequency.exponentialRampToValueAtTime(44, t + 0.11);
    gain.gain.setValueAtTime(1, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.42);
    osc.connect(gain).connect(out);
    osc.start(t);
    osc.stop(t + 0.45);
  }

  private clap(t: number, out: AudioNode) {
    const ctx = this.context;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1400;
    bp.Q.value = 1.2;
    const gain = ctx.createGain();
    // Three quick bursts and a tail, the shape of hands that do not quite clap together.
    [0, 0.011, 0.023].forEach((offset) => {
      gain.gain.setValueAtTime(0.5, t + offset);
      gain.gain.exponentialRampToValueAtTime(0.05, t + offset + 0.009);
    });
    gain.gain.setValueAtTime(0.32, t + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    this.noiseSource(t, 0.22).connect(bp).connect(gain);
    this.route(gain, out, 0, 0.3);
  }

  private snare(t: number, level: number, out: AudioNode) {
    const ctx = this.context;
    const bp = ctx.createBiquadFilter();
    bp.type = "highpass";
    bp.frequency.value = 1200;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.42 * level, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    this.noiseSource(t, 0.18).connect(bp).connect(noiseGain);
    const body = ctx.createOscillator();
    body.type = "triangle";
    body.frequency.setValueAtTime(220, t);
    body.frequency.exponentialRampToValueAtTime(150, t + 0.08);
    const bodyGain = ctx.createGain();
    bodyGain.gain.setValueAtTime(0.4 * level, t);
    bodyGain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    body.connect(bodyGain);
    body.start(t);
    body.stop(t + 0.12);
    this.route(noiseGain, out, 0, 0.2);
    this.route(bodyGain, out);
  }

  private hat(t: number, open: boolean, out: AudioNode) {
    const ctx = this.context;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = open ? 6500 : 8200;
    const gain = ctx.createGain();
    const length = open ? 0.22 : 0.035;
    gain.gain.setValueAtTime(open ? 0.16 : 0.2, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + length);
    this.noiseSource(t, length + 0.02).connect(hp).connect(gain);
    this.route(gain, out, open ? 0.2 : 0, 0.1);
  }

  private click(t: number, out: AudioNode) {
    const ctx = this.context;
    const hp = ctx.createBiquadFilter();
    hp.type = "bandpass";
    hp.frequency.value = 3000 + Math.random() * 3000;
    hp.Q.value = 6;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.5, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.012);
    this.noiseSource(t, 0.02).connect(hp).connect(gain);
    this.route(gain, out, 0.4, 0.3);
  }

  private bass(t: number, freq: number, accent: boolean, slide: boolean, out: AudioNode) {
    const ctx = this.context;
    const b = this.style.bass;
    const osc = ctx.createOscillator();
    osc.type = b.wave;
    const from = slide && this.lastBass ? this.lastBass : freq;
    osc.frequency.setValueAtTime(from, t);
    if (from !== freq) osc.frequency.exponentialRampToValueAtTime(freq, t + this.stepTime * 0.7);
    this.lastBass = freq;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = accent ? b.q * 1.45 : b.q;
    lp.frequency.setValueAtTime(accent ? b.accentPeak : b.peak, t);
    lp.frequency.exponentialRampToValueAtTime(160, t + b.decay * (accent ? 1.5 : 1));
    const gain = ctx.createGain();
    const length = this.stepTime * b.length * (slide ? 1.2 : 1);
    gain.gain.setValueAtTime(accent ? 0.34 : 0.24, t);
    gain.gain.setTargetAtTime(0.0001, t + length * 0.6, Math.max(0.03, length * 0.15));
    osc.connect(lp).connect(gain);
    this.route(gain, out, 0.06, 0.04);
    osc.start(t);
    osc.stop(t + length * 1.6 + 0.2);
  }

  private stab(t: number, freqs: number[], out: AudioNode) {
    const ctx = this.context;
    const length = this.style.stab.length;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(2600, t);
    lp.frequency.exponentialRampToValueAtTime(500, t + length * 0.8);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.11, t + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
    lp.connect(gain);
    for (const f of freqs) {
      for (const detune of [-7, 7]) {
        const osc = ctx.createOscillator();
        osc.type = "square";
        osc.frequency.value = f;
        osc.detune.value = detune;
        osc.connect(lp);
        osc.start(t);
        osc.stop(t + length + 0.05);
      }
    }
    this.route(gain, out, 0.6, 0.5);
  }

  private pad(t: number, freqs: number[], brightness: number, out: AudioNode) {
    const ctx = this.context;
    const bar = this.stepTime * 16;
    const attack = Math.min(this.style.pad.attack, bar * 0.6);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 400 + brightness * 2600;
    lp.Q.value = 0.7;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(0.05, t + attack);
    gain.gain.setTargetAtTime(0.0001, t + bar * 0.85, bar * 0.2);
    lp.connect(gain);
    for (const f of freqs) {
      for (const detune of [-11, 0, 11]) {
        const osc = ctx.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.value = f;
        osc.detune.value = detune;
        osc.connect(lp);
        osc.start(t);
        osc.stop(t + bar * 1.6);
      }
    }
    this.route(gain, out, 0.3, 0.8);
  }

  private blip(t: number, freq: number, out: AudioNode) {
    const ctx = this.context;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.12, t + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    osc.connect(gain);
    this.route(gain, out, 0.7, 0.4);
    osc.start(t);
    osc.stop(t + 0.12);
  }
}

/** Two versions of one style that play the same: no need to switch at the bar line. */
function sameNumbers(a: SonicStyle, b: SonicStyle) {
  return a.bpm === b.bpm && a.swing === b.swing && a.root === b.root && a.breakdown === b.breakdown && a.typist === b.typist && a.kick.join() === b.kick.join() && a.snare.join() === b.snare.join();
}
