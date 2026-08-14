"use client";

import { useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { Button } from "@/components/ui/Button";
import { Badge, Card, EmptyState } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { PageLoading } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import { useMutation } from "@/lib/useApi";
import { useToast } from "@/components/ui/Toast";

type Doc = {
  id: string;
  title: string;
  source: string;
  created_at: string;
  chunk_count?: number;
};

type ChunkInfo = {
  id: string;
  content: string;
  char_count: number;
  local_embedding_dim: number;
  local_embedding_preview: number[];
  in_pinecone: boolean;
  pinecone_vector_dim?: number | null;
  pinecone_vector_preview?: number[];
  pinecone_text_preview?: string;
};

type DocDetail = {
  id: string;
  title: string;
  source: string;
  created_at: string;
  content: string;
  chunk_count: number;
  pinecone_configured: boolean;
  pinecone_indexed_count: number;
  chunks: ChunkInfo[];
};

export default function KnowledgePage() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DocDetail | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
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

  async function openDoc(doc: Doc) {
    setActiveId(doc.id);
    setDetail(null);
    setDetailLoading(true);
    try {
      const d = await api<DocDetail>(`/ai/knowledge/${doc.id}`);
      setDetail(d);
      setEditTitle(d.title || "");
      setEditContent(d.content || "");
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "خطا در بارگذاری سند", "err");
      setActiveId(null);
    } finally {
      setDetailLoading(false);
    }
  }

  function closeModal() {
    setActiveId(null);
    setDetail(null);
    setEditTitle("");
    setEditContent("");
  }

  async function saveEdit() {
    if (!activeId || !editTitle.trim() || !editContent.trim()) return;
    setSaving(true);
    try {
      const res = await api<{ ok: boolean; pinecone?: boolean; doc: DocDetail }>(
        `/ai/knowledge/${activeId}`,
        {
          method: "PUT",
          body: JSON.stringify({ title: editTitle.trim(), content: editContent.trim() })
        }
      );
      setDetail(res.doc);
      setEditTitle(res.doc.title || "");
      setEditContent(res.doc.content || "");
      toast.push(
        res.pinecone ? "ذخیره و ایندکس مجدد در Pinecone انجام شد" : "ذخیره شد (ایندکس Pinecone در صف)",
        "ok"
      );
      await load();
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "خطا در ذخیره", "err");
    } finally {
      setSaving(false);
    }
  }

  async function upload() {
    if (!title.trim() || !content.trim()) return;
    const ok = await run(
      () =>
        api("/ai/knowledge", {
          method: "POST",
          body: JSON.stringify({ title, content })
        }),
      { success: "دانش ذخیره و ایندکس شد" }
    );
    if (ok) {
      setTitle("");
      setContent("");
      await load();
    }
  }

  async function removeDoc(doc: Doc, e?: { stopPropagation?: () => void }) {
    e?.stopPropagation?.();
    if (!window.confirm(`حذف «${doc.title}»؟ از Pinecone هم پاک می‌شود.`)) return;
    setDeletingId(doc.id);
    try {
      await api(`/ai/knowledge/${doc.id}`, { method: "DELETE" });
      toast.push("سند حذف شد", "ok");
      if (activeId === doc.id) closeModal();
      await load();
    } catch (err) {
      toast.push(err instanceof Error ? err.message : "خطا در حذف", "err");
    } finally {
      setDeletingId(null);
    }
  }

  const dirty =
    !!detail &&
    (editTitle.trim() !== (detail.title || "").trim() ||
      editContent.trim() !== (detail.content || "").trim());

  return (
    <Shell title="پایگاه دانش AI" sub="منبع پاسخ‌های برداری‌شده (Pinecone)">
      {loading ? (
        <PageLoading />
      ) : (
        <>
          <Card
            title="ثبت دانش جدید"
            help={{
              title: "ثبت دانش جدید",
              body: "متن FAQ، قیمت و قوانین کسب‌وکارتان را اینجا بگذارید تا دستیار فقط بر اساس همین منبع جواب بدهد.",
              tips: [
                "هر سند در Pinecone ایندکس می‌شود و در پیشنهاد/پاسخ خودکار استفاده می‌گردد."
              ]
            }}
          >
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

          <Card
            title="پایگاه دانش"
            help={{
              title: "پایگاه دانش",
              body: "روی هر ردیف کلیک کنید تا متن را ببینید و ویرایش کنید. بعد از ذخیره، تکه‌ها دوباره در Pinecone ایندکس می‌شوند."
            }}
          >
            {docs.length === 0 ? (
              <EmptyState title="سندی نیست" text="FAQ یا قیمت‌ها را آپلود کنید." />
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>عنوان</th>
                    <th>منبع</th>
                    <th>تکه‌ها</th>
                    <th>تاریخ</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {docs.map((d) => (
                    <tr
                      key={d.id}
                      className="kb-row"
                      role="button"
                      tabIndex={0}
                      onClick={() => void openDoc(d)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          void openDoc(d);
                        }
                      }}
                    >
                      <td>
                        <strong>{d.title}</strong>
                      </td>
                      <td>{d.source}</td>
                      <td>{(d.chunk_count ?? 0).toLocaleString("fa-IR")}</td>
                      <td>{new Date(d.created_at).toLocaleString("fa-IR")}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <Button
                          variant="danger"
                          size="sm"
                          loading={deletingId === d.id}
                          disabled={!!deletingId}
                          onClick={(e) => void removeDoc(d, e)}
                        >
                          حذف
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Modal
            open={!!activeId}
            title={detail?.title || "سند دانش"}
            onClose={closeModal}
            panelClassName="kb-doc-modal"
            footer={
              <>
                <Button variant="secondary" onClick={closeModal} disabled={saving}>
                  بستن
                </Button>
                <Button
                  loading={saving}
                  disabled={!dirty || !editTitle.trim() || !editContent.trim()}
                  onClick={() => void saveEdit()}
                >
                  ذخیره و ایندکس مجدد
                </Button>
              </>
            }
          >
            {detailLoading || !detail ? (
              <PageLoading variant="compact" label="بارگذاری سند…" />
            ) : (
              <div className="kb-doc-body">
                <div className="kb-doc-meta">
                  <Badge tone="accent">{detail.source || "upload"}</Badge>
                  <span className="hint">
                    {detail.chunk_count.toLocaleString("fa-IR")} تکه
                    {detail.pinecone_configured
                      ? ` · Pinecone: ${detail.pinecone_indexed_count.toLocaleString("fa-IR")} / ${detail.chunk_count.toLocaleString("fa-IR")}`
                      : " · Pinecone تنظیم نشده"}
                  </span>
                </div>

                <label>
                  عنوان
                  <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
                </label>
                <label>
                  متن دانش
                  <textarea
                    rows={10}
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                  />
                </label>

                <div className="kb-chunks">
                  <h4>تکه‌های ایندکس‌شده</h4>
                  <p className="hint">
                    هر تکه یک رکورد برداری است. متن ذخیره‌شده در SQLite و وضعیت Pinecone اینجاست.
                    خودِ بردار خام مدل hosted معمولاً در کنسول Pinecone دیده می‌شود؛ اینجا پیش‌نمایش
                    (در صورت موجود بودن) و وضعیت ایندکس نمایش داده می‌شود.
                  </p>
                  {detail.chunks.length === 0 ? (
                    <EmptyState title="تکه‌ای نیست" text="بعد از ذخیره، متن به تکه‌ها تقسیم می‌شود." />
                  ) : (
                    detail.chunks.map((c, i) => (
                      <div key={c.id} className="kb-chunk">
                        <div className="kb-chunk-head">
                          <strong>تکه {(i + 1).toLocaleString("fa-IR")}</strong>
                          <Badge tone={c.in_pinecone ? "online" : "offline"}>
                            {c.in_pinecone ? "در Pinecone" : "فقط محلی"}
                          </Badge>
                          <span className="hint" dir="ltr">
                            {c.char_count} chars · id {c.id.slice(0, 8)}…
                          </span>
                        </div>
                        <pre className="kb-chunk-text">{c.content}</pre>
                        <div className="kb-chunk-vec">
                          {c.in_pinecone ? (
                            <span>
                              Pinecone
                              {c.pinecone_vector_dim
                                ? ` · dim ${c.pinecone_vector_dim}`
                                : " · ایندکس‌شده (بردار hosted)"}
                              {c.pinecone_vector_preview && c.pinecone_vector_preview.length > 0
                                ? ` · preview [${c.pinecone_vector_preview
                                    .map((n) => n.toFixed(3))
                                    .join(", ")}…]`
                                : ""}
                            </span>
                          ) : (
                            <span>
                              بردار محلی (fallback)
                              {c.local_embedding_dim
                                ? ` · dim ${c.local_embedding_dim}`
                                : ""}
                              {c.local_embedding_preview?.length
                                ? ` · [${c.local_embedding_preview.join(", ")}…]`
                                : ""}
                            </span>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </Modal>
        </>
      )}
    </Shell>
  );
}
