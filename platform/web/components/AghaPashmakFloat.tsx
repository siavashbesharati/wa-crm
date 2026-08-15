"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { api } from "@/lib/api";

const CHAT_HREF = "/pir-kharabat?chat=1";

export type PashmakMood = "normal" | "happy" | "exhaust" | "alert";

const MOOD_IMG: Record<PashmakMood, string> = {
  normal: "/characters/pashmak-normal.png",
  happy: "/characters/pashmak-happy.png",
  exhaust: "/characters/pashmak-exhaust.png",
  alert: "/characters/pashmak-alert.png"
};

const MOOD_TIP: Record<PashmakMood, string> = {
  normal: "آقای پشمک",
  happy: "همه کارها تموم!",
  exhaust: "کار زیاد…",
  alert: "لید مهم!"
};

const POLL_MS = 45_000;

function isMood(v: string | undefined): v is PashmakMood {
  return v === "normal" || v === "happy" || v === "exhaust" || v === "alert";
}

/** Floating «آقای پشمک» mascot — bottom-left; pose follows CRM load. */
export function AghaPashmakFloat() {
  const pathname = usePathname();
  const onCoachPage = pathname === "/pir-kharabat" || pathname.startsWith("/pir-kharabat/");
  const [mood, setMood] = useState<PashmakMood>("normal");

  useEffect(() => {
    if (onCoachPage) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await api<{ mood?: string }>("/ai/pir/mood");
        if (!cancelled && isMood(res.mood)) setMood(res.mood);
      } catch {
        /* keep last mood */
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [onCoachPage, pathname]);

  if (onCoachPage) return null;

  const src = MOOD_IMG[mood];
  const tip = MOOD_TIP[mood];

  return (
    <Link
      href={CHAT_HREF}
      className={`pashmak-float pashmak-mood-${mood}`}
      aria-label={`گفتگو با آقای پشمک — ${tip}`}
      title={tip}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        key={mood}
        src={src}
        alt={tip}
        className="pashmak-float-img"
        width={96}
        height={96}
      />
      <span className="pashmak-float-tip">{tip}</span>
    </Link>
  );
}

/** Default chat profile image (calm / normal pose). */
export const PASHMAK_AVATAR = MOOD_IMG.normal;
export const PASHMAK_NAME = "آقای پشمک";
export { MOOD_IMG };
