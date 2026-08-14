"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { api, getSession } from "@/lib/api";
import {
  isAccountNeedsReconnect,
  type ChannelAccount
} from "@/components/channels/shared";
import { CHANNEL_LABELS } from "@/components/crm/shared";

type AlertState = {
  accounts: ChannelAccount[];
  dismissedKey: string;
} | null;

function accountKey(rows: ChannelAccount[]) {
  return rows
    .map((a) => a.id)
    .sort()
    .join(",");
}

function channelFa(ch: string) {
  return CHANNEL_LABELS[ch] || ch || "کانال";
}

/** Polls channel health and shows a reconnect modal when any account is down. */
export function ChannelHealthWatch() {
  const pathname = usePathname();
  const [alert, setAlert] = useState<AlertState>(null);
  const knownOn = useRef<Set<string>>(new Set());
  const bootstrapped = useRef(false);
  const dismissedRef = useRef<string>("");

  const check = useCallback(async () => {
    if (!getSession()) return;
    // Don't cover the channels reconnect UI itself
    if (pathname === "/channels" || pathname.startsWith("/channels/")) {
      setAlert(null);
      return;
    }
    try {
      const rows = await api<ChannelAccount[]>("/channels/accounts");
      const down = rows.filter(isAccountNeedsReconnect);
      const downKey = accountKey(down);

      const nextOn = new Set(
        rows.filter((a) => !isAccountNeedsReconnect(a)).map((a) => a.id)
      );

      // First poll: seed state without startling the user mid-page-load
      if (!bootstrapped.current) {
        bootstrapped.current = true;
        knownOn.current = nextOn;
        if (down.length > 0) {
          dismissedRef.current = "";
          setAlert({ accounts: down, dismissedKey: "" });
        }
        return;
      }

      // Newly dropped connections always re-open the modal
      let newlyDown = false;
      for (const a of down) {
        if (knownOn.current.has(a.id)) {
          newlyDown = true;
          break;
        }
      }
      knownOn.current = nextOn;

      if (down.length === 0) {
        setAlert(null);
        dismissedRef.current = "";
        return;
      }

      if (newlyDown || dismissedRef.current !== downKey) {
        if (newlyDown) dismissedRef.current = "";
        setAlert({ accounts: down, dismissedKey: dismissedRef.current });
      }
    } catch {
      /* ignore transient API errors */
    }
  }, [pathname]);

  useEffect(() => {
    void check();
    const t = window.setInterval(() => void check(), 12000);
    return () => window.clearInterval(t);
  }, [check]);

  if (!alert || alert.accounts.length === 0) return null;
  if (alert.dismissedKey && alert.dismissedKey === accountKey(alert.accounts)) {
    return null;
  }

  const names = alert.accounts.map((a) => {
    const label = a.label || a.phone || a.external_id || a.id.slice(0, 8);
    return `${channelFa(a.channel)} «${label}»`;
  });
  const title =
    alert.accounts.length === 1
      ? "اتصال کانال قطع شد"
      : `${alert.accounts.length} کانال قطع هستند`;
  const body =
    alert.accounts.length === 1
      ? `اتصال ${names[0]} برقرار نیست. برای ادامه ارسال/دریافت پیام، دوباره وصل کنید.`
      : `این کانال‌ها قطع هستند: ${names.join("، ")}. برای ادامه کار، از صفحه کانال‌ها دوباره وصل کنید.`;

  return (
    <div className="channel-health-overlay" role="alertdialog" aria-modal="true" aria-labelledby="channel-health-title">
      <div className="channel-health-modal">
        <div className="channel-health-icon" aria-hidden>
          !
        </div>
        <h2 id="channel-health-title">{title}</h2>
        <p>{body}</p>
        <div className="channel-health-actions">
          <Link className="btn" href="/channels" onClick={() => setAlert(null)}>
            رفتن به کانال‌ها
          </Link>
          <button
            type="button"
            className="btn secondary"
            onClick={() => {
              const key = accountKey(alert.accounts);
              dismissedRef.current = key;
              setAlert({ accounts: alert.accounts, dismissedKey: key });
            }}
          >
            بعداً
          </button>
        </div>
      </div>
    </div>
  );
}
