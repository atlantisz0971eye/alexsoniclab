"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PLAYERS, STYLES, styleById, type PlayerId, type StyleId } from "../data/sonicStyles";
import { Ink, ROW_PX, readRow, snapshotPage, type ScanRow, type ScanSnapshot } from "../lib/scanPage";
import { decodePerformance, encodePerformance, type Performance, type PerformanceEvent, type PixelMode } from "../lib/sonicPerformance";
import { compose, DEFAULT_ROUTES, type Routes } from "../lib/sonicPlayers";
import { SOURCES } from "../lib/sonicSignals";
import { SonicSynth, type DeckHit } from "../lib/sonicSynth";
import { prefersReducedMotion } from "../utils/environment";
import { platter, SonicDeck, type DeckState, type PerformState } from "./SonicDeck";
import "./sonicLab.css";

/** The way out of the Lab: into the portfolio by default, or wherever the host page goes. */
export type EnterLabels = { loud: string; silent: string; loudHint: string; silentHint: string };
const PORTFOLIO_ENTER: EnterLabels = { loud: "ENTER", silent: "ENTER SILENTLY", loudHint: "the sound stops at the door", silentHint: "or click anywhere for sound" };

type SonicLabProps = {
  open: boolean;
  onClose: () => void;
  /**
   * A page read elsewhere (by a server, from another site). Without it the Lab reads the page under it, the
   * portfolio's `main`, and reads it again when its layout changes.
   */
  snapshot?: ScanSnapshot | null;
  /** The query that opens this Lab again, for replay links. */
  linkQuery?: string;
  /** Leave on its own once the whole page has been read. */
  autoEnter?: boolean;
  /** What the way out is called. */
  enterLabels?: EnterLabels;
};

/**
 * alexsonicLAb: an opaque instrument over the real portfolio. The read head is a fixed axis across the screen;
 * scrolling moves the page under it, rows above the axis have been read and rows below are what comes next. The
 * axis shows only the row being read, as pixels; below it an ASCII DJ console with two decks: deck A loops a
 * fragment captured from the scan, deck B is the live scan, and a crossfader mixes them. Plus styles, player
 * mutes, roll, pixel modes, carving, recording and replayable performance links.
 * Sound lives only here and shuts down on entering the portfolio.
 */

const AXIS = 0.4; // the read head sits 40% down the screen, so the deck fits underneath
const STORAGE_KEY = "alexsonicLAb";
const BUILD = (process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 7) || "dev";
const HISTORY = 128; // rows kept for loops: up to eight bars

const ACCENT: Record<string, [number, number, number]> = {
  top: [200, 204, 214],
  tian: [126, 160, 255],
  ren: [178, 150, 230],
  di: [110, 200, 196],
  development: [150, 158, 222],
  gallery: [170, 206, 132],
  workbench: [214, 219, 228],
  bio: [232, 196, 140],
};

const INK_ALPHA: Record<number, number> = { [Ink.Edge]: 0.5, [Ink.Text]: 0.72, [Ink.Heading]: 1, [Ink.Media]: 0.32, [Ink.Rule]: 0.9, [Ink.Link]: 0.6 };
/** How bright each kind of cell is, for pixel sorting. */
const INK_WEIGHT: Record<number, number> = { [Ink.Blank]: 0, [Ink.Media]: 1, [Ink.Edge]: 2, [Ink.Link]: 3, [Ink.Rule]: 4, [Ink.Text]: 5, [Ink.Heading]: 6 };
/** Sections of other sites have no colour of their own: each name gets one from this set, always the same. */
const PALETTE: [number, number, number][] = [[126, 160, 255], [178, 150, 230], [110, 200, 196], [170, 206, 132], [232, 196, 140], [150, 158, 222], [236, 150, 160]];
const accentOf = (section: string | undefined): [number, number, number] => {
  const name = section ?? "top";
  if (ACCENT[name]) return ACCENT[name];
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(hash) % PALETTE.length];
};
const inkColour = (ink: number, accent: [number, number, number], alpha: number) => {
  const [r, g, b] = accent;
  if (ink === Ink.Heading) return `rgba(255,255,255,${alpha})`;
  if (ink === Ink.Edge || ink === Ink.Media) return `rgba(210,214,222,${alpha})`;
  return `rgba(${r},${g},${b},${alpha})`;
};

const isPlayer = (value: string): value is PlayerId => PLAYERS.some((player) => player.id === value);

/** Pixel sort: inside every unbroken run of cells, the brightest move to the left. The silhouette stays. */
function sortRow(row: ScanRow): { chars: string; inks: Uint8Array } {
  const chars = row.chars.split("");
  const inks = Uint8Array.from(row.inks);
  let start = 0;
  for (let c = 0; c <= inks.length; c += 1) {
    if (c === inks.length || inks[c] === Ink.Blank) {
      if (c - start > 1) {
        const run = Array.from({ length: c - start }, (_, i) => ({ ch: chars[start + i], ink: inks[start + i] }));
        run.sort((a, b) => INK_WEIGHT[b.ink] - INK_WEIGHT[a.ink]);
        run.forEach((cell, i) => {
          chars[start + i] = cell.ch;
          inks[start + i] = cell.ink;
        });
      }
      start = c + 1;
    }
  }
  return { chars: chars.join(""), inks };
}

/** The visitor's last setup, then anything a shared link asks for. */
function initialDeck(): DeckState {
  let saved: Partial<DeckState> = {};
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
  } catch {
    // A fresh deck when storage is unavailable.
  }
  const params = new URLSearchParams(window.location.search);
  const style = styleById(params.get("style") ?? saved.style);
  const fromLink = params.has("style");
  const list = (name: string, fallback?: PlayerId[]) => {
    const raw = params.get(name);
    return raw === null ? (fallback ?? []).filter(isPlayer) : raw.split(",").filter(isPlayer);
  };
  const routes: Routes = { ...DEFAULT_ROUTES, ...(fromLink ? {} : saved.routes) };
  for (const pair of (params.get("route") ?? "").split(",")) {
    const [player, source] = pair.split(".");
    if (isPlayer(player) && SOURCES.includes(source as never)) routes[player] = source as Routes[PlayerId];
  }
  return {
    style: style.id,
    pending: null,
    levels: !fromLink && saved.levels && saved.style === style.id ? { ...style.mix, ...saved.levels } : { ...style.mix },
    mutes: list("mute", fromLink ? [] : saved.mutes),
    solos: list("solo", fromLink ? [] : saved.solos),
    delay: typeof saved.delay === "number" && !fromLink ? saved.delay : 0.5,
    reverb: typeof saved.reverb === "number" && !fromLink ? saved.reverb : 0.5,
    routes,
  };
}

const download = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
};
const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");

export function SonicLab({ open, onClose, snapshot: given = null, linkQuery = "scan", autoEnter = true, enterLabels = PORTFOLIO_ENTER }: SonicLabProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const fieldRef = useRef<HTMLCanvasElement | null>(null);
  const axisRef = useRef<HTMLCanvasElement | null>(null);
  const scope = useRef<HTMLCanvasElement | null>(null);
  const live = useRef(new Map<string, HTMLSpanElement>());
  const [powered, setPowered] = useState(false);
  const [started, setStarted] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [readout, setReadout] = useState({ y: 0, height: 1, section: "top", complete: false });
  const [deck, setDeck] = useState<DeckState | null>(null);
  const deckRef = useRef<DeckState | null>(null);
  deckRef.current = deck;
  const [perform, setPerform] = useState<PerformState>({ loaded: 0, loadBars: 2, xfade: 1, roll: 0, pixel: "normal", carved: 0, recording: false, take: null, replay: null });
  const [loopSection, setLoopSection] = useState<string | null>(null);
  const performRef = useRef(perform);
  performRef.current = perform;

  const state = useRef({
    snapshot: null as ScanSnapshot | null,
    cache: new Map<number, ScanRow>(),
    sorted: new Map<number, { chars: string; inks: Uint8Array }>(),
    readY: 0,
    row: -1,
    bar: [] as ScanRow[],
    history: [] as ScanRow[],
    // Deck A: a fragment of the scan, looping. The crossfader: 0 is deck A alone, 1 is deck B (live) alone.
    deckA: null as ScanRow[] | null,
    xfade: 1,
    roll: null as { length: number; from: number } | null,
    loopIndex: 0,
    carved: new Set<number>(),
    carveVersion: 0,
    pixel: "normal" as PixelMode,
    poster: [] as { inks: Uint8Array; section: string }[],
    cols: 120,
    cell: { w: 8, h: 16 },
    size: { w: 0, h: 0 },
    fieldDirty: true,
    speed: 0,
    moved: 0,
    cutoff: 380,
    energy: 0,
    synth: null as SonicSynth | null,
    wave: new Uint8Array(2048),
    leaving: false,
    // A performance being recorded, its take, and one being replayed.
    take: null as { start: number; y0: number; deck: DeckState; events: PerformanceEvent[]; lastY: number } | null,
    takeAudio: null as Promise<Blob> | null,
    takeBlob: null as Blob | null,
    takePerformance: null as Performance | null,
    replay: null as Performance | null,
    replayTimers: [] as number[],
    moveTo: (_y: number) => {},
  });

  /** Note a performance event while recording. */
  const note = useCallback((event: PerformanceEvent extends [number, ...infer Rest] ? Rest : never) => {
    const take = state.current.take;
    if (take) take.events.push([Math.round(performance.now() - take.start), ...event] as PerformanceEvent);
  }, []);

  /** Send the deck to the synth: style, the level of each player after mute and solo, and the effect sends. */
  const applyDeck = useCallback((d: DeckState) => {
    const synth = state.current.synth;
    if (!synth) return;
    synth.setStyle(styleById(d.pending ?? d.style));
    for (const player of PLAYERS) {
      const silenced = d.mutes.includes(player.id) || (d.solos.length > 0 && !d.solos.includes(player.id));
      synth.setLevel(player.id, silenced ? 0 : d.levels[player.id]);
    }
    synth.setSends(d.delay, d.reverb);
  }, []);

  const setDeckState = useCallback((next: DeckState, record = true) => {
    deckRef.current = next;
    setDeck(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...next, pending: null, style: next.pending ?? next.style }));
    } catch {
      // The setup is simply not remembered.
    }
    applyDeck(next);
    if (record) note(["deck", next]);
  }, [applyDeck, note]);

  const updateDeck = useCallback((change: (d: DeckState) => DeckState) => {
    const current = deckRef.current;
    if (current) setDeckState(change(current));
  }, [setDeckState]);

  const chooseStyle = useCallback((id: StyleId) => {
    // A new style brings its own mix; with the sound on it starts at the next bar line.
    const levels = { ...styleById(id).mix };
    updateDeck((d) => (state.current.synth ? { ...d, pending: id === d.style ? null : id, levels } : { ...d, style: id, pending: null, levels }));
  }, [updateDeck]);
  const toggle = useCallback((list: "mutes" | "solos", player: PlayerId) => {
    updateDeck((d) => ({ ...d, [list]: d[list].includes(player) ? d[list].filter((p) => p !== player) : [...d[list], player] }));
  }, [updateDeck]);
  /** Capture the last bars of the live deck into deck A, where they loop until reloaded or ejected. */
  const load = useCallback((bars: number) => {
    const s = state.current;
    if (bars > 0) {
      const rows = s.history.slice(-bars * 16);
      while (rows.length && rows.length < bars * 16) rows.push(...rows.slice(0, bars * 16 - rows.length));
      if (!rows.length) return;
      s.deckA = rows;
      // A freshly loaded loop comes in at half, so both decks are heard.
      if (s.xfade > 0.9) {
        s.xfade = 0.5;
        s.synth?.setCrossfade(0.5);
      }
      const section = rows[rows.length - 1].section;
      setLoopSection(section);
    } else {
      s.deckA = null;
      s.xfade = 1;
      s.synth?.setCrossfade(1);
    }
    setPerform((p) => ({ ...p, loaded: s.deckA ? bars : 0, loadBars: bars > 0 ? bars : p.loadBars, xfade: s.xfade }));
    note(["load", s.deckA ? bars : 0]);
  }, [note]);
  const setLoadBars = useCallback((bars: number) => setPerform((p) => ({ ...p, loadBars: bars })), []);

  const setXfade = useCallback((value: number) => {
    const s = state.current;
    s.xfade = Math.max(0, Math.min(1, value));
    s.synth?.setCrossfade(s.xfade);
    setPerform((p) => ({ ...p, xfade: s.xfade }));
    note(["xfade", Math.round(s.xfade * 100) / 100]);
  }, [note]);

  /** Repeat the current sixteenths while a roll key is held. */
  const setRoll = useCallback((length: number) => {
    const s = state.current;
    if (length > 0 && s.synth) {
      const next = s.synth.nextCount;
      s.roll = { length, from: next - (next % length) };
    } else {
      s.roll = null;
    }
    setPerform((p) => (p.roll === (s.roll?.length ?? 0) ? p : { ...p, roll: s.roll?.length ?? 0 }));
    note(["roll", s.roll?.length ?? 0]);
  }, [note]);

  const setPixel = useCallback((mode: PixelMode) => {
    state.current.pixel = mode;
    state.current.fieldDirty = true;
    setPerform((p) => ({ ...p, pixel: mode }));
    note(["pixel", mode]);
  }, [note]);

  const setCarved = useCallback((cols: number[]) => {
    const s = state.current;
    s.carved = new Set(cols);
    s.carveVersion += 1;
    setPerform((p) => ({ ...p, carved: s.carved.size }));
    note(["carve", cols]);
  }, [note]);

  /** Start or stop recording: the sound into a file, the performance into a replayable link. */
  const record = useCallback(() => {
    const s = state.current;
    if (!s.synth || !deckRef.current) return;
    if (!s.take) {
      s.take = { start: performance.now(), y0: Math.round(s.readY), deck: deckRef.current, events: [], lastY: Math.round(s.readY) };
      s.takeAudio = s.synth.startRecording();
      s.takeBlob = null;
      s.takePerformance = null;
      setPerform((p) => ({ ...p, recording: true, take: null }));
      return;
    }
    const take = s.take;
    s.take = null;
    s.takePerformance = { v: 1, width: window.innerWidth, y0: take.y0, deck: take.deck, events: take.events };
    s.synth.stopRecording();
    const audio = s.takeAudio;
    s.takeAudio = null;
    setPerform((p) => ({ ...p, recording: false, take: { audio: false, link: true } }));
    void audio?.then((blob) => {
      s.takeBlob = blob;
      setPerform((p) => ({ ...p, take: { audio: blob.size > 0, link: true } }));
    });
  }, []);

  const saveAudio = useCallback(() => {
    const blob = state.current.takeBlob;
    if (blob) download(blob, `alexsonicLAb-${stamp()}.${blob.type.includes("mp4") ? "m4a" : "webm"}`);
  }, []);

  const copyLink = useCallback(async () => {
    const performanceTake = state.current.takePerformance;
    if (!performanceTake) return false;
    const url = `${window.location.origin}${window.location.pathname}?${linkQuery}#perf=${await encodePerformance(performanceTake)}`;
    try {
      await navigator.clipboard.writeText(url);
      return true;
    } catch {
      window.prompt("Copy this link to replay the performance:", url);
      return false;
    }
  }, [linkQuery]);

  /** The scan so far as a picture: every row read, pixel-sorted, one under the other. */
  const savePoster = useCallback(() => {
    const s = state.current;
    if (!s.poster.length) return;
    const cell = 3;
    const margin = 32;
    const cols = s.poster[0].inks.length;
    const canvas = document.createElement("canvas");
    canvas.width = cols * cell + margin * 2;
    canvas.height = s.poster.length * cell + margin * 2 + 40;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#0b0b0c";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    s.poster.forEach((line, y) => {
      const accent = accentOf(line.section);
      for (let x = 0; x < line.inks.length; x += 1) {
        const ink = line.inks[x];
        if (ink === Ink.Blank) continue;
        ctx.fillStyle = inkColour(ink, accent, Math.min(1, (INK_ALPHA[ink] ?? 0.5) + 0.25));
        ctx.fillRect(margin + x * cell, margin + y * cell, cell, cell);
      }
    });
    ctx.fillStyle = "#6b6d72";
    ctx.font = "12px ui-monospace, Menlo, monospace";
    const d = deckRef.current;
    ctx.fillText(`alexsonicLAb · ${s.poster.length} rows read · ${styleById(d?.style).name} · build ${BUILD} · ${new Date().toISOString().slice(0, 10)}`, margin, canvas.height - margin + 4);
    canvas.toBlob((blob) => blob && download(blob, `alexsonicLAb-scan-${stamp()}.png`), "image/png");
  }, []);

  const stopReplay = useCallback(() => {
    const s = state.current;
    s.replayTimers.forEach((timer) => window.clearTimeout(timer));
    s.replayTimers = [];
    if (s.replay) {
      s.replay = null;
      setPerform((p) => ({ ...p, replay: null }));
    }
  }, []);

  /** Play a performance link back: its starting deck and position, then every move at its time. */
  const startReplay = useCallback(() => {
    const s = state.current;
    const take = s.replay;
    if (!take) return;
    setPerform((p) => ({ ...p, replay: "playing" }));
    setDeckState(take.deck, false);
    s.moveTo(take.y0);
    let end = 0;
    for (const event of take.events) {
      const [time, kind, value] = event;
      end = Math.max(end, time);
      s.replayTimers.push(window.setTimeout(() => {
        if (kind === "y") s.moveTo(value as number);
        else if (kind === "deck") setDeckState(value as DeckState, false);
        else if (kind === "load") load(value as number);
        else if (kind === "xfade") setXfade(value as number);
        else if (kind === "roll") setRoll(value as number);
        else if (kind === "pixel") setPixel(value as PixelMode);
        else if (kind === "carve") setCarved(value as number[]);
      }, time));
    }
    s.replayTimers.push(window.setTimeout(() => {
      s.replay = null;
      s.replayTimers = [];
      setPerform((p) => ({ ...p, replay: null }));
    }, end + 2000));
  }, [setDeckState, load, setXfade, setRoll, setPixel, setCarved]);

  const enter = useCallback(() => {
    const s = state.current;
    if (s.leaving) return;
    s.leaving = true;
    setLeaving(true);
    stopReplay();
    s.synth?.stop(0.7);
    s.synth = null;
    // Land with the read line where it was on screen (only on the page that was read, under the Lab).
    const target = Math.max(0, s.readY - window.innerHeight * AXIS);
    window.setTimeout(() => {
      onClose();
      if (!given) window.setTimeout(() => window.scrollTo({ top: target, behavior: "instant" as ScrollBehavior }), 30);
    }, prefersReducedMotion ? 0 : 720);
  }, [onClose, stopReplay, given]);

  const power = useCallback(() => {
    const s = state.current;
    setStarted(true);
    const d = deckRef.current;
    if (s.synth || s.leaving || !d) return;
    try {
      const synth = new SonicSynth(styleById(d.style), (style, step, count) => {
        let n = count;
        // A roll repeats the same few sixteenths over and over, on both decks.
        if (s.roll) n = s.roll.from + ((n - s.roll.from) % s.roll.length);
        const position = s.roll ? n % 16 : step;
        const wiring = { routes: deckRef.current?.routes ?? DEFAULT_ROUTES, carved: s.carved, carveVersion: s.carveVersion };
        const hits: DeckHit[] = [];
        // Deck B: the bar just scanned.
        if (s.xfade > 0.001) for (const hit of compose(style, s.bar, position, wiring)) hits.push({ deck: "b", hit });
        // Deck A: its loop, bar by bar.
        const loop = s.deckA;
        if (loop && s.xfade < 0.999) {
          const index = n % loop.length;
          const barStart = index - (index % 16);
          for (const hit of compose(style, loop.slice(barStart, barStart + 16), index % 16, wiring)) hits.push({ deck: "a", hit });
          s.loopIndex = index;
        }
        return hits;
      });
      // When a pending style starts on the bar line, the deck shows it as the one playing.
      synth.onBar = (style) => {
        const current = deckRef.current;
        if (current?.pending === style.id) setDeckState({ ...current, style: style.id, pending: null }, false);
      };
      s.synth = synth;
      applyDeck(d);
      synth.start();
      setPowered(true);
      if (s.replay) startReplay();
    } catch {
      setPowered(false); // no Web Audio: the scan still works, silently
    }
  }, [applyDeck, setDeckState, startReplay]);

  useEffect(() => {
    if (!open) return;
    const initial = initialDeck();
    deckRef.current = initial;
    setDeck(initial);
    // A performance link carries its own deck and moves; it plays once the sound is switched on.
    const packed = new URLSearchParams(window.location.hash.slice(1)).get("perf");
    if (packed) {
      void decodePerformance(packed).then((take) => {
        if (!take) return;
        state.current.replay = take;
        setPerform((p) => ({ ...p, replay: "ready" }));
      });
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const root = rootRef.current;
    const field = fieldRef.current;
    const axis = axisRef.current;
    const fieldCtx = field?.getContext("2d");
    const axisCtx = axis?.getContext("2d");
    const main = given ? null : document.querySelector("main");
    if (!root || !field || !axis || !fieldCtx || !axisCtx || (!given && !main)) return;
    // The field is drawn once into a buffer; melting shifts slices of the buffer every frame.
    const buffer = document.createElement("canvas");
    const bufferCtx = buffer.getContext("2d");
    if (!bufferCtx) return;
    const s = state.current;
    s.leaving = false;
    // Start reading where the visitor is: the line at the axis height of the screen they were looking at.
    s.readY = window.scrollY + window.innerHeight * AXIS;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    root.focus({ preventScroll: true });
    let dpr = 1;

    const rowAt = (index: number) => {
      let row = s.cache.get(index);
      if (!row && s.snapshot) {
        row = readRow(s.snapshot, index, s.cols);
        s.cache.set(index, row);
      }
      return row;
    };
    const maxRow = () => Math.floor(((s.snapshot?.height ?? 1) - 1) / ROW_PX);
    const sortedAt = (row: ScanRow) => {
      let sorted = s.sorted.get(row.index);
      if (!sorted) {
        sorted = sortRow(row);
        s.sorted.set(row.index, sorted);
      }
      return sorted;
    };

    const takeSnapshot = () => {
      s.snapshot = given ?? snapshotPage(main as HTMLElement);
      s.cache.clear();
      s.sorted.clear();
      s.fieldDirty = true;
      s.row = Math.floor(s.readY / ROW_PX);
      const section = s.snapshot.sections.find((x) => s.readY >= x.top && s.readY < x.bottom)?.id ?? "top";
      setReadout((r) => ({ ...r, y: Math.round(s.readY), height: s.snapshot?.height ?? 1, section }));
    };

    const layout = () => {
      const box = root.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      for (const canvas of [field, axis, buffer]) {
        canvas.width = Math.round(box.width * dpr);
        canvas.height = Math.round(box.height * dpr);
      }
      axisCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      bufferCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const size = box.width < 640 ? 10 : 13;
      bufferCtx.font = `${size}px ui-monospace, "SF Mono", Menlo, "JetBrains Mono", monospace`;
      bufferCtx.textBaseline = "top";
      s.cell = { w: bufferCtx.measureText("M").width, h: Math.round(size * 1.3) };
      s.cols = Math.max(20, Math.floor(box.width / s.cell.w));
      s.size = { w: box.width, h: box.height };
      s.cache.clear();
      s.sorted.clear();
      s.fieldDirty = true;
    };

    /** The ASCII field around the read head, into the buffer. Only when the row under the head changes. */
    const drawField = () => {
      const { w: width, h: height } = s.size;
      const { w, h } = s.cell;
      bufferCtx.clearRect(0, 0, width, height);
      const axisY = height * AXIS;
      const center = Math.floor(axisY / h);
      const lines = Math.ceil(height / h);
      const top = axisY - center * h - h / 2;
      for (let k = 0; k < lines; k += 1) {
        const offset = k - center;
        if (offset === 0) continue; // the axis draws the row being read
        const index = s.row + offset;
        if (index < 0 || index > maxRow()) continue;
        const row = rowAt(index);
        if (!row) continue;
        // In SORT mode the rows already read are shown pixel-sorted.
        const { chars, inks } = offset < 0 && s.pixel === "sort" ? sortedAt(row) : row;
        // Read rows above the axis at full strength, rows still to come below it as ghosts; both fade with distance.
        const distance = Math.min(1, Math.abs(offset) / Math.max(center, lines - center));
        const fade = (offset < 0 ? 1 : 0.22) * (1 - distance * distance * 0.75);
        const accent = accentOf(row.section);
        const y = top + k * h;
        let start = 0;
        for (let c = 1; c <= chars.length; c += 1) {
          if (c === chars.length || inks[c] !== inks[start]) {
            const ink = inks[start];
            if (ink !== Ink.Blank) {
              bufferCtx.fillStyle = inkColour(ink, accent, (INK_ALPHA[ink] ?? 0.5) * fade);
              bufferCtx.fillText(chars.slice(start, c), start * w, y);
            }
            start = c;
          }
        }
      }
    };

    /** The buffer onto the screen: as it is, or melted in vertical slices that sway with the sound. */
    const present = (now: number) => {
      fieldCtx.setTransform(1, 0, 0, 1, 0, 0);
      fieldCtx.clearRect(0, 0, field.width, field.height);
      if (s.pixel !== "melt") {
        fieldCtx.drawImage(buffer, 0, 0);
        return;
      }
      const slice = Math.round(6 * dpr);
      const t = now / 1000;
      const amp = (6 + s.energy * 34) * dpr;
      for (let x = 0; x < field.width; x += slice) {
        const u = x / dpr;
        const dy = amp * (Math.sin(u * 0.018 + t * 2.2) * 0.7 + Math.sin(u * 0.051 - t * 3.1) * 0.3);
        fieldCtx.drawImage(buffer, x, 0, slice, field.height, x, dy, slice, field.height);
      }
    };

    /** The axis: only the pixels of the row being read (or, in a held loop, the row being played). Every frame. */
    const drawAxis = () => {
      const { w: width, h: height } = s.size;
      axisCtx.clearRect(0, 0, width, height);
      const mid = Math.round(height * AXIS);
      const row = rowAt(s.row);
      const accent = accentOf(row?.section);
      const [r, g, b] = accent;
      axisCtx.fillStyle = "rgba(11,11,12,0.9)";
      axisCtx.fillRect(0, mid - 16, width, 32);
      axisCtx.fillStyle = `rgba(${r},${g},${b},0.18)`;
      axisCtx.fillRect(0, mid, width, 1);
      const cw = width / s.cols;
      if (row) {
        const { inks } = s.pixel === "sort" ? sortedAt(row) : row;
        for (let c = 0; c < inks.length; c += 1) {
          const ink = inks[c];
          if (ink === Ink.Blank || s.carved.has(c)) continue;
          axisCtx.fillStyle = inkColour(ink, accent, Math.min(1, (INK_ALPHA[ink] ?? 0.5) + 0.3));
          axisCtx.fillRect(c * cw, mid - 7, Math.max(1, cw - 1), 14);
        }
      }
      // Carved columns: cut out of the axis and out of every source the players read.
      axisCtx.fillStyle = "rgba(255,90,77,0.7)";
      for (const c of s.carved) axisCtx.fillRect(c * cw + cw / 2 - 0.5, mid - 15, 1, 30);
      axisCtx.fillStyle = `rgba(${r},${g},${b},0.55)`;
      axisCtx.fillRect(0, mid - 16, width, 1);
      axisCtx.fillRect(0, mid + 15, width, 1);
    };

    /** The deck's oscilloscope, and the loudness that drives melting. */
    const drawScope = () => {
      const analyser = s.synth?.analyser;
      let sum = 0;
      if (analyser) {
        analyser.getByteTimeDomainData(s.wave);
        for (let i = 0; i < s.wave.length; i += 8) sum += ((s.wave[i] - 128) / 128) ** 2;
      }
      const rms = Math.sqrt(sum / (s.wave.length / 8));
      s.energy = Math.max(rms * 3, s.energy * 0.9);
      const canvas = scope.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const [r, g, b] = accentOf(rowAt(s.row)?.section);
      const mid = h / 2;
      ctx.beginPath();
      if (analyser) {
        const n = s.wave.length;
        for (let i = 0; i < n; i += 2) {
          const x = (i / (n - 1)) * w;
          const y = mid + Math.max(-mid + 2, Math.min(mid - 2, ((s.wave[i] - 128) / 128) * h * 1.1));
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
      } else {
        ctx.moveTo(0, mid);
        ctx.lineTo(w, mid);
      }
      ctx.strokeStyle = `rgba(${r},${g},${b},0.25)`;
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.strokeStyle = `rgba(${r},${g},${b},0.95)`;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    };

    /** The deck's meters, filter readout and step lights, written straight into their spans. */
    const drawLive = () => {
      const synth = s.synth;
      // The turntables: the marker goes round once a bar; deck A only turns while it holds a loop.
      const step = synth ? synth.playhead() : -1;
      const spinB = synth && step >= 0 ? platter(Math.floor(step / 2)) : platter(null);
      const spinA = synth && s.deckA && step >= 0 ? platter(Math.floor((s.loopIndex % 16) / 2)) : platter(null);
      for (const [name, element] of live.current) {
        if (name.startsWith("plat")) {
          const line = Number(name.slice(6)); // "platA:3" → 3
          const next = (name.startsWith("platA") ? spinA : spinB)[line];
          if (element.textContent !== next) element.textContent = next;
          continue;
        }
        const length = element.textContent?.length ?? 0;
        if (!length) continue;
        if (name.startsWith("meter:")) {
          // A muted (or soloed-out) player's meter stays dark even though it keeps reading.
          const player = name.slice(6) as PlayerId;
          const d = deckRef.current;
          const silenced = !d || d.mutes.includes(player) || (d.solos.length > 0 && !d.solos.includes(player));
          const level = synth && !silenced ? synth.activity(player) : 0;
          const lit = Math.round(level * length);
          element.textContent = "▮".repeat(lit) + "·".repeat(length - lit);
        } else if (name === "filter") {
          const amount = Math.log(s.cutoff / 380) / Math.log(9580 / 380);
          const lit = Math.round(Math.max(0, Math.min(1, amount)) * length);
          element.textContent = "▇".repeat(lit) + "▁".repeat(length - lit);
        } else if (name === "steps") {
          element.textContent = Array.from({ length }, (_, i) => (i === step ? "■" : i % 4 === 0 ? "▪" : "·")).join("");
        }
      }
    };

    let frame = 0;
    let last = 0;
    const tick = (now: number) => {
      frame = 0;
      if (document.hidden || s.leaving) return;
      if (now - last >= 33) {
        last = now;
        if (s.fieldDirty) {
          s.fieldDirty = false;
          drawField();
          present(now);
        } else if (s.pixel === "melt") {
          present(now);
        }
        drawAxis();
        drawScope();
        drawLive();
      }
      frame = requestAnimationFrame(tick);
    };
    const run = () => {
      if (!frame && !document.hidden) frame = requestAnimationFrame(tick);
    };

    /** Move the page under the read head and feed every row it passes to the players. */
    const move = (delta: number) => {
      if (!s.snapshot || s.leaving) return;
      setStarted(true);
      const max = s.snapshot.height - 1;
      s.readY = Math.max(0, Math.min(max, s.readY + delta));
      s.moved += Math.abs(delta);
      const row = Math.floor(s.readY / ROW_PX);
      if (row === s.row) return;
      const direction = row > s.row ? 1 : -1;
      const from = Math.abs(row - s.row) > 16 ? row - direction * 15 : s.row + direction;
      for (let i = from; direction > 0 ? i <= row : i >= row; i += direction) {
        const scanned = rowAt(i);
        if (!scanned) continue;
        s.bar.push(scanned);
        s.history.push(scanned);
        if (s.poster.length < 3000) s.poster.push({ inks: sortRow(scanned).inks, section: scanned.section });
      }
      if (s.bar.length > 16) s.bar.splice(0, s.bar.length - 16);
      if (s.history.length > HISTORY) s.history.splice(0, s.history.length - HISTORY);
      s.row = row;
      s.fieldDirty = true;
      const complete = s.readY >= max - window.innerHeight * 0.2;
      setReadout({ y: Math.round(s.readY), height: s.snapshot.height, section: rowAt(row)?.section ?? "top", complete });
    };
    s.moveTo = (y: number) => move(y - s.readY);

    // Ten times a second: the speed of scanning drives the master filter, and a recording notes where the head is.
    const meter = window.setInterval(() => {
      s.speed = s.speed * 0.6 + s.moved * 10 * 0.4;
      s.moved = 0;
      if (s.synth) s.cutoff = s.synth.setBrightness(s.speed / 2600);
      const take = s.take;
      if (take && Math.round(s.readY) !== take.lastY) {
        take.lastY = Math.round(s.readY);
        take.events.push([Math.round(performance.now() - take.start), "y", take.lastY]);
      }
    }, 100);

    // A visitor's own scrolling or keys take over from a replay.
    const userMove = (delta: number) => {
      if (s.replay && performRef.current.replay === "playing") stopReplay();
      move(delta);
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      userMove(event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1));
    };
    let touchY = 0;
    const onTouchStart = (event: TouchEvent) => { touchY = event.touches[0]?.clientY ?? 0; };
    const onTouchMove = (event: TouchEvent) => {
      event.preventDefault();
      const y = event.touches[0]?.clientY ?? touchY;
      userMove((touchY - y) * 1.6);
      touchY = y;
    };
    const rollKeys: Record<string, number> = { KeyZ: 4, KeyX: 2, KeyC: 1 };
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const steps: Record<string, number> = { ArrowDown: 80, ArrowUp: -80, PageDown: 600, PageUp: -600, " ": 600 };
      const style = STYLES.find((x) => x.key === event.key);
      const player = PLAYERS.find((x) => `Key${x.key.toUpperCase()}` === event.code);
      if (event.key in steps) {
        event.preventDefault();
        userMove(steps[event.key]);
        power();
      } else if (style) {
        event.preventDefault();
        power();
        chooseStyle(style.id);
      } else if (player) {
        event.preventDefault();
        power();
        toggle(event.shiftKey ? "solos" : "mutes", player.id);
      } else if (event.code === "KeyL") {
        event.preventDefault();
        power();
        load(performRef.current.loadBars);
      } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        setXfade(s.xfade + (event.key === "ArrowLeft" ? -0.125 : 0.125));
      } else if (event.code in rollKeys && !event.repeat) {
        event.preventDefault();
        setRoll(rollKeys[event.code]);
      } else if (event.code === "KeyP") {
        event.preventDefault();
        setPixel(s.pixel === "normal" ? "sort" : s.pixel === "sort" ? "melt" : "normal");
      } else if (event.key === "Enter" || event.key === "Escape") {
        event.preventDefault();
        enter();
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code in rollKeys && s.roll?.length === rollKeys[event.code]) setRoll(0);
    };
    // Clicking the axis carves a column out of the page: it falls silent in every source.
    const onPointerDown = (event: PointerEvent) => {
      if ((event.target as HTMLElement).closest(".sonic-deck")) return;
      const box = root.getBoundingClientRect();
      if (Math.abs(event.clientY - box.top - box.height * AXIS) > 18) return;
      const c = Math.floor((event.clientX - box.left) / (box.width / s.cols));
      const next = new Set(s.carved);
      const cut = !next.has(c);
      for (const col of [c - 1, c, c + 1]) {
        if (col < 0 || col >= s.cols) continue;
        if (cut) next.add(col);
        else next.delete(col);
      }
      setCarved(Array.from(next).sort((a, b) => a - b));
    };
    root.addEventListener("wheel", onWheel, { passive: false });
    root.addEventListener("touchstart", onTouchStart, { passive: true });
    root.addEventListener("touchmove", onTouchMove, { passive: false });
    root.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);

    const onVisibility = () => {
      const ctx = s.synth?.context;
      if (ctx) void (document.hidden ? ctx.suspend() : ctx.resume());
      run();
    };
    document.addEventListener("visibilitychange", onVisibility);

    let snapTimer = 0;
    const resized = new ResizeObserver(() => {
      window.clearTimeout(snapTimer);
      snapTimer = window.setTimeout(takeSnapshot, 200);
    });
    if (main) resized.observe(main);
    const onResize = () => layout();
    window.addEventListener("resize", onResize);

    layout();
    takeSnapshot();
    if (!given) void document.fonts?.ready.then(takeSnapshot);
    run();

    return () => {
      cancelAnimationFrame(frame);
      window.clearInterval(meter);
      window.clearTimeout(snapTimer);
      resized.disconnect();
      root.removeEventListener("wheel", onWheel);
      root.removeEventListener("touchstart", onTouchStart);
      root.removeEventListener("touchmove", onTouchMove);
      root.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
      document.body.style.overflow = previousOverflow;
      s.replayTimers.forEach((timer) => window.clearTimeout(timer));
      s.replayTimers = [];
      s.synth?.stop(0.3);
      s.synth = null;
      s.bar = [];
      s.history = [];
      s.deckA = null;
      s.xfade = 1;
      s.roll = null;
      s.take = null;
    };
  }, [open, given, enter, power, chooseStyle, toggle, load, setXfade, setRoll, setPixel, setCarved, stopReplay]);

  // Reset for the next time the Lab is opened from the header.
  useEffect(() => {
    if (open) return;
    setLeaving(false);
    setStarted(false);
    setPowered(false);
    setPerform((p) => ({ ...p, loaded: 0, xfade: 1, roll: 0, recording: false, replay: null }));
  }, [open]);

  // Scanned to the end: the scan completes and opens onto the page (not while deck A loops or a replay runs).
  useEffect(() => {
    if (!autoEnter || !open || !readout.complete || leaving || perform.loaded || perform.replay) return;
    const timer = window.setTimeout(enter, 2200);
    return () => window.clearTimeout(timer);
  }, [autoEnter, open, readout.complete, readout.y, leaving, perform.loaded, perform.replay, enter]);

  const registerLive = useCallback((name: string, element: HTMLSpanElement | null) => {
    if (element) live.current.set(name, element);
    else live.current.delete(name);
  }, []);

  if (!open) return null;
  const percent = Math.min(100, Math.round((readout.y / Math.max(1, readout.height)) * 100));
  const label = perform.replay === "ready" ? "REPLAY · CLICK TO PLAY" : perform.replay === "playing" ? "REPLAYING" : readout.complete ? "SCAN COMPLETE" : started ? "SCANNING" : "STANDBY";

  return (
    <div
      ref={rootRef}
      className={`sonic-lab${leaving ? " is-leaving" : ""}${started ? " is-started" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label="alexsonicLAb. Scroll to read the site, click for sound, keys 1 to 6 change style, H holds a loop, Enter goes to the portfolio."
      tabIndex={-1}
      onClick={power}
    >
      <canvas ref={fieldRef} className="sonic-lab__canvas" aria-hidden />
      <canvas ref={axisRef} className="sonic-lab__canvas" aria-hidden />

      <div className="sonic-lab__bottom">
        {/* The way into the portfolio, always in reach: the Lab is a welcome page first. */}
        <button type="button" className="sonic-enter" onClick={(event) => { event.stopPropagation(); enter(); }}>
          <span>{powered ? enterLabels.loud : enterLabels.silent}</span>
          <b>↵</b>
          <small>{powered ? enterLabels.loudHint : enterLabels.silentHint}</small>
        </button>
        {deck && (
          <SonicDeck
            state={deck}
            perform={perform}
            bpm={styleById(deck.pending ?? deck.style).bpm}
            status={{ label, y: readout.y, height: readout.height, percent, section: readout.section }}
            loopSection={loopSection}
            build={BUILD}
            registerLive={registerLive}
            scopeRef={scope}
            actions={{
              onStyle: (id) => { power(); chooseStyle(id); },
              onMute: (player) => toggle("mutes", player),
              onLoad: () => { power(); load(perform.loadBars); },
              onLoadBars: (bars) => (perform.loaded ? load(bars) : setLoadBars(bars)),
              onEject: () => load(0),
              onXfade: setXfade,
              onRoll: setRoll,
              onPixel: setPixel,
              onClearCarve: () => setCarved([]),
              onRecord: record,
              onSaveAudio: saveAudio,
              onCopyLink: copyLink,
              onPoster: savePoster,
            }}
          />
        )}
      </div>
    </div>
  );
}
