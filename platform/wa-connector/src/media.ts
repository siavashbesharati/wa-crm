import pino from "pino";

const log = pino({
  level: process.env.LOG_LEVEL || "info",
  base: { source: "whatsapp" },
});

/**
 * Optional voice transcription via OpenAI-compatible Whisper endpoint.
 * Set WA_STT_URL + WA_STT_API_KEY (e.g. Groq whisper) to enable.
 */
export async function maybeTranscribeAudio(
  buffer: Buffer,
  mime: string
): Promise<string> {
  const url = (process.env.WA_STT_URL || "").trim();
  const key = (process.env.WA_STT_API_KEY || "").trim();
  if (!url || !key) return "";

  try {
    const form = new FormData();
    const blob = new Blob([new Uint8Array(buffer)], { type: mime || "audio/ogg" });
    form.append("file", blob, "audio.ogg");
    form.append("model", process.env.WA_STT_MODEL || "whisper-large-v3");
    const res = await fetch(url.replace(/\/$/, "") + "/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });
    if (!res.ok) {
      log.warn({ status: res.status }, "STT failed");
      return "";
    }
    const data = (await res.json()) as { text?: string };
    return (data.text || "").trim();
  } catch (err) {
    log.warn({ err }, "STT error");
    return "";
  }
}
