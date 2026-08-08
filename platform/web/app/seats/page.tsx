"use client";

import { useCallback, useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { Button } from "@/components/ui/Button";
import { Badge, Card, EmptyState } from "@/components/ui/Card";
import { PageLoading } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";

type Seat = {
  id: string;
  label: string;
  token_prefix: string;
  token?: string;
  status: string;
  bound_install_id: string;
  bound_at: string | null;
  last_seen_at: string | null;
};

type SeatsResponse = {
  max_seats: number;
  used: number;
  locked: number;
  available: number;
  seats: Seat[];
};

function statusLabel(status: string) {
  if (status === "locked") return "در حال استفاده";
  if (status === "available") return "آماده اتصال";
  return status;
}

function statusTone(status: string): "accent" | "success" | "danger" {
  if (status === "locked") return "accent";
  if (status === "available") return "success";
  return "danger";
}

export default function SeatsPage() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<SeatsResponse | null>(null);
  const [label, setLabel] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api<SeatsResponse>("/seats"));
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "خطا", "err");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  async function copyToken(token: string) {
    try {
      await navigator.clipboard.writeText(token);
      toast.push("توکن کپی شد — در پنل کناری افزونه بچسبانید", "ok");
    } catch {
      toast.push("کپی نشد؛ دستی انتخاب کنید", "err");
    }
  }

  async function createSeat() {
    setBusy(true);
    try {
      const seat = await api<Seat>("/seats", {
        method: "POST",
        body: JSON.stringify({ label: label.trim() })
      });
      if (seat.token) {
        await copyToken(seat.token);
      } else {
        toast.push("صندلی افزوده شد", "ok");
      }
      setLabel("");
      await load();
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "خطا", "err");
    } finally {
      setBusy(false);
    }
  }

  async function resetSeat(id: string) {
    if (!confirm("این صندلی آزاد شود تا روی Chrome دیگری وصل شود؟")) return;
    setBusy(true);
    try {
      await api(`/seats/${id}/reset`, { method: "POST" });
      toast.push("صندلی آزاد شد", "ok");
      await load();
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "خطا", "err");
    } finally {
      setBusy(false);
    }
  }

  async function revokeSeat(id: string) {
    if (!confirm("این توکن حذف شود؟ دیگر قابل استفاده نیست.")) return;
    setBusy(true);
    try {
      await api(`/seats/${id}`, { method: "DELETE" });
      toast.push("حذف شد", "ok");
      await load();
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "خطا", "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell
      title="صندلی‌های افزونه"
      sub="هر کامپیوتر/Chrome یک توکن — کپی کنید و در پنل کناری واتساپ یا دیوار وصل شوید"
    >
      {loading || !data ? (
        <PageLoading />
      ) : (
        <div className="seats-page">
          <Card
            title="چطور کار می‌کند؟"
            help={{
              title: "صندلی افزونه",
              body: "هر نصب Chrome برای اتصال به واتساپ/دیوار به یک توکن یکتا نیاز دارد. این توکن همان «صندلی» است.",
              tips: ["هر دستگاه/مرورگر یک صندلی جداگانه."]
            }}
          >
            <ol className="seats-howto">
              <li>یک صندلی بسازید و توکن را کپی کنید.</li>
              <li>در Chrome افزونه را باز کنید → تب واتساپ یا دیوار.</li>
              <li>در پنل کناری توکن را بچسبانید و «اتصال» بزنید.</li>
            </ol>
            <p className="hint" style={{ marginTop: 10, marginBottom: 0 }}>
              ظرفیت پلن شما: <strong>{data.used}</strong> از <strong>{data.max_seats}</strong>
              {" · "}
              آماده: <strong>{data.available}</strong>
              {" · "}
              در حال استفاده: <strong>{data.locked}</strong>
            </p>
          </Card>

          <Card
            title="صندلی جدید"
            help={{
              title: "ساخت صندلی",
              body: "توکن جدید می‌سازد و در حافظه کپی می‌کند تا در افزونه Paste کنید. سقف تعداد از پلن می‌آید."
            }}
          >
            <div className="seats-create">
              <label>
                نام (مثلاً لپ‌تاپ فروش یا املاک)
                <input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="اختیاری"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") createSeat();
                  }}
                />
              </label>
              <Button
                loading={busy}
                disabled={data.used >= data.max_seats}
                onClick={createSeat}
              >
                ساخت و کپی توکن
              </Button>
            </div>
            {data.used >= data.max_seats ? (
              <p className="hint" style={{ marginTop: 10, marginBottom: 0, color: "var(--danger)" }}>
                سقف پلن پر است.
              </p>
            ) : null}
          </Card>

          <Card
            title="صندلی‌های شما"
            help={{
              title: "مدیریت صندلی‌ها",
              body: "وضعیت هر صندلی (آزاد / در حال استفاده) و امکان کپی دوباره یا باطل کردن توکن."
            }}
          >
            {!data.seats.length ? (
              <EmptyState
                title="هنوز صندلی ندارید"
                text="با دکمه بالا یک توکن بسازید."
              />
            ) : (
              <div className="seats-list">
                {data.seats.map((s) => {
                  const token = s.token || "";
                  return (
                    <article key={s.id} className="seat-item">
                      <div className="seat-item-top">
                        <div>
                          <strong className="seat-item-title">{s.label || "بدون نام"}</strong>
                          <div className="seat-item-meta">
                            <Badge tone={statusTone(s.status)}>{statusLabel(s.status)}</Badge>
                            <span className="hint">
                              {s.status === "locked" && s.bound_install_id
                                ? "وصل به یک Chrome"
                                : "هنوز به افزونه وصل نشده"}
                            </span>
                          </div>
                        </div>
                        <div className="seat-item-actions">
                          {s.status === "locked" ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              loading={busy}
                              onClick={() => resetSeat(s.id)}
                            >
                              آزاد کردن
                            </Button>
                          ) : null}
                          <Button
                            size="sm"
                            variant="danger"
                            loading={busy}
                            onClick={() => revokeSeat(s.id)}
                          >
                            حذف
                          </Button>
                        </div>
                      </div>

                      {token ? (
                        <div className="seat-token-row">
                          <code className="seat-token-value" title={token}>
                            {token}
                          </code>
                          <Button size="sm" onClick={() => copyToken(token)}>
                            کپی توکن
                          </Button>
                        </div>
                      ) : (
                        <p className="hint" style={{ margin: "10px 0 0" }}>
                          توکن کامل در دسترس نیست — یک صندلی جدید بسازید.
                        </p>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </Card>
        </div>
      )}
    </Shell>
  );
}
