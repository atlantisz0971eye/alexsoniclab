import assert from "node:assert/strict";
import { test } from "node:test";
import { ScanError } from "../server/errors.ts";
import { checkUrl, checkUrlShape, isPublicAddress, normalizeUrl } from "../server/urlGuard.ts";

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return error instanceof ScanError ? error.code : String(error);
  }
  return "passed";
};
const asyncCode = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
  } catch (error) {
    return error instanceof ScanError ? error.code : String(error);
  }
  return "passed";
};

test("private, loopback, link-local, metadata and reserved addresses are not public", () => {
  for (const address of [
    "0.0.0.0", "10.1.2.3", "100.64.0.1", "127.0.0.1", "127.255.255.254", "169.254.169.254", "172.16.0.1", "172.31.255.255",
    "192.0.0.170", "192.0.2.1", "192.168.1.1", "198.18.0.1", "198.51.100.7", "203.0.113.9", "224.0.0.1", "240.0.0.1", "255.255.255.255",
    "::", "::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:169.254.169.254", "::127.0.0.1", "64:ff9b::a9fe:a9fe", "64:ff9b::10.0.0.1",
    "2002:7f00:1::", "2002:c0a8:101::1", "fc00::1", "fd12:3456::1", "fe80::1", "fe80::1%en0", "fec0::1", "ff02::1", "2001:db8::1", "2001::1",
    "fd00:ec2::254", "not-an-ip",
  ]) {
    assert.equal(isPublicAddress(address), false, address);
  }
});

test("ordinary public addresses are public", () => {
  for (const address of ["1.1.1.1", "8.8.8.8", "93.184.215.14", "172.32.0.1", "100.128.0.1", "2606:4700:4700::1111", "2a00:1450:4001:80b::200e", "::ffff:8.8.8.8", "64:ff9b::808:808", "2002:808:808::1"]) {
    assert.equal(isPublicAddress(address), true, address);
  }
});

test("URL shape: only http(s), usual ports, no credentials, no internal names", () => {
  const shape = (raw: string) => code(() => checkUrlShape(normalizeUrl(raw)));
  assert.equal(shape("file:///etc/passwd"), "bad_scheme");
  assert.equal(shape("ftp://example.com/"), "bad_scheme");
  assert.equal(shape("javascript:alert(1)"), "bad_scheme");
  assert.equal(shape("data:text/html,hi"), "bad_scheme");
  assert.equal(shape("gopher://example.com/"), "bad_scheme");
  assert.equal(shape("http://user:pass@example.com/"), "bad_url");
  assert.equal(shape("http://example.com:22/"), "bad_port");
  assert.equal(shape("http://example.com:6379/"), "bad_port");
  assert.equal(shape("http://localhost/"), "private_address");
  assert.equal(shape("http://LOCALHOST./"), "private_address");
  assert.equal(shape("http://api.localhost/"), "private_address");
  assert.equal(shape("http://metadata.google.internal/"), "private_address");
  assert.equal(shape("http://printer.local/"), "private_address");
  assert.equal(shape("http://intranet/"), "private_address");
  assert.equal(shape("http://127.0.0.1/"), "private_address");
  assert.equal(shape("http://2130706433/"), "private_address"); // decimal 127.0.0.1
  assert.equal(shape("http://0x7f.0.0.1/"), "private_address"); // hex
  assert.equal(shape("http://0177.0.0.1/"), "private_address"); // octal
  assert.equal(shape("http://127.1/"), "private_address"); // short form
  assert.equal(shape("http://[::1]/"), "private_address");
  assert.equal(shape("http://[::ffff:169.254.169.254]/"), "private_address");
  assert.equal(shape("http://169.254.169.254/latest/meta-data/"), "private_address");
  assert.equal(shape("http://[fd00:ec2::254]/"), "private_address"); // AWS IMDS over IPv6
  assert.equal(shape("example.com"), "passed");
  assert.equal(shape("https://en.wikipedia.org/wiki/Techno"), "passed");
  assert.equal(code(() => normalizeUrl("")), "bad_url");
  assert.equal(code(() => normalizeUrl("http://exa mple.com")), "bad_url");
});

test("names that resolve to private addresses are refused after DNS", async () => {
  assert.equal(await asyncCode(() => checkUrl(new URL("http://localtest.me/"))), "private_address");
  assert.equal(await asyncCode(() => checkUrl(new URL("http://169.254.169.254.nip.io/"))), "private_address");
  assert.equal(await asyncCode(() => checkUrl(new URL("http://10.0.0.1.nip.io/"))), "private_address");
  assert.equal(await asyncCode(() => checkUrl(new URL("http://does-not-exist.invalid/"))), "unresolvable");
  assert.equal(await asyncCode(() => checkUrl(new URL("https://example.com/"))), "passed");
});
