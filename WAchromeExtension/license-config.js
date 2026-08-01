/**
 * Hardcoded license records (HASH ONLY — never store plaintext keys here).
 *
 * Generate a new entry:
 *   npm run license:gen -- --key "YOUR-KEY" --expires "2026-12-31T23:59:59Z"
 *
 * Then paste the printed fields into an object inside `entries` below.
 */
(function (global) {
  global.IRANEXPEDIA_LICENSE_CONFIG = {
    // Change this salt when generating keys (must match generate script)
    salt: "iranexpedia.ir::wa-license-v1",

    // If true, license check needs online UTC time (harder to fake by changing PC clock)
    requireNetworkTime: true,

    // Fallback if network time fails (only used when requireNetworkTime is false)
    allowLocalTimeFallback: false,

    entries: [
      {
        // generated for label: taban
        hash: "ae4caab68fd14646227ca1b1369b8e2d357e564962b674afb97f1d1f7d1b7b79",
        expiresAt: "2026-12-31T23:59:59.000Z",
        label: "taban"
      }
    ]
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
