"use client";

import { useEffect, useMemo, useState } from "react";
import Shell from "@/components/Shell";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/Card";
import { PageLoading } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import { useMutation } from "@/lib/useApi";
import { useToast } from "@/components/ui/Toast";

type Thread = {
  lead: { id: string; name: string; phone: string; stage: string };
  accounts: { account_id: string; chat_name: string }[];
  last_message: { body: string; direction: string; created_at: string } | null;
};

type Message = {
  id: string;
  body: string;
  direction: string;
  sender_type: string;
  created_at: string;
};

export default function InboxPage() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [active, setActive] = useState<Thread | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [q, setQ] = useState("");
  const { busy, run } = useMutation();
  const toast = useToast();

  async function load() {
    setLoading(true);
    try {
      setThreads(await api<Thread[]>("/messages/threads"));
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "خطا", "err");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return threads;
    return threads.filter(
      (t) =>
        t.lead.name.toLowerCase().includes(needle) ||
        (t.lead.phone || "").includes(needle) ||
        (t.last_message?.body || "").toLowerCase().includes(needle)
    );
  }, [threads, q]);

  async function openThread(t: Thread) {
    setActive(t);
    setOpening(true);
    try {
      setMessages(await api<Message[]>(`/messages/inbox?lead_id=${t.lead.id}`));
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "خطا", "err");
    } finally {
      setOpening(false);
    }
  }

  async function send() {
    if (!active || !text.trim() || !active.accounts[0]) {
      toast.push("اکانت واتساپ برای این گفتگو موجود نیست", "err");
      return;
    }
    const body = text;
    const ok = await run(
      () =>
        api("/messages/send", {
          method: "POST",
          body: JSON.stringify({
            account_id: active.accounts[0].account_id,
            lead_id: active.lead.id,
            target_name: active.lead.name,
            body,
            sender_type: "agent"
          })
        }),
      { success: "در صف ارسال کانکتور قرار گرفت" }
    );
    if (ok) {
      setText("");
      await openThread(active);
      await load();
    }
  }

  return (
    <Shell
      title="اینباکس یکپارچه"
      sub="همه شماره‌های واتساپ سازمان در یک صف"
      search={q}
      onSearch={setQ}
    >
      {loading ? (
        <PageLoading />
      ) : (
        <div className="thread">
          <div className="thread-list">
            {filtered.length === 0 ? (
              <EmptyState title="گفتگویی نیست" text="بعد از همگام‌سازی پیام‌ها اینجا می‌آیند." />
            ) : (
              filtered.map((t) => (
                <div
                  key={t.lead.id}
                  className={`thread-item ${active?.lead.id === t.lead.id ? "active" : ""}`}
                  onClick={() => openThread(t)}
                >
                  <strong>{t.lead.name}</strong>
                  <div className="hint">{t.last_message?.body || "بدون پیام"}</div>
                </div>
              ))
            )}
          </div>
          <div className="thread-pane">
            {!active ? (
              <EmptyState title="یک گفتگو را انتخاب کنید" />
            ) : opening ? (
              <PageLoading label="بارگذاری پیام‌ها…" />
            ) : (
              <>
                <div style={{ padding: 14, borderBottom: "1px solid var(--border)" }}>
                  <strong>{active.lead.name}</strong>
                  <div className="hint">{active.lead.stage}</div>
                </div>
                <div style={{ maxHeight: 360, overflow: "auto", minHeight: 200 }}>
                  {[...messages].reverse().map((m) => (
                    <div
                      key={m.id}
                      className={`msg ${m.direction === "outbound" ? "out" : "in"}`}
                    >
                      <div className="hint">{m.sender_type}</div>
                      {m.body}
                    </div>
                  ))}
                </div>
                <div style={{ padding: 12, display: "grid", gap: 8 }}>
                  <textarea
                    rows={3}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="پیام خود را بنویسید…"
                  />
                  <Button loading={busy} onClick={send}>
                    ارسال (صف کانکتور)
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </Shell>
  );
}
