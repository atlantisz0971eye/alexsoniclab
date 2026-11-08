// Runs the scan API through the cases it must refuse, against a running server.
// Usage: npm run check:security -- [base URL]   (default http://localhost:3217)
// Each case uses its own client address (x-real-ip), so the rate limit does not interfere; the last case tests it.

const base = process.argv[2] ?? "http://localhost:3217";
let ip = 1;

async function scan(url, address = `198.51.100.${ip++}`, follow = true) {
  let response = await fetch(`${base}/api/scan?url=${encodeURIComponent(url)}`, { headers: { "x-real-ip": address }, redirect: "manual" });
  if (response.status === 308) {
    const location = response.headers.get("location");
    if (!follow) return { status: 308, code: "canonical", location };
    // Other spellings of an address (2130706433, 0x7f.0.0.1) are first sent to the canonical one, then judged.
    response = await fetch(new URL(location, base), { headers: { "x-real-ip": address }, redirect: "manual" });
  }
  const body = await response.json();
  return { status: response.status, code: body.ok ? "ok" : body.code };
}

const CASES = [
  // scheme, credentials, ports
  ["file:///etc/passwd", "bad_scheme"],
  ["ftp://example.com/", "bad_scheme"],
  ["javascript:alert(1)", "bad_scheme"],
  ["http://user:pass@example.com/", "bad_url"],
  ["http://example.com:22/", "bad_port"],
  // loopback, private networks, link-local and cloud metadata, by literal address
  ["http://127.0.0.1/", "private_address"],
  ["http://localhost/", "private_address"],
  ["http://[::1]/", "private_address"],
  ["http://[::ffff:127.0.0.1]/", "private_address"],
  ["http://2130706433/", "private_address"],
  ["http://0x7f.0.0.1/", "private_address"],
  ["http://10.0.0.1/", "private_address"],
  ["http://172.16.0.1/", "private_address"],
  ["http://192.168.1.1/", "private_address"],
  ["http://100.64.0.1/", "private_address"],
  ["http://169.254.169.254/latest/meta-data/", "private_address"],
  ["http://[fd00:ec2::254]/latest/meta-data/", "private_address"],
  ["http://metadata.google.internal/computeMetadata/v1/", "private_address"],
  // public names whose DNS answer is private
  ["http://localtest.me/", "private_address"],
  ["http://169.254.169.254.nip.io/", "private_address"],
  ["http://192.168.0.1.nip.io/", "private_address"],
  // a public page that redirects into the private network
  ["https://postman-echo.com/redirect-to?url=http://127.0.0.1/", "private_address"],
  ["https://postman-echo.com/redirect-to?url=http://169.254.169.254/latest/meta-data/", "private_address"],
  ["https://postman-echo.com/redirect-to?url=https://localtest.me/", "private_address"],
  // pages the scanner cannot or should not read
  ["https://httpbingo.org/status/401", "login"],
  ["https://httpbingo.org/status/403", "blocked"],
  ["https://github.com/login", "login"],
  ["https://httpbingo.org/image/png", "not_html"],
  ["http://google.com:8080/", "timeout"], // the port accepts nothing: the connection hangs until the deadline
  ["https://does-not-exist.invalid/", "unresolvable"],
];

let failed = 0;
const results = await Promise.all(CASES.map(async ([url, expected]) => [url, expected, await scan(url).catch((error) => ({ code: `fetch failed: ${error}` }))]));
for (const [url, expected, result] of results) {
  const ok = result.code === expected;
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${expected.padEnd(16)} ${String(result.status ?? "").padEnd(4)} ${url}${ok ? "" : `  -> ${result.code}`}`);
}

// One spelling per page: other spellings are redirected to the canonical one.
const canonical = await scan("example.com", undefined, false);
const canonicalOk = canonical.code === "canonical" && canonical.location?.includes(encodeURIComponent("https://example.com/"));
if (!canonicalOk) failed += 1;
console.log(`${canonicalOk ? "PASS" : "FAIL"}  canonical        308  example.com -> ${canonical.location}`);

// Reading settings: only offered values; anything else is refused before a browser starts.
for (const [query, expected] of [["w=99999", "bad_param"], ["wait=forever", "bad_param"], ["h=1000000", "bad_param"], ["lang=../../etc", "bad_param"]]) {
  const response = await fetch(`${base}/api/scan?url=${encodeURIComponent("https://example.com/")}&${query}`, { headers: { "x-real-ip": `198.51.100.${ip++}` }, redirect: "manual" });
  const body = await response.json();
  const ok = body.code === expected;
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${expected.padEnd(16)} ${String(response.status).padEnd(4)} ${query}${ok ? "" : `  -> ${body.code}`}`);
}

// Rate limit: the ninth scan from one address inside ten minutes is refused.
const address = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;
const codes = [];
for (let i = 0; i < 9; i += 1) codes.push((await scan(`http://10.0.0.${i + 1}/`, address)).code);
const limited = codes.slice(0, 8).every((c) => c === "private_address") && codes[8] === "rate_limited";
if (!limited) failed += 1;
console.log(`${limited ? "PASS" : "FAIL"}  rate_limited          9 scans from ${address}: ${codes.join(", ")}`);

console.log(failed ? `\n${failed} check(s) failed` : `\nall ${CASES.length + 6} checks passed`);
process.exit(failed ? 1 : 0);
