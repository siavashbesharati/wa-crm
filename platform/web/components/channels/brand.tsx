"use client";

import { CHANNEL_LABELS } from "@/components/crm/shared";

const DIVAR_LOGO = "/brands/Divar%20Logo.svg";
const BALE_LOGO = "/brands/bale.svg";
const INSTAGRAM_LOGO = "/brands/instagram.svg";

function WhatsAppMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2m.01 1.67c2.2 0 4.26.86 5.82 2.42a8.22 8.22 0 0 1 2.41 5.83c0 4.54-3.7 8.23-8.24 8.23-1.48 0-2.93-.39-4.19-1.15l-.3-.17-3.12.82.83-3.04-.2-.32a8.2 8.2 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.25-8.24m-2.74 4.25c-.17 0-.44.06-.67.31-.23.26-.88.86-.88 2.1 0 1.24.9 2.44 1.02 2.61.13.17 1.76 2.67 4.25 3.75 2.07.9 2.49.72 2.94.67.45-.04 1.45-.59 1.65-1.16.21-.57.21-1.06.15-1.16-.06-.1-.23-.16-.48-.29-.25-.13-1.47-.73-1.7-.81-.23-.08-.39-.13-.56.13-.17.26-.64.81-.79.97-.14.17-.29.19-.54.06-.25-.13-1.05-.39-2-1.23-.74-.66-1.24-1.47-1.38-1.72-.15-.26-.02-.4.11-.53.11-.11.25-.29.38-.43.12-.14.17-.25.25-.41.09-.17.04-.31-.02-.43-.06-.13-.55-1.33-.76-1.82-.2-.48-.4-.41-.56-.42"
      />
    </svg>
  );
}

const KNOWN = new Set(["whatsapp", "divar", "bale", "instagram"]);

export function ChannelBrand({
  channel,
  size = "md",
  className = ""
}: {
  channel?: string;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
}) {
  const ch = (channel || "").toLowerCase();
  if (!KNOWN.has(ch)) return null;
  return (
    <span className={`channel-brand ${ch} ${size} ${className}`.trim()} aria-hidden>
      {ch === "divar" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={DIVAR_LOGO} alt="" />
      ) : ch === "bale" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={BALE_LOGO} alt="" />
      ) : ch === "instagram" ? (
        <img src={INSTAGRAM_LOGO} alt="" />
      ) : (
        <WhatsAppMark />
      )}
    </span>
  );
}

export function ChannelBadge({ channel }: { channel?: string }) {
  const ch = (channel || "").toLowerCase();
  if (!KNOWN.has(ch)) return null;
  return (
    <span className={`ch-badge ${ch}`}>
      <ChannelBrand channel={ch} size="xs" />
      {CHANNEL_LABELS[ch]}
    </span>
  );
}
