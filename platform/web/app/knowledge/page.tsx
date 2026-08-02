"use client";

import { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { api } from "@/lib/api";

type Doc = { id: string; title: string; source: string; created_at: string };

export default function KnowledgePage() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [msg, setMsg] = useState("");

  async function load() {
    setDocs(await api<Doc[]>("/ai/knowledge"));
  }

  useEffect(() => {
    load().catch(console.error);
  }, []);

  async function upload() {
    await api("/ai/knowledge", {
      method: "POST",
      body: JSON.stringify({ title, content })
    });
    setTitle("");
    setContent("");
    setMsg("دانش ذخیره و بردارسازی شد.");
    await load();
  }

  return (
    <Shell title="پایگاه دانش AI" sub="منبع پاسخ‌های برداری‌شده فارسی">
      <div className="card form-grid">
        <label className="full">
          عنوان
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="full">
          متن دانش
          <textarea rows={8} value={content} onChange={(e) => setContent(e.target.value)} />
        </label>
        <button className="btn" onClick={upload}>
          آپلود و ایندکس
        </button>
      </div>
      {msg && <p className="hint">{msg}</p>}
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>عنوان</th>
              <th>منبع</th>
              <th>تاریخ</th>
            </tr>
          </thead>
          <tbody>
            {docs.map((d) => (
              <tr key={d.id}>
                <td>{d.title}</td>
                <td>{d.source}</td>
                <td>{new Date(d.created_at).toLocaleString("fa-IR")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
