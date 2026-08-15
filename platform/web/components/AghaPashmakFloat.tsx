"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { api } from "@/lib/api";

const CHAT_HREF = "/aghaye-pashmak?chat=1";
const POS_KEY = "pashmak-float-pos";
const DRAG_THRESHOLD = 6;

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

type Pos = { x: number; y: number };

function isMood(v: string | undefined): v is PashmakMood {
  return v === "normal" || v === "happy" || v === "exhaust" || v === "alert";
}

function readSavedPos(): Pos | null {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Pos;
    if (typeof p?.x === "number" && typeof p?.y === "number") return p;
  } catch {
    /* ignore */
  }
  return null;
}

function defaultPos(elW = 100, elH = 120): Pos {
  const mobile = typeof window !== "undefined" && window.innerWidth <= 720;
  const left = mobile ? 10 : 18;
  const bottom = mobile ? 72 : 18;
  return {
    x: left,
    y: Math.max(8, window.innerHeight - bottom - elH)
  };
}

function clampPos(p: Pos, elW: number, elH: number): Pos {
  const maxX = Math.max(8, window.innerWidth - elW - 8);
  const maxY = Math.max(8, window.innerHeight - elH - 8);
  return {
    x: Math.min(maxX, Math.max(8, p.x)),
    y: Math.min(maxY, Math.max(8, p.y))
  };
}

/** Floating «آقای پشمک» mascot — draggable; pose follows CRM load. */
export function AghaPashmakFloat() {
  const pathname = usePathname();
  const router = useRouter();
  const onCoachPage =
    pathname === "/aghaye-pashmak" || pathname.startsWith("/aghaye-pashmak/");
  const [mood, setMood] = useState<PashmakMood>("normal");
  const [tipOverride, setTipOverride] = useState<string | null>(null);
  const [pos, setPos] = useState<Pos | null>(null);
  const [dragging, setDragging] = useState(false);
  const rootRef = useRef<HTMLButtonElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    moved: boolean;
  } | null>(null);

  useEffect(() => {
    if (onCoachPage) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await api<{
          mood?: string;
          tip?: string | null;
          hot_lead?: { name?: string; buying_intent?: number } | null;
        }>("/ai/pir/mood");
        if (cancelled) return;
        if (isMood(res.mood)) setMood(res.mood);
        const custom =
          (res.tip || "").trim() ||
          (res.hot_lead?.name
            ? `لید داغ: ${res.hot_lead.name}`
            : "");
        setTipOverride(custom || null);
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

  useEffect(() => {
    if (onCoachPage) return;
    const el = rootRef.current;
    const w = el?.offsetWidth || 100;
    const h = el?.offsetHeight || 120;
    const saved = readSavedPos();
    setPos(clampPos(saved || defaultPos(w, h), w, h));
  }, [onCoachPage]);

  useEffect(() => {
    if (onCoachPage || !pos) return;
    const onResize = () => {
      const el = rootRef.current;
      const w = el?.offsetWidth || 100;
      const h = el?.offsetHeight || 120;
      setPos((cur) => (cur ? clampPos(cur, w, h) : cur));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [onCoachPage, pos]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0 && e.pointerType === "mouse") return;
      const el = rootRef.current;
      if (!el || !pos) return;
      el.setPointerCapture(e.pointerId);
      dragRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        origX: pos.x,
        origY: pos.y,
        moved: false
      };
    },
    [pos]
  );

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    d.moved = true;
    setDragging(true);
    const el = rootRef.current;
    const w = el?.offsetWidth || 100;
    const h = el?.offsetHeight || 120;
    setPos(clampPos({ x: d.origX + dx, y: d.origY + dy }, w, h));
  }, []);

  const endDrag = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      const d = dragRef.current;
      if (!d || d.pointerId !== e.pointerId) return;
      dragRef.current = null;
      setDragging(false);
      try {
        rootRef.current?.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      if (d.moved) {
        const el = rootRef.current;
        const w = el?.offsetWidth || 100;
        const h = el?.offsetHeight || 120;
        setPos((cur) => {
          if (!cur) return cur;
          const next = clampPos(cur, w, h);
          try {
            localStorage.setItem(POS_KEY, JSON.stringify(next));
          } catch {
            /* ignore */
          }
          return next;
        });
        return;
      }
      router.push(CHAT_HREF);
    },
    [router]
  );

  if (onCoachPage) return null;

  const src = MOOD_IMG[mood];
  const tip = tipOverride || MOOD_TIP[mood];

  return (
    <button
      ref={rootRef}
      type="button"
      className={`pashmak-float pashmak-mood-${mood}${dragging ? " is-dragging" : ""}${
        pos ? " is-placed" : ""
      }`}
      style={
        pos
          ? { left: pos.x, top: pos.y, right: "auto", bottom: "auto" }
          : undefined
      }
      aria-label={`گفتگو با آقای پشمک — ${tip}. بکشید تا جابه‌جا شود.`}
      title={`${tip} · بکشید تا جابه‌جا شود`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        key={mood}
        src={src}
        alt={tip}
        className="pashmak-float-img"
        width={96}
        height={96}
        draggable={false}
      />
      <span className="pashmak-float-tip">{tip}</span>
    </button>
  );
}

/** Default chat profile image (calm / normal pose). */
export const PASHMAK_AVATAR = MOOD_IMG.normal;
export const PASHMAK_NAME = "آقای پشمک";
export { MOOD_IMG };
