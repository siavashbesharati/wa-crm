"use client";

import Link from "next/link";

export type Lead = {
  id: string;
  name: string;
  phone: string;
  group_id: string;
  stage: string;
  tags: string[];
  notes: string;
  assignee_id: string | null;
};

export type Member = { user_id: string; display_name: string; phone: string };

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
        برد
      </Link>
    </div>
  );
}
