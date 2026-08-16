"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import Link from "next/link";

const MASCOT_STILL = "/characters/pashmak-login.png";
const MASCOT_VIDEO = "/characters/miogen-typing.mp4";

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

type MascotHandle = { playNow: () => void };

const AuthMascot = forwardRef<MascotHandle, { play?: boolean }>(function AuthMascot(
  { play = false },
  ref
) {
  const playRef = useRef(play);
  playRef.current = play;
  const videoRef = useRef<HTMLVideoElement>(null);
  const startedRef = useRef(false);
  const [loadVideo, setLoadVideo] = useState(false);
  const [videoOn, setVideoOn] = useState(false);

  useEffect(() => {
    if (prefersReducedMotion()) return;
    let idleId = 0;
    let startTimeout = 0;
    let fallbackTimeout = 0;
    let cancelled = false;

    const arm = () => {
      if (cancelled) return;
      setLoadVideo(true);
    };

    const afterIdle = () => {
      if (cancelled) return;
      const ric = window.requestIdleCallback;
      if (typeof ric === "function") {
        idleId = ric(arm, { timeout: 1800 });
      } else {
        fallbackTimeout = window.setTimeout(arm, 200);
      }
    };

    if (document.readyState === "complete") {
      startTimeout = window.setTimeout(afterIdle, 40);
    } else {
      window.addEventListener("load", afterIdle, { once: true });
    }

    return () => {
      cancelled = true;
      window.removeEventListener("load", afterIdle);
      if (idleId && typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleId);
      }
      if (startTimeout) window.clearTimeout(startTimeout);
      if (fallbackTimeout) window.clearTimeout(fallbackTimeout);
    };
  }, []);

  function holdAtStart(el: HTMLVideoElement) {
    el.pause();
    try {
      if (el.currentTime > 0) el.currentTime = 0;
    } catch {
      /* ignore */
    }
  }

  function startPlayback() {
    if (startedRef.current || prefersReducedMotion()) return;
    const el = videoRef.current;
    if (!el || el.readyState < 2) {
      setLoadVideo(true);
      return;
    }
    startedRef.current = true;
    el.muted = true;
    el.defaultMuted = true;
    el.autoplay = false;
    el.loop = true;
    el.playsInline = true;
    el.setAttribute("playsinline", "");
    el.setAttribute("webkit-playsinline", "");

    const run = () => {
      const attempt = el.play();
      if (attempt && typeof attempt.then === "function") {
        attempt.then(() => setVideoOn(true)).catch(() => {
          startedRef.current = false;
        });
      } else {
        setVideoOn(true);
      }
    };

    el.pause();
    if (el.currentTime > 0.04) {
      const onSeeked = () => {
        el.removeEventListener("seeked", onSeeked);
        run();
      };
      el.addEventListener("seeked", onSeeked);
      try {
        el.currentTime = 0;
      } catch {
        run();
      }
      return;
    }
    run();
  }

  function playNow() {
    playRef.current = true;
    setLoadVideo(true);
    startPlayback();
  }

  useImperativeHandle(ref, () => ({ playNow }));

  function onBuffered() {
    const el = videoRef.current;
    if (!el) return;
    if (playRef.current) {
      startPlayback();
      return;
    }
    holdAtStart(el);
  }

  useEffect(() => {
    if (!play) return;
    playNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [play]);

  return (
    <div className={`auth-mascot${videoOn ? " is-video" : ""}`} aria-hidden>
      <div className="auth-mascot-frame">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={MASCOT_STILL}
          alt=""
          className="auth-mascot-img"
          width={320}
          height={320}
        />
        {loadVideo ? (
          <video
            ref={videoRef}
            className={`auth-mascot-video${videoOn ? " is-on" : ""}`}
            src={MASCOT_VIDEO}
            muted
            loop
            playsInline
            preload="auto"
            autoPlay={false}
            disablePictureInPicture
            onLoadedMetadata={onBuffered}
            onCanPlayThrough={onBuffered}
            onLoadedData={onBuffered}
            onPlaying={() => {
              const el = videoRef.current;
              if (!playRef.current) {
                if (el) holdAtStart(el);
                return;
              }
              setVideoOn(true);
            }}
          />
        ) : null}
      </div>
    </div>
  );
});

export type AuthLayoutHandle = { playMascot: () => void };

export const AuthLayout = forwardRef<
  AuthLayoutHandle,
  {
    variant?: "business" | "platform";
    brand: string;
    tagline: string;
    children: React.ReactNode;
    footer?: React.ReactNode;
  }
>(function AuthLayout({ variant = "business", brand, tagline, children, footer }, ref) {
  const mascotRef = useRef<MascotHandle>(null);
  useImperativeHandle(ref, () => ({
    playMascot: () => mascotRef.current?.playNow()
  }));

  const points =
    variant === "business"
      ? ["ورود و ثبت‌نام فقط با موبایل", "چند کانال واتساپ و دیوار", "تیم و کانال‌های سرور"]
      : ["مدیریت همه کسب‌وکارها", "پلن، AI سراسری و سیستم", "ورود پشتیبانی به پنل مشتری"];

  return (
    <div className={`auth-screen auth-${variant}`}>
      <div className="auth-ambient" aria-hidden>
        <span className="auth-glow auth-glow-a" />
        <span className="auth-glow auth-glow-b" />
        <span className="auth-glow auth-glow-c" />
        <span className="auth-mesh" />
        <span className="auth-scan" />
      </div>

      <div className="auth-shell">
        <aside className="auth-brand-pane">
          <div className="auth-brand-inner">
            <div className="auth-brand-mark">
              <span className="auth-mark-dot" aria-hidden />
              <p className="auth-eyebrow">miogen</p>
            </div>
            <p className="auth-portal-chip">
              {variant === "business" ? "Business Console" : "Platform Console"}
            </p>
            <h1 className="auth-brand-title">{brand}</h1>
            <p className="auth-brand-copy">{tagline}</p>
            <AuthMascot ref={mascotRef} />
            <ul className="auth-points">
              {points.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </aside>

        <main className="auth-panel">
          <div className="auth-panel-card auth-enter">
            <div className="auth-card-shine" aria-hidden />
            {children}
          </div>
          {footer ? <div className="auth-footer">{footer}</div> : null}
          <p className="auth-legal">
            <Link href={variant === "business" ? "/super/login" : "/login"}>
              {variant === "business" ? "" : "ورود کسب‌وکار"}
            </Link>
          </p>
        </main>
      </div>
    </div>
  );
});

export function AuthStepHeader({
  title,
  sub,
  step,
  total = 2
}: {
  title: string;
  sub: string;
  step: number;
  total?: number;
}) {
  return (
    <div className="auth-step-head">
      <div className="auth-step-meta">
        <span>
          مرحله {step} از {total}
        </span>
        <div className="auth-step-track" aria-hidden>
          {Array.from({ length: total }).map((_, i) => (
            <i key={i} className={i < step ? "on" : ""} />
          ))}
        </div>
      </div>
      <h2>{title}</h2>
      <p>{sub}</p>
    </div>
  );
}

/** Replaces the login form after OTP success while the dashboard route loads. */
export function AuthEntering({
  title = "ورود موفق",
  sub = "در حال باز کردن پنل…"
}: {
  title?: string;
  sub?: string;
}) {
  return (
    <div className="auth-entering" role="status" aria-live="polite" aria-busy="true">
      <div className="auth-entering-orbit" aria-hidden>
        <span className="auth-entering-ring" />
        <span className="auth-entering-ring auth-entering-ring-b" />
        <span className="auth-entering-core" />
      </div>
      <h2>{title}</h2>
      <p>{sub}</p>
      <div className="auth-entering-bar" aria-hidden>
        <i />
      </div>
    </div>
  );
}
