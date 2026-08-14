"use client";

import Link from "next/link";
import type { ReactNode } from "react";

export type Lead = {
  id: string;
  name: string;
  phone: string;
  group_id: string;
  external_chat_id?: string | null;
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
  divar: "دیوار"
};

export function leadIdentity(l: Lead) {
  return l.phone || l.external_chat_id || l.group_id || "-";
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
};

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

export function tasksBoardHref(leadId?: string | null) {
  if (!leadId) return "/tasks";
  return `/tasks?lead=${encodeURIComponent(leadId)}`;
}

export function tasksListHref(leadId?: string | null) {
  if (!leadId) return "/tasks/list";
  return `/tasks/list?lead=${encodeURIComponent(leadId)}`;
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
  leadId
}: {
  mode: "list" | "board";
  leadId?: string | null;
}) {
  return (
    <div className="view-toggle">
      <Link href={tasksListHref(leadId)} className={mode === "list" ? "active" : ""}>
        لیست
      </Link>
      <Link href={tasksBoardHref(leadId)} className={mode === "board" ? "active" : ""}>
        برد کانبان
      </Link>
    </div>
  );
}
