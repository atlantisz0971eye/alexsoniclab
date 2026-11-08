import { readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright-core";

export type { Browser };

/**
 * One headless Chromium per warm server instance, reused across scans (each scan gets its own fresh context).
 * On Vercel it is @sparticuz/chromium, unpacked into /tmp on a cold start; locally it is the installed Chrome, or
 * the browser at CHROME_PATH.
 *
 * The browser's default proxy is one that does not exist: each scan's context sets its own guard proxy, so any
 * traffic outside a context fails instead of going out.
 *
 * A Vercel function has one CPU and 2 GB, and its Chromium runs in single-process mode, where a second session in
 * the same browser often hangs while opening its page. So on Vercel every scan launches its own browser and kills it
 * afterwards (processes and profile included), and only one page renders at a time. Locally one browser is reused.
 */

export const ON_SERVERLESS = !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME;

const HARDENING = [
  "--proxy-server=http://127.0.0.1:9",
  "--proxy-bypass-list=<-loopback>",
  "--dns-prefetch-disable",
  "--disable-background-networking",
  "--disable-component-update",
  "--disable-domain-reliability",
  "--disable-sync",
  "--no-pings",
  "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
  "--webrtc-ip-handling-policy=disable_non_proxied_udp",
  "--disable-features=Prerender2,NoStatePrefetch,PreloadMediaEngagementData,AutofillServerCommunication,MediaRouter,DialMediaRouteProvider",
  "--mute-audio",
];

let launching: Promise<Browser> | null = null;

async function launch(): Promise<Browser> {
  if (ON_SERVERLESS) {
    const { default: serverless } = await import("@sparticuz/chromium");
    return chromium.launch({ executablePath: await serverless.executablePath(), args: [...serverless.args, ...HARDENING], headless: true });
  }
  const executablePath = process.env.CHROME_PATH;
  return chromium.launch({ ...(executablePath ? { executablePath } : { channel: "chrome" }), args: HARDENING, headless: true });
}

/** Throw the browser away (it is stuck); the next scan starts a fresh one. */
export async function resetBrowser() {
  const current = launching;
  launching = null;
  const browser = await current?.catch(() => null);
  await Promise.race([browser?.close().catch(() => {}), new Promise((resolve) => setTimeout(resolve, 3000))]);
  if (ON_SERVERLESS) killStrayChromium();
}

/**
 * On Linux (Vercel), kill every Chromium process still alive and delete the temporary profiles, so a browser that
 * would not close cannot keep the instance's memory and disk. Not used locally, where it would hit the user's Chrome.
 */
function killStrayChromium(report = true) {
  if (process.platform !== "linux") return;
  let killed = 0;
  for (const entry of readdirSync("/proc")) {
    const pid = Number(entry);
    if (!pid || pid === process.pid) continue;
    try {
      const command = readFileSync(`/proc/${pid}/cmdline`, "utf8");
      if (/chrom(e|ium)/i.test(command)) {
        process.kill(pid, "SIGKILL");
        killed += 1;
      }
    } catch {
      // The process ended meanwhile, or is not ours.
    }
  }
  for (const entry of readdirSync(tmpdir())) {
    if (entry.startsWith("playwright_chromiumdev_profile-")) rmSync(join(tmpdir(), entry), { recursive: true, force: true });
  }
  if (report || killed) console.warn(`browser reset: killed ${killed} chromium process(es)`);
}

/** On Vercel a fresh browser for one scan, to be passed to releaseBrowser; locally the shared one. */
export async function acquireBrowser(): Promise<Browser> {
  return ON_SERVERLESS ? launch() : getBrowser();
}

export async function releaseBrowser(browser: Browser | null) {
  if (!ON_SERVERLESS || !browser) return;
  await Promise.race([browser.close().catch(() => {}), new Promise((resolve) => setTimeout(resolve, 4000))]);
  killStrayChromium(false);
}

export async function getBrowser(): Promise<Browser> {
  if (launching) {
    const browser = await launching.catch(() => null);
    if (browser?.isConnected()) return browser;
  }
  launching = launch();
  const browser = await launching;
  browser.on("disconnected", () => {
    launching = null;
  });
  return browser;
}

/** At most this many pages render at once on one instance (one on Vercel's single CPU); the rest wait, briefly. */
const MAX_CONCURRENT = ON_SERVERLESS ? 1 : 2;
let running = 0;
const waiting: (() => void)[] = [];

export async function withSlot<T>(waitMs: number, work: () => Promise<T>, onBusy: () => Error): Promise<T> {
  if (running >= MAX_CONCURRENT) {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        waiting.splice(waiting.indexOf(release), 1);
        reject(onBusy());
      }, waitMs);
      const release = () => {
        clearTimeout(timer);
        resolve();
      };
      waiting.push(release);
    });
  }
  running += 1;
  try {
    return await work();
  } finally {
    running -= 1;
    waiting.shift()?.();
  }
}
