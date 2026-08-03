"use client";

import { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { Button } from "@/components/ui/Button";
import { Card, EmptyState } from "@/components/ui/Card";
import { PageLoading } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import { useMutation } from "@/lib/useApi";
import { useToast } from "@/components/ui/Toast";

type Doc = { id: string; title: string; source: string; created_at: string };

export default function KnowledgePage() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const { busy, run } = useMutation();
  const toast = useToast();

  async function load() {
    setLoading(true);
    try {
      setDocs(await api<Doc[]>("/ai/knowledge"));
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

  async function upload() {
    if (!title.trim() || !content.trim()) return;
    const ok = await run(
      () =>
        api("/ai/knowledge", {
          method: "POST",
          body: JSON.stringify({ title, content })
        }),
      { success: "دانش ذخیره و بردارسازی شد" }
    );
    if (ok) {
      setTitle("");
      setContent("");
      await load();
    }
  }

  return (
    <Shell title="پایگاه دانش AI" sub="منبع پاسخ‌های برداری‌شده فارسی">
      <Card title="آپلود دانش">
        <div className="form-grid">
          <label className="full">
            عنوان
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="full">
            متن دانش
            <textarea rows={8} value={content} onChange={(e) => setContent(e.target.value)} />
          </label>
          <Button loading={busy} onClick={upload}>
            آپلود و ایندکس
          </Button>
        </div>
      </Card>

      <Card title="اسناد">
        {loading ? (
          <PageLoading />
        ) : docs.length === 0 ? (
          <EmptyState title="سندی نیست" text="FAQ یا قیمت‌ها را آپلود کنید." />
        ) : (
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
        )}
      </Card>
    </Shell>
  );
}
