"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ParamControls } from "./components/ParamControls";
import { SonicLab } from "./components/SonicLab";
import { generateSet, newSeed } from "./lib/aiDj";
import { labSettings, PARAMS, readValues, writeValues, type Values } from "./lib/params";
import type { ScanSnapshot } from "./lib/scanPage";
import type { Performance } from "./lib/sonicPerformance";

/**
 * The standalone alexsonicLAb: type a web address, a server reads that page in a headless browser and sends back
 * only its geometry, and the same Lab as on Alex's portfolio plays it.
 */

type Phase =
  | { kind: "idle" }
  | { kind: "scanning"; url: string; since: number }
  | { kind: "error"; url: string; code: string; message: string }
  | { kind: "ready"; url: string; snapshot: ScanSnapshot; scanned: string };

const EXAMPLES = [
  { label: "WIKIPEDIA · TECHNO", url: "https://en.wikipedia.org/wiki/Techno" },
  { label: "NEWS · NPR TEXT", url: "https://text.npr.org/" },
  { label: "NEWS · BBC", url: "https://www.bbc.com/news" },
  { label: "PORTFOLIO · BRITTANY CHIANG", url: "https://brittanychiang.com/" },
  { label: "HACKER NEWS", url: "https://news.ycombinator.com/" },
];

const ENTER = { loud: "NEW URL", silent: "NEW URL", loudHint: "the sound stops when you leave", silentHint: "or click anywhere for sound" };
const SCAN_KEYS = new Set(PARAMS.filter((param) => param.layer === "scan").map((param) => param.key));
/** The page's own query: the address, every parameter that is not at its default, the AI seed, and whatever else
 * is already there (the Lab's style, mutes and routes). */
function writeQuery(url: string | null, values: Values, ai: { seed: string; on: boolean } | null) {
  const params = new URLSearchParams(window.location.search);
  for (const param of PARAMS) params.delete(param.key);
  params.delete("url");
  params.delete("seed");
  params.delete("ai");
  const next = new URLSearchParams([...(url ? [["url", url]] : []), ...writeValues(values), ...(ai ? [["seed", ai.seed], ...(ai.on ? [["ai", "1"]] : [])] : []), ...params.entries()]);
  window.history.replaceState(null, "", `${window.location.pathname}${next.size ? `?${next}` : ""}${window.location.hash}`);
}
const withScheme = (input: string) => (/^[a-z][a-z0-9+.-]*:/i.test(input.trim()) ? input.trim() : `https://${input.trim()}`);

export default function Home() {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [input, setInput] = useState("");
  const [tick, setTick] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const request = useRef<AbortController | null>(null);
  const [values, setValues] = useState<Values>(() => readValues(new URLSearchParams()));
  const valuesRef = useRef(values);
  valuesRef.current = values;
  const [setup, setSetup] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [seed, setSeed] = useState<string | null>(null);
  const [play, setPlay] = useState<Performance | null>(null);
  const aiOnLoad = useRef(false);

  const scan = useCallback(async (raw: string) => {
    const url = withScheme(raw);
    if (!raw.trim()) return;
    const scanQuery = new URLSearchParams([["url", url], ...writeValues(valuesRef.current, "scan")]).toString();
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setInput(url);
    setPhase({ kind: "scanning", url, since: Date.now() });
    // The address goes into the page's own URL, so a reload or a shared link reads it again.
    writeQuery(url, valuesRef.current, null);
    setPlay(null);
    try {
      const response = await fetch(`/api/scan?${scanQuery}`, { signal: controller.signal });
      const body = await response.json().catch(() => ({ ok: false, code: "internal", message: "The scanner answered with something unreadable." }));
      if (controller.signal.aborted) return;
      if (body.ok) setPhase({ kind: "ready", url, snapshot: body.snapshot, scanned: writeValues(valuesRef.current, "scan").join("&") });
      else setPhase({ kind: "error", url, code: body.code, message: body.message });
    } catch {
      if (!controller.signal.aborted) setPhase({ kind: "error", url, code: "network", message: "The scanner could not be reached." });
    }
  }, []);

  // A link reads its page straight away, with its parameters, and with ?ai=1 the AI DJ plays its seed.
  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    const loaded = readValues(search);
    valuesRef.current = loaded;
    setValues(loaded);
    if (search.get("seed")) setSeed(search.get("seed"));
    aiOnLoad.current = search.get("ai") === "1";
    if (search.get("url")) void scan(search.get("url") ?? "");
    else inputRef.current?.focus();
  }, [scan]);

  const ready = phase.kind === "ready" ? phase : null;
  const startAi = useCallback((nextSeed?: string) => {
    if (!ready) return;
    const s = nextSeed ?? seed ?? newSeed();
    setSeed(s);
    const cols = labSettings(valuesRef.current).cols ?? Math.floor(window.innerWidth / (window.innerWidth < 640 ? 6 : 7.8));
    setPlay(generateSet(ready.snapshot, s, { cols }));
    writeQuery(ready.url, valuesRef.current, { seed: s, on: true });
  }, [ready, seed]);

  // The AI set asked for by a link starts once the page is read (it waits for the click that turns on the sound).
  useEffect(() => {
    if (ready && aiOnLoad.current) {
      aiOnLoad.current = false;
      startAi();
    }
  }, [ready, startAi]);

  const change = useCallback((key: string, value: string) => {
    const next = { ...valuesRef.current, [key]: value };
    valuesRef.current = next;
    setValues(next);
    writeQuery(phase.kind === "ready" || phase.kind === "scanning" || phase.kind === "error" ? phase.url : null, next, seed ? { seed, on: !!play } : null);
  }, [phase, seed, play]);

  const settings = useMemo(() => labSettings(values), [values]);

  useEffect(() => {
    if (phase.kind !== "scanning") return;
    const timer = window.setInterval(() => setTick((t) => t + 1), 120);
    return () => window.clearInterval(timer);
  }, [phase.kind]);

  const leave = useCallback(() => {
    setPhase({ kind: "idle" });
    setPlay(null);
    setDrawer(false);
    writeQuery(null, valuesRef.current, null);
    window.setTimeout(() => inputRef.current?.select(), 50);
  }, []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void scan(input);
  };

  if (phase.kind === "ready") {
    const source = phase.snapshot.source;
    // Reading settings changed since this scan: they need a new one.
    const dirty = new Set(writeValues(values, "scan").join("&") === phase.scanned ? [] : PARAMS.filter((p) => SCAN_KEYS.has(p.key)).map((p) => p.key));
    const linkQuery = new URLSearchParams([["url", phase.url], ...writeValues(values)]).toString();
    const panel = (
      <div className={`sonic-lab__panel lab-drawer${drawer ? " is-open" : ""}`}>
        <div className="lab-drawer__bar">
          <button type="button" className={drawer ? "is-on" : "is-key"} onClick={() => setDrawer((open) => !open)}>[PARAMS {drawer ? "×" : "⚙"}]</button>
          <button type="button" className={play ? "is-on" : "is-key"} onClick={() => {
            if (!play) return startAi();
            setPlay(null);
            writeQuery(phase.url, valuesRef.current, seed ? { seed, on: false } : null);
          }} title="A seeded random set: the same seed plays the same set on this page">
            [{play ? "■ AI DJ" : "▶ AI DJ"}]
          </button>
          {seed && <button type="button" className="is-key" onClick={() => startAi(newSeed())} title="Play a new random set">[SEED {seed} ↻]</button>}
        </div>
        {drawer && (
          <div className="lab-drawer__body">
            <ParamControls layers={["scan", "map", "sound", "perform"]} values={values} onChange={change} dirty={dirty} />
            {dirty.size > 0 && <button type="button" className="lab-drawer__rescan" onClick={() => void scan(phase.url)}>[RESCAN WITH NEW READ SETTINGS ↻]</button>}
          </div>
        )}
      </div>
    );
    return (
      <>
        <SonicLab open snapshot={phase.snapshot} onClose={leave} linkQuery={linkQuery} autoEnter={false} enterLabels={ENTER} settings={settings} play={play} panel={panel} />
        <div className="lab-source" aria-live="polite">
          READING {hostOf(source?.url ?? phase.url)}
          {source?.title ? <span> · {source.title}</span> : null}
        </div>
      </>
    );
  }

  const scanning = phase.kind === "scanning";
  const seconds = scanning ? Math.floor((Date.now() - phase.since) / 1000) : 0;
  const bar = Array.from({ length: 32 }, (_, i) => ((i + tick) % 8 === 0 ? "█" : (i + tick) % 8 < 3 ? "▒" : "░")).join("");

  return (
    <main className="home">
      <pre className="home__title" aria-label="alexsonicLAb">{TITLE}</pre>
      <p className="home__lede">Type a web address. A server reads the page in a headless browser and sends back only its shape: boxes, lines of text, section edges, the brightness of images. Scroll it under the read head and it plays as techno.</p>

      <form className="home__form" onSubmit={submit}>
        <span className="home__prompt">READ&gt;</span>
        <input
          ref={inputRef}
          className="home__input"
          type="text"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder="https://en.wikipedia.org/wiki/Techno"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          aria-label="Web address to read"
          disabled={scanning}
        />
        <button className="home__go" type="submit" disabled={scanning || !input.trim()}>[SCAN ↵]</button>
      </form>

      <div className="home__setup">
        <button type="button" className={setup ? "is-on" : "is-key"} onClick={() => setSetup((open) => !open)}>
          [SETUP {setup ? "−" : "+"}]
        </button>
        {!setup && writeValues(values, "scan").length > 0 && <span className="is-dim"> {writeValues(values, "scan").map(([k, v]) => `${k}=${v}`).join(" ")}</span>}
        {setup && <ParamControls layers={["scan"]} values={values} onChange={change} />}
      </div>

      {scanning && (
        <div className="home__status" role="status">
          <span className="is-bright">SCANNING</span> {hostOf(phase.url)} <span className="is-meter">{bar}</span> {seconds}s
          <div className="is-dim">rendering at 1280 px · scrolling once for lazy content · measuring every line</div>
        </div>
      )}
      {phase.kind === "error" && (
        <div className="home__status is-error" role="alert">
          <span className="is-bright">✕ {phase.code.toUpperCase().replace(/_/g, " ")}</span> {hostOf(phase.url)}
          <div>{phase.message}</div>
        </div>
      )}

      <div className="home__examples">
        <div className="is-dim">TRY</div>
        {EXAMPLES.map((example) => (
          <button key={example.url} type="button" className="home__example" onClick={() => void scan(example.url)} disabled={scanning}>
            [{example.label}]
          </button>
        ))}
      </div>

      <footer className="home__foot is-dim">
        Only public pages: no logins, no private networks. Scans are cached for an hour. The instrument is the same alexsonicLAb that opens Alex&apos;s portfolio.
      </footer>
    </main>
  );
}

function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

const TITLE = String.raw`
       _                          _      _        _
  __ _| | _____  _____  ___  _ __ (_) ___| |   __ _| |__
 / _' | |/ _ \ \/ / __|/ _ \| '_ \| |/ __| |  / _' | '_ \
| (_| | |  __/>  <\__ \ (_) | | | | | (__| |_| (_| | |_) |
 \__,_|_|\___/_/\_\___/\___/|_| |_|_|\___|_____\__,_|_.__/
`;
