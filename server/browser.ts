import { chromium, type Browser } from "playwright-core";

/**
 * One headless Chromium per warm server instance, reused across scans (each scan gets its own fresh context).
 * On Vercel it is @sparticuz/chromium, unpacked into /tmp on a cold start; locally it is the installed Chrome, or
 * the browser at CHROME_PATH.
 *
 * The browser is also told to send everything to a proxy that does not exist. Every request a page makes is
 * intercepted and either answered by the scanner (through the SSRF guard) or refused, so nothing should ever reach
 * that proxy; if something slips past interception (a new kind of request), it fails instead of going out.
 */

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
  const onServerless = !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME;
  if (onServerless) {
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

/** At most this many pages render at once on one instance; the rest wait their turn, briefly. */
const MAX_CONCURRENT = 2;
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
