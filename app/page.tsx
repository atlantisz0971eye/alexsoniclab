"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { SonicLab } from "./components/SonicLab";
import type { ScanSnapshot } from "./lib/scanPage";

/**
 * The standalone alexsonicLAb: type a web address, a server reads that page in a headless browser and sends back
 * only its geometry, and the same Lab as on Alex's portfolio plays it.
 */

type Phase =
  | { kind: "idle" }
  | { kind: "scanning"; url: string; since: number }
  | { kind: "error"; url: string; code: string; message: string }
  | { kind: "ready"; url: string; snapshot: ScanSnapshot };

const EXAMPLES = [
  { label: "WIKIPEDIA · TECHNO", url: "https://en.wikipedia.org/wiki/Techno" },
  { label: "NEWS · NPR TEXT", url: "https://text.npr.org/" },
  { label: "NEWS · BBC", url: "https://www.bbc.com/news" },
  { label: "PORTFOLIO · BRITTANY CHIANG", url: "https://brittanychiang.com/" },
  { label: "HACKER NEWS", url: "https://news.ycombinator.com/" },
];

const ENTER = { loud: "[NEW URL ↵]", silent: "[NEW URL ↵]", short: "[URL ↵]", title: "Leave the Lab and read another site" };
const withScheme = (input: string) => (/^[a-z][a-z0-9+.-]*:/i.test(input.trim()) ? input.trim() : `https://${input.trim()}`);

export default function Home() {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [input, setInput] = useState("");
  const [tick, setTick] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const request = useRef<AbortController | null>(null);

  const scan = useCallback(async (raw: string) => {
    const url = withScheme(raw);
    if (!raw.trim()) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setInput(url);
    setPhase({ kind: "scanning", url, since: Date.now() });
    // The address goes into the page's own URL, so a reload or a shared link reads it again.
    const params = new URLSearchParams(window.location.search);
    params.set("url", url);
    window.history.replaceState(null, "", `${window.location.pathname}?${params}${window.location.hash}`);
    try {
      const response = await fetch(`/api/scan?url=${encodeURIComponent(url)}`, { signal: controller.signal });
      const body = await response.json().catch(() => ({ ok: false, code: "internal", message: "The scanner answered with something unreadable." }));
      if (controller.signal.aborted) return;
      if (body.ok) setPhase({ kind: "ready", url, snapshot: body.snapshot });
      else setPhase({ kind: "error", url, code: body.code, message: body.message });
    } catch {
      if (!controller.signal.aborted) setPhase({ kind: "error", url, code: "network", message: "The scanner could not be reached." });
    }
  }, []);

  // A link with ?url= reads that page straight away.
  useEffect(() => {
    const url = new URLSearchParams(window.location.search).get("url");
    if (url) void scan(url);
    else inputRef.current?.focus();
  }, [scan]);

  useEffect(() => {
    if (phase.kind !== "scanning") return;
    const timer = window.setInterval(() => setTick((t) => t + 1), 120);
    return () => window.clearInterval(timer);
  }, [phase.kind]);

  const leave = useCallback(() => {
    setPhase({ kind: "idle" });
    window.history.replaceState(null, "", window.location.pathname);
    window.setTimeout(() => inputRef.current?.select(), 50);
  }, []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void scan(input);
  };

  if (phase.kind === "ready") {
    const source = phase.snapshot.source;
    return (
      <>
        <SonicLab open snapshot={phase.snapshot} onClose={leave} linkQuery={`url=${encodeURIComponent(phase.url)}`} autoEnter={false} enterLabels={ENTER} />
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
