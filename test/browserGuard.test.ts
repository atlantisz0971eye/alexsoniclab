import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, test } from "node:test";
import { getBrowser } from "../server/browser.ts";
import { startGuardProxy } from "../server/guardProxy.ts";
import { guardContext } from "../server/scan.ts";

/**
 * A page loaded in the scanner's browser tries every way it has to reach this machine: images, an iframe, fetch,
 * a WebSocket, a beacon, a form post and a top-level navigation, to loopback by IP, by name and by a public DNS name
 * that answers 127.0.0.1. A listener counts what arrives. Nothing may arrive.
 */

const hits: string[] = [];
const listen = (port: number, host: string) =>
  new Promise<http.Server | null>((resolve) => {
    const server = http.createServer((request, response) => {
      hits.push(`${host}:${port}${request.url}`);
      response.end("secret");
    });
    server.on("upgrade", (request, socket) => {
      hits.push(`${host}:${port}${request.url} (upgrade)`);
      socket.destroy();
    });
    server.once("error", () => resolve(null));
    server.listen(port, host, () => resolve(server));
  });

const servers: http.Server[] = [];
after(async () => {
  for (const server of servers) server.close();
  await (await getBrowser()).close();
});

test("a page in the scanner cannot reach loopback, by any route", async () => {
  const random = await listen(0, "127.0.0.1");
  assert.ok(random);
  servers.push(random);
  const port = (random.address() as AddressInfo).port;
  // 8080 is an allowed port, so a request there gets past the port rule and must be stopped by the address rule.
  const allowed = await listen(8080, "127.0.0.1");
  if (allowed) servers.push(allowed);
  const ports = allowed ? [port, 8080] : [port];

  const proxy = await startGuardProxy({ maxConnections: 100, maxBytes: 10_000_000 });
  const browser = await getBrowser();
  const context = await browser.newContext({ proxy: { server: proxy.server, bypass: "<-loopback>" } });
  await guardContext(context);
  const page = await context.newPage();
  const targets = ports.flatMap((p) => [`127.0.0.1:${p}`, `localhost:${p}`, `localtest.me:${p}`, `[::1]:${p}`, `127.0.0.1.nip.io:${p}`]);
  const html = targets
    .map((t, i) => `
      <img src="http://${t}/img${i}">
      <iframe src="http://${t}/frame${i}"></iframe>
      <link rel="stylesheet" href="http://${t}/css${i}">
      <script>
        fetch("http://${t}/fetch${i}").catch(() => {});
        fetch("http://${t}/post${i}", { method: "POST", body: "x", mode: "no-cors" }).catch(() => {});
        try { new WebSocket("ws://${t}/ws${i}"); } catch {}
        try { navigator.sendBeacon("http://${t}/beacon${i}", "x"); } catch {}
      </script>`)
    .join("\n");
  await page.setContent(`<!doctype html><body>${html}</body>`, { waitUntil: "load", timeout: 15_000 }).catch(() => {});
  for (const t of [`127.0.0.1:${ports.at(-1)}`, `localtest.me:${ports.at(-1)}`]) {
    await page.goto(`http://${t}/navigate`, { timeout: 8_000 }).catch(() => {});
  }
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  await context.close();
  await proxy.close();

  assert.deepEqual(hits, [], `requests reached this machine: ${hits.join(", ")}`);
  if (allowed) assert.ok(proxy.stats.blocked > 0, "the guard proxy should have refused the requests on port 8080");
  console.log(`listener hits: 0; guard proxy refused ${proxy.stats.blocked} connection(s) to ${proxy.stats.blockedHosts.join(", ")}`);
});
