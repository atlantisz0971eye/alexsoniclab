"use client";

import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { PLAYERS, STYLES, type PlayerId, type StyleId } from "../data/sonicStyles";
import type { PixelMode } from "../lib/sonicPerformance";
import type { Routes } from "../lib/sonicPlayers";

/**
 * The DJ console of alexsonicLAb, drawn as a grid of monospace characters: deck A (a captured loop) on the left,
 * deck B (the live scan) on the right, each with a turntable whose marker turns with the bar, and a small mixer
 * between them. Its keys are characters too. The turntables, step lights and scope are written by the Lab.
 */

export type DeckState = {
  style: StyleId;
  pending: StyleId | null;
  levels: Record<PlayerId, number>;
  mutes: PlayerId[];
  solos: PlayerId[];
  delay: number;
  reverb: number;
  /** Which source each player reads (kept for shared links; the console no longer rewires them). */
  routes: Routes;
};

/** Live performance state that is not part of a saved setup. */
export type PerformState = {
  /** Bars held in deck A, 0 when it is empty. */
  loaded: number;
  loadBars: number;
  xfade: number;
  roll: number;
  pixel: PixelMode;
  carved: number;
  recording: boolean;
  take: { audio: boolean; link: boolean } | null;
  replay: "ready" | "playing" | null;
};

export type PerformActions = {
  onStyle: (id: StyleId) => void;
  onMute: (player: PlayerId) => void;
  onLoad: () => void;
  onLoadBars: (bars: number) => void;
  onEject: () => void;
  onXfade: (value: number) => void;
  onRoll: (sixteenths: number) => void;
  onPixel: (mode: PixelMode) => void;
  onClearCarve: () => void;
  onRecord: () => void;
  onSaveAudio: () => void;
  onCopyLink: () => Promise<boolean>;
  onPoster: () => void;
};

type DeckProps = {
  state: DeckState;
  perform: PerformState;
  actions: PerformActions;
  bpm: number;
  status: { label: string; y: number; height: number; percent: number; section: string };
  /** The section deck A's loop was taken from. */
  loopSection: string | null;
  build: string;
  registerLive: (name: string, element: HTMLSpanElement | null) => void;
  scopeRef: RefObject<HTMLCanvasElement | null>;
};

type Cell = { text: string; className?: string; title?: string; onClick?: () => void; hold?: { down: () => void; up: () => void }; live?: string };

/** A turntable, 13 by 7 characters, with a marker on its rim at one of eight positions (or none). */
const PLATTER = ["   .-~~~-.   ", " .'       '. ", "/           \\", "|     ◉     |", "\\           /", " '.       .' ", "   '-...-'   "];
const RIM: [number, number][] = [[1, 6], [2, 9], [3, 10], [4, 9], [5, 6], [4, 3], [3, 2], [2, 3]];
export const PLATTER_LINES = PLATTER.length;
export function platter(position: number | null): string[] {
  const lines = PLATTER.map((line) => line.split(""));
  if (position !== null) {
    const [r, c] = RIM[((position % RIM.length) + RIM.length) % RIM.length];
    lines[r][c] = "◆";
  }
  return lines.map((line) => line.join(""));
}

const PLAYER_KEYS: Record<PlayerId, string> = { architect: "ARCH", typist: "TYPE", headliner: "HEAD", photographer: "PHOTO", linker: "LINK" };

export function SonicDeck({ state, perform, actions, bpm, status, loopSection, build, registerLive, scopeRef }: DeckProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const probeRef = useRef<HTMLSpanElement | null>(null);
  const [cols, setCols] = useState(0);
  const [linkCopied, setLinkCopied] = useState(false);

  // How many characters fit across: the console is laid out in whole characters.
  useLayoutEffect(() => {
    const root = rootRef.current;
    const probe = probeRef.current;
    if (!root || !probe) return;
    const measure = () => {
      const charWidth = probe.getBoundingClientRect().width / 10 || 7.8;
      setCols(Math.floor(root.clientWidth / charWidth));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  const copyLink = async () => {
    const ok = await actions.onCopyLink();
    setLinkCopied(ok);
    window.setTimeout(() => setLinkCopied(false), 1600);
  };

  const text = (t: string, className?: string): Cell => ({ text: t, className });
  const press = (label: string, on: boolean, onClick: () => void, title?: string): Cell => ({ text: label, className: on ? "is-on" : "is-key", onClick, title });
  const width = (cells: Cell[]) => cells.reduce((sum, cell) => sum + cell.text.length, 0);
  /** Cells padded to an exact width, left or centred. */
  const span = (cells: Cell[], w: number, align: "left" | "center" = "left"): Cell[] => {
    const used = width(cells);
    if (used >= w) return cells;
    const gap = w - used;
    const left = align === "left" ? 0 : Math.floor(gap / 2);
    return [text(" ".repeat(left)), ...cells, text(" ".repeat(gap - left))];
  };

  const styleIndex = Math.max(0, STYLES.findIndex((s) => s.id === (state.pending ?? state.style)));
  const shift = (by: number) => actions.onStyle(STYLES[(styleIndex + by + STYLES.length) % STYLES.length].id);
  const styleCells: Cell[] = [
    press("◀", false, () => shift(-1), "Previous style (keys 1–6)"),
    { text: ` ${STYLES[styleIndex].name} `, className: state.pending ? "is-pending" : "is-bright" },
    press("▶", false, () => shift(1), "Next style (keys 1–6)"),
    text(`  ${bpm} BPM`, "is-dim"),
  ];
  const playerCells: Cell[] = PLAYERS.flatMap((player, i) => [
    ...(i ? [text(" ")] : []),
    press(`[${PLAYER_KEYS[player.id]}]`, !state.mutes.includes(player.id), () => actions.onMute(player.id), `${player.name}: ${player.reads} → ${player.plays} (${player.key.toUpperCase()} mutes)`),
  ]);
  const loadCells: Cell[] = [
    press(perform.loaded ? "[◀ RELOAD A]" : "[◀ LOAD A]", false, actions.onLoad, "Capture the last bars of the live deck into deck A (L)"),
    text(" "),
    ...[1, 2, 4, 8].flatMap((bars) => [press(`${bars}`, perform.loadBars === bars, () => actions.onLoadBars(bars), `${bars} bar loop`), text(" ")]),
    ...(perform.loaded ? [press("[EJECT]", false, actions.onEject, "Empty deck A")] : []),
  ];
  // The crossfader: a track of characters, each one a position.
  const track = 17;
  const knob = Math.round(perform.xfade * (track - 1));
  const faderCells: Cell[] = [
    text("A ┃", perform.xfade < 0.5 ? "is-bright" : "is-dim"),
    ...Array.from({ length: track }, (_, i): Cell => ({ text: i === knob ? "●" : "━", className: i === knob ? "is-knob" : "is-track", onClick: () => actions.onXfade(i / (track - 1)), title: "Crossfader (← →)" })),
    text("┃ B", perform.xfade > 0.5 ? "is-bright" : "is-dim"),
  ];
  const rollCells: Cell[] = [
    text("ROLL ", "is-dim"),
    ...([[4, "¼", "Z"], [2, "⅛", "X"], [1, "1/16", "C"]] as const).flatMap(([steps, label, k], i) => [
      ...(i ? [text(" ")] : []),
      { text: `[${label}]`, className: perform.roll === steps ? "is-on" : "is-key", title: `Hold to repeat (${k})`, hold: { down: () => actions.onRoll(steps), up: () => actions.onRoll(0) } },
    ]),
    text("   "),
    ...(["normal", "sort", "melt"] as const).flatMap((mode, i) => [...(i ? [text(" ")] : []), press(mode === "normal" ? "[PIX]" : `[${mode.toUpperCase()}]`, perform.pixel === mode, () => actions.onPixel(mode), `Pixel ${mode} (P)`)]),
  ];
  const takeCells: Cell[] = [
    press(perform.recording ? "[■ STOP]" : "[● REC]", perform.recording, actions.onRecord, "Record the sound and the performance"),
    ...(perform.take?.audio ? [text(" "), press("[AUDIO↓]", false, actions.onSaveAudio, "Save the recording")] : []),
    ...(perform.take?.link ? [text(" "), { text: linkCopied ? "[COPIED]" : "[LINK⧉]", className: "is-key", title: "Copy a link that replays this performance", onClick: () => void copyLink() }] : []),
    text(" "),
    press("[POSTER↓]", false, actions.onPoster, "Save the scan as a pixel-sorted image"),
    ...(perform.carved ? [text(` CUT ${perform.carved} `, "is-dim"), press("[×]", false, actions.onClearCarve, "Clear the carved columns")] : []),
  ];
  const hint = text("click the axis to carve · 1–6 · QWERT · L · ←→ · ZXC · P", "is-dim");

  const lines: (Cell[] | { scope: number })[] = [];
  if (cols >= 96) {
    const side = PLATTER[0].length + 6; // a turntable and its margins
    const mid = cols - 2 - side * 2;
    const title = " alexsonicLAb ";
    const tail = ` build ${build} `;
    lines.push([text("┌─", "is-frame"), text(title, "is-bright"), text("─".repeat(Math.max(0, cols - 4 - title.length - tail.length)), "is-frame"), text(tail, "is-dim"), text("─┐", "is-frame")]);
    const row = (left: Cell[], middle: Cell[], right: Cell[]): Cell[] => [
      text("│", "is-frame"),
      ...span(left, side, "center"),
      ...span(middle, mid, "center"),
      ...span(right, side, "center"),
      text("│", "is-frame"),
    ];
    lines.push(row([text("DECK A · LOOP", perform.loaded ? "is-bright" : "is-dim")], styleCells, [text("DECK B · LIVE", "is-bright")]));
    const middle: Cell[][] = [playerCells, [], loadCells, faderCells, rollCells, takeCells, [hint]];
    for (let r = 0; r < PLATTER_LINES; r += 1) {
      lines.push(row(
        [{ text: platter(null)[r], live: `platA:${r}`, className: perform.loaded ? "is-platter" : "is-platter is-dim" }],
        middle[r],
        [{ text: platter(null)[r], live: `platB:${r}`, className: "is-platter" }],
      ));
    }
    lines.push(row(
      [text(perform.loaded ? `§${(loopSection ?? "top").toUpperCase()} · ${perform.loaded} BAR${perform.loaded > 1 ? "S" : ""}` : "EMPTY · LOAD A", "is-dim")],
      [text(status.label, "is-bright"), text(`  y ${status.y.toString().padStart(5, "0")}/${status.height}  ${status.percent}%  `, "is-dim"), { text: " ".repeat(16), live: "steps", className: "is-meter" }],
      [text(`§${status.section.toUpperCase()}`, "is-bright")],
    ));
    lines.push({ scope: 2 });
    lines.push([text("└" + "─".repeat(Math.max(0, cols - 2)) + "┘", "is-frame")]);
  } else if (cols > 0) {
    // Narrow screens: no turntables, just the mixer.
    const row = (cells: Cell[]): Cell[] => [text("│", "is-frame"), ...span(cells, cols - 2, "center"), text("│", "is-frame")];
    lines.push([text("┌─ alexsonicLAb " + "─".repeat(Math.max(0, cols - 17)) + "┐", "is-frame")]);
    lines.push(row(styleCells));
    lines.push(row([press(perform.loaded ? "[◀ A]" : "[◀ LOAD A]", false, actions.onLoad), text(" "), faderCells[0], ...faderCells.slice(1, -1).filter((_, i) => i % 2 === 0), faderCells[faderCells.length - 1]]));
    lines.push(row([text(`${status.label} · ${status.percent}% · §${status.section.toUpperCase()}`, "is-dim")]));
    lines.push({ scope: 1 });
    lines.push([text("└" + "─".repeat(Math.max(0, cols - 2)) + "┘", "is-frame")]);
  }

  const render = (cell: Cell, index: number): ReactNode => {
    if (cell.live) return <span key={index} ref={(el) => registerLive(cell.live!, el)} className={cell.className}>{cell.text}</span>;
    if (cell.hold) {
      const { down, up } = cell.hold;
      return (
        <button key={index} type="button" className={cell.className} title={cell.title} onPointerDown={(event) => { event.preventDefault(); down(); }} onPointerUp={up} onPointerLeave={up}>
          {cell.text}
        </button>
      );
    }
    if (cell.onClick) return <button key={index} type="button" className={cell.className} title={cell.title} onClick={() => cell.onClick!()}>{cell.text}</button>;
    return <span key={index} className={cell.className}>{cell.text}</span>;
  };

  return (
    <div ref={rootRef} className="sonic-deck">
      <span ref={probeRef} className="sonic-deck__probe" aria-hidden>0000000000</span>
      {lines.map((line, index) =>
        "scope" in line ? (
          <div key={index} className="sonic-deck__scope">
            {Array.from({ length: line.scope }, (_, k) => (
              <div key={k} className="sonic-deck__line">{[text("│", "is-frame"), text(" ".repeat(Math.max(0, cols - 2))), text("│", "is-frame")].map(render)}</div>
            ))}
            <canvas ref={scopeRef} style={{ width: `${Math.max(0, cols - 2)}ch` }} aria-hidden />
          </div>
        ) : (
          <div key={index} className="sonic-deck__line">{line.map(render)}</div>
        ),
      )}
    </div>
  );
}
