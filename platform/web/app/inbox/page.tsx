"use client";

import { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { api } from "@/lib/api";

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

  async function load() {
    setThreads(await api<Thread[]>("/messages/threads"));
  }

  useEffect(() => {
    load().catch(console.error);
  }, []);

  async function openThread(t: Thread) {
    setActive(t);
    setMessages(await api<Message[]>(`/messages/inbox?lead_id=${t.lead.id}`));
  }

  async function send() {
    if (!active || !text.trim() || !active.accounts[0]) return;
    await api("/messages/send", {
      method: "POST",
      body: JSON.stringify({
        account_id: active.accounts[0].account_id,
        lead_id: active.lead.id,
        target_name: active.lead.name,
        body: text,
        sender_type: "agent"
      })
    });
    setText("");
    await openThread(active);
    await load();
  }

  return (
    <Shell title="اینباکس یکپارچه" sub="همه شماره‌های واتساپ سازمان در یک صف">
      <div className="thread">
        <div className="thread-list">
          {threads.map((t) => (
            <div
              key={t.lead.id}
              className={`thread-item ${active?.lead.id === t.lead.id ? "active" : ""}`}
              onClick={() => openThread(t)}
            >
              <strong>{t.lead.name}</strong>
              <div className="hint">{t.last_message?.body || "بدون پیام"}</div>
            </div>
          ))}
        </div>
        <div className="thread-pane">
          {!active ? (
            <p className="hint" style={{ padding: 16 }}>
              یک گفتگو را انتخاب کنید
            </p>
          ) : (
            <>
              <div style={{ padding: 12, borderBottom: "1px solid #dbeafe" }}>
                <strong>{active.lead.name}</strong>
                <div className="hint">{active.lead.stage}</div>
              </div>
              <div style={{ maxHeight: 360, overflow: "auto" }}>
                {[...messages].reverse().map((m) => (
                  <div key={m.id} className={`msg ${m.direction === "outbound" ? "out" : "in"}`}>
                    <div className="hint">{m.sender_type}</div>
                    {m.body}
                  </div>
                ))}
              </div>
              <div style={{ padding: 12, display: "grid", gap: 8 }}>
                <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} />
                <button className="btn" onClick={send}>
                  ارسال (صف کانکتور)
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </Shell>
  );
}
