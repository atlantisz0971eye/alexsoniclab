/** Every way a scan can fail, with the HTTP status the API answers and what the visitor is told. */
export const SCAN_ERRORS = {
  bad_url: [400, "That does not look like a web address."],
  bad_scheme: [400, "Only http:// and https:// pages can be read."],
  bad_port: [400, "Only pages on the usual web ports (80, 443, 8080, 8443) can be read."],
  private_address: [403, "That address points into a private network, so it is not read."],
  unresolvable: [404, "That site's name does not resolve. Check the spelling."],
  unreachable: [502, "The site did not answer."],
  timeout: [504, "The site took too long to load."],
  too_large: [413, "The page is too large to read."],
  too_many_redirects: [508, "The page redirects too many times."],
  not_html: [415, "That address is not a web page (it is a file or data)."],
  http_error: [502, "The site answered with an error."],
  blocked: [451, "This site keeps automated visitors out (a bot check or captcha), so it cannot be read from here."],
  login: [401, "This page needs a login. Only public pages can be read."],
  empty: [422, "The page loaded but had nothing to read."],
  rate_limited: [429, "Too many scans from your address. Wait a few minutes."],
  busy: [503, "The scanner is busy. Try again in a moment."],
  internal: [500, "The scanner failed on this page."],
} as const;

export type ScanErrorCode = keyof typeof SCAN_ERRORS;

export class ScanError extends Error {
  readonly code: ScanErrorCode;
  readonly detail?: string;
  constructor(code: ScanErrorCode, detail?: string) {
    super(SCAN_ERRORS[code][1]);
    this.code = code;
    this.detail = detail;
  }
  get status() {
    return SCAN_ERRORS[this.code][0];
  }
}
