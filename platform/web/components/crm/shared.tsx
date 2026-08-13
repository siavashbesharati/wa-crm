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
  assignee_id: string | null;
  bot_paused?: boolean;
};

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

export function leadBoardHref(leadId: string) {
  return `/pipeline?lead=${encodeURIComponent(leadId)}`;
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

export function CrmViewToggle({ mode }: { mode: "list" | "board" }) {
  return (
    <div className="view-toggle">
      <Link href="/leads" className={mode === "list" ? "active" : ""}>
        لیست
      </Link>
      <Link href="/pipeline" className={mode === "board" ? "active" : ""}>
        برد کانبان
      </Link>
    </div>
  );
}

export function TaskViewToggle({ mode }: { mode: "list" | "board" }) {
  return (
    <div className="view-toggle">
      <Link href="/tasks" className={mode === "list" ? "active" : ""}>
        لیست
      </Link>
      <Link href="/tasks/board" className={mode === "board" ? "active" : ""}>
        برد کانبان
      </Link>
    </div>
  );
}
