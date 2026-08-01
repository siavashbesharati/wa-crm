/**
 * Provides trusted UTC time from the web (so users can't easily fake expiry
 * by changing the Windows clock).
 */
chrome.runtime.onMessage.addListener(function (message, _sender, sendResponse) {
  if (message?.type !== "getTrustedTime") return;

  (async function () {
    const endpoints = [
      "https://worldtimeapi.org/api/timezone/Etc/UTC",
      "https://timeapi.io/api/Time/current/zone?timeZone=UTC"
    ];

    for (let i = 0; i < endpoints.length; i++) {
      try {
        const res = await fetch(endpoints[i], { cache: "no-store" });
        if (!res.ok) continue;
        const data = await res.json();

        // worldtimeapi
        if (data.unixtime) {
          sendResponse({
            ok: true,
            nowMs: Number(data.unixtime) * 1000,
            source: "worldtimeapi"
          });
          return;
        }

        // timeapi.io
        if (data.dateTime) {
          const ms = Date.parse(data.dateTime);
          if (!Number.isNaN(ms)) {
            sendResponse({ ok: true, nowMs: ms, source: "timeapi.io" });
            return;
          }
        }
      } catch (_err) {
        // try next
      }
    }

    // Last resort: HTTP Date header from a reliable host
    try {
      const res = await fetch("https://www.cloudflare.com/cdn-cgi/trace", {
        cache: "no-store"
      });
      const text = await res.text();
      const match = text.match(/ts=(\d+)/);
      if (match) {
        sendResponse({
          ok: true,
          nowMs: Number(match[1]) * 1000,
          source: "cloudflare-trace"
        });
        return;
      }
    } catch (_err) {
      // ignore
    }

    sendResponse({
      ok: false,
      error: "network_time_unavailable"
    });
  })();

  return true;
});
