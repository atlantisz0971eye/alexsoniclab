/**
 * alexsonicLAb's players and styles. A player reads one feature of the page and plays one instrument; a style is a
 * set of numbers (tempo, groove, drum pattern, sounds, space) that makes the same page into a different piece.
 * To add a style, copy one below and change its numbers: no synth code needs to change.
 */

export type PlayerId = "architect" | "typist" | "headliner" | "photographer" | "linker";

export const PLAYERS: { id: PlayerId; name: string; key: string; reads: string; plays: string }[] = [
  { id: "architect", name: "ARCHITECT", key: "q", reads: "edges", plays: "bass" },
  { id: "typist", name: "TYPIST", key: "w", reads: "text", plays: "hats" },
  { id: "headliner", name: "HEADLINER", key: "e", reads: "titles", plays: "chords" },
  { id: "photographer", name: "PHOTOGRAPHER", key: "r", reads: "media", plays: "pad" },
  { id: "linker", name: "LINKER", key: "t", reads: "links", plays: "blips" },
];

export type StyleId = "techno" | "dub" | "acid" | "ambient" | "breaks" | "minimal";

export type SonicStyle = {
  id: StyleId;
  name: string;
  key: string;
  bpm: number;
  /** Delay of every second sixteenth, as a share of a sixteenth. */
  swing: number;
  /** Root of the scales, in Hz. Each section keeps its own mode over it. */
  root: number;
  kick: number[];
  snare: number[];
  snareVoice: "clap" | "snare";
  /** Whether the kick drops out over the empty gaps between sections. */
  breakdown: boolean;
  /** How the typist turns text into rhythm. */
  typist: "hats" | "breaks" | "clicks";
  /** Text density above which the typist plays. */
  textGate: number;
  bass: { every: number; wave: OscillatorType; q: number; peak: number; accentPeak: number; decay: number; length: number; octave: number };
  stab: { octave: number; length: number };
  pad: { always: boolean; attack: number };
  blip: { octave: number };
  fx: { delaySteps: number; feedback: number; delay: number; reverb: number };
  /** Default level of each player in this style, 0 to 1. */
  mix: Record<PlayerId, number>;
};

export const STYLES: SonicStyle[] = [
  {
    id: "techno", name: "TECHNO", key: "1", bpm: 128, swing: 0, root: 55,
    kick: [0, 4, 8, 12], snare: [4, 12], snareVoice: "clap", breakdown: true,
    typist: "hats", textGate: 0.03,
    bass: { every: 1, wave: "sawtooth", q: 11, peak: 1700, accentPeak: 3600, decay: 0.14, length: 0.85, octave: 0 },
    stab: { octave: 3, length: 0.42 }, pad: { always: false, attack: 0.4 }, blip: { octave: 4 },
    fx: { delaySteps: 3, feedback: 0.28, delay: 0.14, reverb: 0.12 },
    mix: { architect: 0.85, typist: 0.8, headliner: 0.7, photographer: 0.35, linker: 0.4 },
  },
  {
    id: "dub", name: "DUB", key: "2", bpm: 120, swing: 0.04, root: 49,
    kick: [0, 4, 8, 12], snare: [], snareVoice: "clap", breakdown: true,
    typist: "hats", textGate: 0.1,
    bass: { every: 4, wave: "triangle", q: 2, peak: 520, accentPeak: 900, decay: 0.4, length: 3.2, octave: 0 },
    stab: { octave: 3, length: 1.1 }, pad: { always: true, attack: 1.2 }, blip: { octave: 4 },
    fx: { delaySteps: 3, feedback: 0.62, delay: 0.5, reverb: 0.42 },
    mix: { architect: 0.9, typist: 0.45, headliner: 0.9, photographer: 0.55, linker: 0.3 },
  },
  {
    id: "acid", name: "ACID", key: "3", bpm: 134, swing: 0, root: 55,
    kick: [0, 4, 8, 12], snare: [4, 12], snareVoice: "clap", breakdown: true,
    typist: "hats", textGate: 0.05,
    bass: { every: 1, wave: "sawtooth", q: 21, peak: 2200, accentPeak: 5400, decay: 0.18, length: 0.9, octave: 0 },
    stab: { octave: 3, length: 0.3 }, pad: { always: false, attack: 0.4 }, blip: { octave: 4 },
    fx: { delaySteps: 3, feedback: 0.3, delay: 0.1, reverb: 0.06 },
    mix: { architect: 1, typist: 0.7, headliner: 0.25, photographer: 0, linker: 0.2 },
  },
  {
    id: "ambient", name: "AMBIENT", key: "4", bpm: 84, swing: 0, root: 55,
    kick: [], snare: [], snareVoice: "clap", breakdown: false,
    typist: "clicks", textGate: 0.04,
    bass: { every: 16, wave: "triangle", q: 1, peak: 420, accentPeak: 600, decay: 1.5, length: 15, octave: 0 },
    stab: { octave: 3, length: 2.2 }, pad: { always: true, attack: 2.4 }, blip: { octave: 5 },
    fx: { delaySteps: 6, feedback: 0.55, delay: 0.45, reverb: 0.62 },
    mix: { architect: 0.5, typist: 0.25, headliner: 0.7, photographer: 1, linker: 0.55 },
  },
  {
    id: "breaks", name: "BREAKS", key: "5", bpm: 170, swing: 0.06, root: 55,
    kick: [0, 10], snare: [4, 12], snareVoice: "snare", breakdown: true,
    typist: "breaks", textGate: 0.03,
    bass: { every: 2, wave: "square", q: 6, peak: 1100, accentPeak: 2000, decay: 0.2, length: 1.6, octave: 0 },
    stab: { octave: 3, length: 0.5 }, pad: { always: false, attack: 0.6 }, blip: { octave: 4 },
    fx: { delaySteps: 3, feedback: 0.25, delay: 0.12, reverb: 0.16 },
    mix: { architect: 0.85, typist: 0.9, headliner: 0.55, photographer: 0.35, linker: 0.3 },
  },
  {
    id: "minimal", name: "MINIMAL", key: "6", bpm: 124, swing: 0.02, root: 55,
    kick: [0, 4, 8, 12], snare: [], snareVoice: "clap", breakdown: true,
    typist: "clicks", textGate: 0.02,
    bass: { every: 4, wave: "sine", q: 4, peak: 700, accentPeak: 1200, decay: 0.08, length: 0.6, octave: 1 },
    stab: { octave: 4, length: 0.12 }, pad: { always: false, attack: 0.4 }, blip: { octave: 5 },
    fx: { delaySteps: 3, feedback: 0.35, delay: 0.22, reverb: 0.1 },
    mix: { architect: 0.7, typist: 0.85, headliner: 0.25, photographer: 0.2, linker: 0.6 },
  },
];

export const styleById = (id: string | null | undefined) => STYLES.find((style) => style.id === id) ?? STYLES[0];
