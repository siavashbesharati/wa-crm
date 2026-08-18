"use client";

import Link from "next/link";
import type { ReactNode } from "react";

export type Lead = {
  id: string;
  name: string;
  phone: string;
  group_id: string;
  external_chat_id?: string | null;
  wa_lid?: string;
  post_token?: string;
  source_channel?: string;
  chat_type?: string;
  stage: string;
  board_order?: number;
  tags: string[];
  notes: string;
  lead_score?: number;
  ai_meta?: {
    sentiment?: string;
    suggested_stage?: string;
    last_enriched_at?: string;
    confidence?: number;
    escalation?: boolean;
    buying_intent?: number;
    memory?: { summary?: string; updated_at?: string };
    follow_up_plan?: {
      status?: string;
      step?: number;
      run_at_ts?: number;
      reason?: string;
    };
  };
  assignee_id: string | null;
  bot_paused?: boolean;
};

export const TAG_LABELS_FA: Record<string, string> = {
  new_lead: "لید جدید",
  high_intent: "قصد خرید بالا",
  low_intent: "قصد خرید پایین",
  price_sensitive: "حساس به قیمت",
  info_seeking: "در حال تحقیق",
  ready_to_buy: "آماده خرید",
  promoter: "راضی / معرف",
  detractor: "ناراضی",
  churn_risk: "ریسک از دست رفتن",
  needs_human: "نیاز به کارشناس",
  complaint: "شکایت",
  follow_up: "نیاز به پیگیری",
  qualified: "واجد شرایط",
  unqualified: "غیرواجد",
  handoff: "ارجاع دستی"
};

export const SENTIMENT_LABELS_FA: Record<string, string> = {
  positive: "مثبت",
  neutral: "خنثی",
  negative: "منفی"
};

export function tagLabel(key: string) {
  return TAG_LABELS_FA[key] || key;
}

export const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: "واتساپ",
  divar: "دیوار",
  bale: "بله"
};

export function leadPhone(l: Lead) {
  const p = (l.phone || "").trim();
  if (!p) return "";
  // Never treat WhatsApp contact ids or Bale peer keys as phone in the UI
  if (p.includes("@lid") || p.includes("@c.us") || p.includes("@s.whatsapp.net")) return "";
  if (p.startsWith("bale:")) return "";
  return p;
}

export function leadContactId(l: Lead) {
  const lid = (l.wa_lid || "").trim();
  const ext = (l.external_chat_id || "").trim();
  const p = (l.phone || "").trim();
  if (ext.startsWith("bale:")) return ext;
  if (lid) return lid;
  if (ext) return ext;
  if (p.includes("@lid") || p.includes("@c.us") || p.includes("@s.whatsapp.net")) return p;
  return "";
}

export function leadDisplayName(l: Lead) {
  const n = (l.name || "").trim();
  const opaque =
    !n ||
    n.startsWith("bale:") ||
    n.includes("@s.whatsapp.net") ||
    n.includes("@c.us") ||
    n.endsWith("@lid");
  if (!opaque) return n;
  const phone = leadPhone(l);
  if (phone) return phone;
  if ((l.source_channel || "").toLowerCase() === "bale") return "مخاطب بله";
  return n || "بدون نام";
}

/** @deprecated Prefer leadPhone / leadContactId — kept for list fallbacks */
export function leadIdentity(l: Lead) {
  return leadPhone(l) || leadContactId(l) || l.group_id || "-";
}

export function LtrText({
  children,
  className = ""
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span dir="ltr" className={`ltr-text ${className}`.trim()}>
      {children}
    </span>
  );
}

export type Member = { user_id: string; display_name: string; phone: string };

export type CrmTask = {
  id: string;
  title: string;
  message: string;
  status: string;
  lead_id: string | null;
  assignee_id: string | null;
  due_at: string | null;
  board_order?: number;
  source?: string;
  source_message_id?: string;
};

export const SETUP_TASK_HREF: Record<string, string> = {
  "setup:whatsapp": "/channels?connect=whatsapp",
  "setup:divar": "/channels?connect=divar",
  "setup:bale": "/channels?connect=bale"
};

export function isSetupChannelTask(t: { source_message_id?: string | null }) {
  const key = (t.source_message_id || "").trim();
  return key === "setup:whatsapp" || key === "setup:divar" || key === "setup:bale";
}

export function setupTaskHref(t: {
  source_message_id?: string | null;
  status?: string;
}) {
  if (t.status === "done" || t.status === "cancelled") return null;
  const key = (t.source_message_id || "").trim();
  return SETUP_TASK_HREF[key] || null;
}

export const TASK_STATUSES = ["open", "in_progress", "done", "cancelled"] as const;

export const TASK_STATUS_LABELS: Record<string, string> = {
  open: "باز",
  in_progress: "در حال انجام",
  done: "انجام‌شده",
  cancelled: "لغو شده"
};

export const TASK_STATUS_DOT: Record<string, string> = {
  open: "new",
  in_progress: "follow",
  done: "buy",
  cancelled: "closed"
};

export function leadHref(leadId: string) {
  return `/leads?lead=${encodeURIComponent(leadId)}`;
}

function tasksQuery(opts?: { leadId?: string | null; tag?: string | null }) {
  const params = new URLSearchParams();
  if (opts?.leadId) params.set("lead", opts.leadId);
  if (opts?.tag) params.set("tag", opts.tag);
  const q = params.toString();
  return q ? `?${q}` : "";
}

export function tasksBoardHref(leadId?: string | null, tag?: string | null) {
  return `/tasks${tasksQuery({ leadId, tag })}`;
}

export function tasksListHref(leadId?: string | null, tag?: string | null) {
  return `/tasks/list${tasksQuery({ leadId, tag })}`;
}

export function tasksByTagHref(tag: string) {
  return tasksBoardHref(null, tag);
}

export const STAGES = ["جدید", "پیگیری", "پیشنهاد", "خرید", "بسته"] as const;

export const STAGE_DOT: Record<string, string> = {
  جدید: "new",
  پیگیری: "follow",
  پیشنهاد: "offer",
  خرید: "buy",
  بسته: "closed"
};

export function memberLabel(m: Member | undefined) {
  if (!m) return "";
  return m.display_name || m.phone || "";
}

export function initials(text: string) {
  return (text || "?").trim().slice(0, 1);
}

export function TaskViewToggle({
  mode,
  leadId,
  tag
}: {
  mode: "list" | "board";
  leadId?: string | null;
  tag?: string | null;
}) {
  return (
    <div className="view-toggle">
      <Link href={tasksListHref(leadId, tag)} className={mode === "list" ? "active" : ""}>
        لیست
      </Link>
      <Link href={tasksBoardHref(leadId, tag)} className={mode === "board" ? "active" : ""}>
        برد کانبان
      </Link>
    </div>
  );
}
