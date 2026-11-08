import type { BrowserContext, Page } from "playwright-core";
import { GENERIC_PAGE, snapshotPage, type ScanBox, type ScanSnapshot } from "../app/lib/scanPage.ts";
import { getBrowser, resetBrowser, withSlot } from "./browser.ts";
import { ScanError } from "./errors.ts";
import { REFUSED_HEADER, startGuardProxy, type ProxyStats } from "./guardProxy.ts";
import { checkUrl } from "./urlGuard.ts";
import type { ScanOptions } from "../app/lib/params.ts";

/**
 * Reads another site the way the portfolio Lab reads the portfolio: renders it in headless Chromium at a fixed
 * viewport, runs the Lab's own snapshotPage inside it, and keeps only derived geometry: box kinds and positions,
 * a short run of letters per line, section edges and the brightness of media. The page's HTML never leaves here.
 */

export const DEFAULT_OPTIONS: ScanOptions = { width: 1280, height: 800, dark: false, clean: false, wait: "normal", maxHeight: 30_000, lang: "en" };

/** How long a page gets: to load, to go quiet on the network, and to be scrolled through for lazy content. */
const WAIT = {
  fast: { load: 3_000, idle: 1_000, scroll: 2_000, total: 30_000 },
  normal: { load: 6_000, idle: 2_500, scroll: 4_000, total: 40_000 },
  patient: { load: 14_000, idle: 5_000, scroll: 8_000, total: 55_000 },
};

/** Cookie and consent banners from the common consent tools, hidden when the visitor asks for a clean read. */
const CLEAN_CSS = `
  #onetrust-banner-sdk, #onetrust-consent-sdk, #CybotCookiebotDialog, .fc-consent-root, .qc-cmp2-container,
  [id^="sp_message_container"], #usercentrics-root, #didomi-host, .cc-window, #cookie-banner, .cookie-banner,
  [id*="cookie-consent" i], [class*="cookie-consent" i], [id*="cookieconsent" i], [class*="cookieconsent" i],
  [role="dialog"][aria-label*="cookie" i], [role="dialog"][aria-label*="consent" i],
  [role="region"][aria-label*="cookie" i], [aria-labelledby*="cookie" i], [aria-labelledby*="consent" i],
  [class*="consentbanner" i], [class*="consent-banner" i], [id*="consent-banner" i], [class*="cookiebanner" i], [id*="cookiebanner" i]
  { display: none !important; }
`;
export const BUDGET = {
  navigationMs: 20_000,
  connections: 300,
  bytes: 25 * 1024 * 1024,
  boxes: 12_000,
  /** Media brightness is read from a screenshot of at most this much of the page. */
  lumaHeight: process.env.VERCEL ? 3_000 : 16_000,
};

export const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36 alexsonicLAb/0.1";

export type ScanStats = { ms: number; connections: number; bytes: number; blocked: number; boxes: number; height: number };

const BOT_TEXT = [
  "just a moment", "attention required", "verify you are human", "verifying you are human", "are you a robot", "are you human",
  "unusual traffic", "access denied", "request blocked", "please enable js and disable any ad blocker", "checking your browser",
  "press & hold", "captcha", "pardon our interruption", "bot detection", "security check",
];
const LOGIN_PATH = /\/(log-?in|sign-?in|signin|auth|sso|session|account\/login|accounts\/login|users\/sign_in|uas\/login)(\.\w+)?(\/|\?|$)/i;

export async function scanUrl(url: URL, options: ScanOptions = DEFAULT_OPTIONS): Promise<{ snapshot: ScanSnapshot; stats: ScanStats }> {
  // Refuse before starting a browser: bad shape, private names, private DNS answers.
  await checkUrl(url);
  return withSlot(12_000, () => withDeadline(url, options), () => new ScanError("busy"));
}

/**
 * The scan's own deadline, a little after its budget and well before the function's: a browser that stops
 * answering (a page that freezes the renderer) is thrown away, and the visitor hears "timeout" instead of nothing.
 */
async function withDeadline(url: URL, options: ScanOptions) {
  const limit = WAIT[options.wait].total + 2_000;
  const marks: string[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ScanError("timeout", `no answer after ${limit}ms`)), limit);
  });
  try {
    return await Promise.race([render(url, options, marks), expired]);
  } catch (error) {
    if (error instanceof ScanError && error.code === "timeout") {
      console.warn(`scan stuck ${url.host} after ${marks.join(" ") || "nothing"}`);
      await resetBrowser();
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function render(url: URL, options: ScanOptions, marks: string[] = []) {
  const wait = WAIT[options.wait];
  const started = Date.now();
  // Where the time goes, in the logs: each phase's end, in ms since the start.
  const mark = (name: string) => marks.push(`${name}=${Date.now() - started}`);
  const proxy = await startGuardProxy({ maxConnections: BUDGET.connections, maxBytes: BUDGET.bytes });
  let context: BrowserContext | null = null;
  const deadline = setTimeout(() => void context?.close().catch(() => {}), wait.total);
  try {
    mark("proxy");
    // A browser that cannot open a context within seconds is sick: replace it once and try again.
    let browser = await getBrowser();
    mark("launch");
    const contextOptions = {
      viewport: { width: options.width, height: options.height },
      colorScheme: options.dark ? "dark" : "light",
      isMobile: options.width < 600,
      hasTouch: options.width < 600,
      deviceScaleFactor: 1,
      userAgent: USER_AGENT,
      locale: options.lang,
      extraHTTPHeaders: { "accept-language": `${options.lang},en;q=0.5` },
      reducedMotion: "reduce",
      serviceWorkers: "block",
      acceptDownloads: false,
      // Loopback is not exempt from the proxy: everything goes through the guard.
      proxy: { server: proxy.server, bypass: "<-loopback>" },
    } satisfies Parameters<typeof browser.newContext>[0];
    context = await within(browser.newContext(contextOptions), 8_000);
    if (!context) {
      mark("sick");
      await resetBrowser();
      browser = await getBrowser();
      context = await within(browser.newContext(contextOptions), 8_000);
      if (!context) throw new ScanError("busy", "no browser context");
    }
    mark("context");
    await guardContext(context);
    const page = await context.newPage();
    page.on("dialog", (dialog) => void dialog.dismiss().catch(() => {}));
    // Popups and new windows are closed at once.
    page.on("popup", (popup) => void popup.close().catch(() => {}));

    // The status of the page itself, even when Chromium turns it into an error (a 401 challenge, an empty 403).
    let documentStatus = 0;
    page.on("response", (reply) => {
      if (!reply.request().isNavigationRequest() || reply.frame() !== page.mainFrame()) return;
      // A redirect into the private network is answered by the guard proxy, marked.
      documentStatus = reply.headers()[REFUSED_HEADER] ? -1 : reply.status();
    });
    mark("browser");
    const response = await page.goto(url.href, { waitUntil: "domcontentloaded", timeout: BUDGET.navigationMs }).catch((error: Error) => {
      throw navigationError(error, proxy.stats, documentStatus);
    });
    if (!response) throw new ScanError("unreachable");
    if (documentStatus === -1) throw new ScanError("private_address", response.url());
    const status = response.status();
    if (status === 401 || status === 407) throw new ScanError("login");
    const type = (response.headers()["content-type"] ?? "").toLowerCase();
    if (type && !/html|xml/.test(type)) throw new ScanError(status >= 400 ? (status === 403 || status === 429 ? "blocked" : "http_error") : "not_html", type);

    mark("goto");
    await settle(page, wait, options.maxHeight);
    mark("settle");
    if (options.clean) await cleanBanners(page);
    const look = await page.evaluate(() => ({
      url: location.href,
      title: document.title,
      text: (document.body?.innerText ?? "").slice(0, 4000).toLowerCase(),
      words: (document.body?.innerText ?? "").split(/\s+/).length,
      password: !!document.querySelector("input[type=password]"),
      challenge: !!document.querySelector("iframe[src*='captcha'], iframe[src*='challenges.cloudflare.com'], iframe[src*='hcaptcha'], #challenge-form, #cf-challenge-running, .g-recaptcha, [data-sitekey], #px-captcha"),
    }));
    classify(status, response.headers(), look);

    mark("look");
    const raw = (await page.evaluate(`(${snapshotPage.toString()})(document.body, ${JSON.stringify({ ...GENERIC_PAGE, maxHeight: options.maxHeight })})`)) as ScanSnapshot;
    // Off-screen helpers (skip links, hidden menus parked at -9999px) are not part of the page anyone sees.
    const boxes = raw.boxes
      .filter((box) => box.bottom > 0 && box.right > 0 && box.left < raw.width && box.top < raw.height)
      .slice(0, options.maxHeight > 30_000 ? BUDGET.boxes * 2 : BUDGET.boxes)
      .map(clean);
    if (boxes.filter((box) => box.kind === "text" || box.kind === "heading").length < 3) throw new ScanError("empty");
    mark("snapshot");
    // Image brightness needs a tall screenshot, which is slow without a GPU: only with time to spare, and capped.
    if (Date.now() - started < wait.total * (process.env.VERCEL ? 0.3 : 0.45)) await readMediaBrightness(context, page, boxes, raw.height, options.width).catch(() => {});
    mark("luma");

    const snapshot: ScanSnapshot = {
      boxes,
      height: Math.round(raw.height),
      width: raw.width,
      sections: raw.sections.map((s) => ({ id: s.id, top: Math.round(s.top), bottom: Math.round(s.bottom) })),
      source: { url: look.url, title: look.title.replace(/\s+/g, " ").trim().slice(0, 120), readAt: new Date().toISOString() },
    };
    const stats: ScanStats = { ms: Date.now() - started, connections: proxy.stats.connections, bytes: proxy.stats.bytes, blocked: proxy.stats.blocked, boxes: boxes.length, height: snapshot.height };
    return { snapshot, stats };
  } catch (error) {
    if (error instanceof ScanError) throw error;
    const message = String(error);
    if (/crash|ERR_INSUFFICIENT_RESOURCES/i.test(message)) void resetBrowser();
    if (/closed|Target page, context or browser has been closed/i.test(message) && Date.now() - started >= wait.total - 500) throw new ScanError("timeout");
    throw new ScanError("internal", message.slice(0, 300));
  } finally {
    console.info(`scan phases ${url.host} ${marks.join(" ")}`);
    clearTimeout(deadline);
    await within(context?.close().catch(() => {}) ?? Promise.resolve(), 5_000);
    await proxy.close();
  }
}

/** Second line of defence inside the browser, and the budget for kinds of requests a scan does not need. */
export async function guardContext(context: BrowserContext) {
  await context.route("**/*", async (route) => {
    const request = route.request();
    const target = request.url();
    if (!/^https?:/i.test(target)) return route.continue();
    const type = request.resourceType();
    // Sound, video, beacons and the like add nothing to the layout.
    if (["media", "websocket", "eventsource", "manifest", "texttrack", "ping", "beacon", "csp_report"].includes(type)) return route.abort("blockedbyclient");
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method()) && type !== "fetch" && type !== "xhr") return route.abort("blockedbyclient");
    return route.continue();
  });
  // WebSockets are not needed for a layout; close them before they open.
  await context.routeWebSocket(/.*/, (socket) => socket.close());
}

/** Hide consent banners; if that hides much of the page too (a banner wrapping everything), put it back. */
async function cleanBanners(page: Page) {
  const before = await page.evaluate(() => document.documentElement.scrollHeight).catch(() => 0);
  const tag = await page.addStyleTag({ content: CLEAN_CSS }).catch(() => null);
  if (!tag) return;
  const after = await page.evaluate(() => document.documentElement.scrollHeight).catch(() => 0);
  if (before && after < before * 0.6) await tag.evaluate((element) => (element as Element).remove()).catch(() => {});
}

/** Let the page finish: load, lazy content by scrolling through once, fonts, then back to the top. */
async function settle(page: Page, wait: (typeof WAIT)["normal"], maxHeight: number) {
  await page.waitForLoadState("load", { timeout: wait.load }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: wait.idle }).catch(() => {});
  await page
    .evaluate(`(async () => {
      const limit = ${maxHeight};
      const start = Date.now();
      for (let y = 0; y < Math.min(document.documentElement.scrollHeight, limit) && Date.now() - start < ${wait.scroll}; y += innerHeight) {
        scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 90));
      }
      scrollTo(0, 0);
      await new Promise((r) => setTimeout(r, 400));
      if (document.fonts) await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]);
    })()`)
    .catch(() => {});
}

function classify(status: number, headers: Record<string, string>, look: { url: string; title: string; text: string; words: number; password: boolean; challenge: boolean }) {
  const title = look.title.toLowerCase();
  const botHeader = headers["cf-mitigated"] === "challenge" || "x-datadome" in headers || "x-px-block" in headers;
  const botText = BOT_TEXT.some((phrase) => title.includes(phrase) || (look.words < 400 && look.text.includes(phrase)));
  if (botHeader || look.challenge || (botText && (status >= 400 || look.words < 400))) throw new ScanError("blocked");
  if (status === 401 || status === 407) throw new ScanError("login");
  // Sent to a login form (or a wall in front of one), or the page is little more than one.
  const path = new URL(look.url).pathname + new URL(look.url).search;
  if (LOGIN_PATH.test(path) || /authwall|loginwall|signup/i.test(path) || (look.password && look.words < 500)) throw new ScanError("login");
  if (status === 403 || status === 429 || status === 999) throw new ScanError("blocked");
  if (status >= 400) throw new ScanError("http_error", String(status));
}

/** The promise's value, or null if it takes longer than ms. */
async function within<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([promise, late]);
  } finally {
    clearTimeout(timer);
  }
}

function navigationError(error: Error, stats: ProxyStats, status: number) {
  const message = error.message ?? "";
  // The browser ran out of memory or handles: start the next scan with a fresh one.
  if (/ERR_INSUFFICIENT_RESOURCES|Target crashed|Page crashed/i.test(message)) void resetBrowser();
  if (status === -1) return new ScanError("private_address", stats.blockedHosts.join(","));
  if (/Timeout/i.test(message)) return new ScanError("timeout");
  if (/ERR_INVALID_AUTH_CREDENTIALS/i.test(message) || status === 401 || status === 407) return new ScanError("login");
  if (status === 403 || status === 429) return new ScanError("blocked");
  if (status >= 400) return new ScanError("http_error", String(status));
  if (/Download is starting/i.test(message)) return new ScanError("not_html");
  if (/ERR_TUNNEL_CONNECTION_FAILED|ERR_PROXY|ERR_BLOCKED/i.test(message) && stats.blocked > 0) return new ScanError("private_address", stats.blockedHosts.join(","));
  if (/ERR_TOO_MANY_REDIRECTS/i.test(message)) return new ScanError("too_many_redirects");
  if (/ERR_NAME_NOT_RESOLVED|ERR_TUNNEL_CONNECTION_FAILED/i.test(message)) return new ScanError("unresolvable");
  if (/ERR_CONNECTION|ERR_EMPTY_RESPONSE|ERR_SSL|ERR_CERT|ERR_ADDRESS/i.test(message)) return new ScanError("unreachable", message.split("\n")[0]);
  return new ScanError("unreachable", message.split("\n")[0]);
}

/** Whole pixels and printable letters only. */
function clean(box: ScanBox): ScanBox {
  return {
    kind: box.kind,
    top: Math.round(box.top),
    bottom: Math.round(box.bottom),
    left: Math.round(box.left),
    right: Math.round(box.right),
    text: box.text.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\ufeff]/g, ""),
    section: box.section,
    luma: Math.round(box.luma * 100) / 100,
  };
}

/**
 * How bright each image really is: one screenshot of the whole page at 1/16 scale (each pixel is a 16 × 16 block),
 * decoded in a blank page, averaged over each media box. Cross-origin images cannot be read inside the page itself.
 */
async function readMediaBrightness(context: BrowserContext, page: Page, boxes: ScanBox[], height: number, width: number) {
  const media = boxes.filter((box) => box.kind === "media" && box.top < BUDGET.lumaHeight);
  if (!media.length) return;
  const scale = 1 / 16;
  const cdp = await context.newCDPSession(page);
  const shot = (await cdp.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width, height: Math.min(height, BUDGET.lumaHeight), scale },
  })) as { data: string };
  await cdp.detach().catch(() => {});
  const blank = await context.newPage();
  const lumas = (await blank.evaluate(
    async ({ png, rects, scale }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${png}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return [];
      ctx.drawImage(image, 0, 0);
      const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      return rects.map(([top, bottom, left, right]) => {
        const x0 = Math.max(0, Math.floor(left * scale));
        const x1 = Math.min(width - 1, Math.ceil(right * scale) - 1);
        const y0 = Math.max(0, Math.floor(top * scale));
        const y1 = Math.min(height - 1, Math.ceil(bottom * scale) - 1);
        let sum = 0;
        let n = 0;
        for (let y = y0; y <= y1; y += 1) {
          for (let x = x0; x <= x1; x += 1) {
            const i = (y * width + x) * 4;
            sum += (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
            n += 1;
          }
        }
        return n ? sum / n : 0.5;
      });
    },
    { png: shot.data, rects: media.map((box) => [box.top, box.bottom, box.left, box.right]), scale },
  )) as number[];
  await blank.close().catch(() => {});
  media.forEach((box, i) => {
    if (typeof lumas[i] === "number") box.luma = Math.round(lumas[i] * 100) / 100;
  });
}
