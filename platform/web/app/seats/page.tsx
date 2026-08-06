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

  async function createSeat() {
    setBusy(true);
    try {
      const seat = await api<Seat>("/seats", {
        method: "POST",
        body: JSON.stringify({ label: label.trim() })
      });
      if (seat.token) {
        try {
          await navigator.clipboard.writeText(seat.token);
          toast.push("توکن ساخته و کپی شد", "ok");
        } catch {
          toast.push("توکن ساخته شد", "ok");
        }
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
    if (!confirm("قفل این توکن برداشته شود تا روی نصب دیگری قابل استفاده باشد؟")) return;
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
    if (!confirm("این توکن برای همیشه لغو شود؟")) return;
    setBusy(true);
    try {
      await api(`/seats/${id}`, { method: "DELETE" });
      toast.push("توکن حذف شد", "ok");
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
      sub="هر نصب Chrome یک توکن یکتا — سقف هم‌زمانی بر اساس پلن"
    >
      {loading || !data ? (
        <PageLoading />
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          <Card title="ظرفیت پلن">
            <p style={{ margin: 0 }}>
              استفاده: <strong>{data.used}</strong> از <strong>{data.max_seats}</strong>
              {" · "}
              قفل‌شده: <strong>{data.locked}</strong>
              {" · "}
              آزاد: <strong>{data.available}</strong>
            </p>
            <p className="hint" style={{ marginTop: 8 }}>
              کانال‌ها (واتساپ، دیوار، …) در همه پلن‌ها آزادند. محدودیت فقط تعداد افزونه‌های
              هم‌زمان است.
            </p>
          </Card>

          <Card title="ساخت توکن جدید">
            <div className="form-grid">
              <label>
                برچسب (مثلاً لپ‌تاپ فروش)
                <input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="اختیاری"
                />
              </label>
            </div>
            <div style={{ marginTop: 12 }}>
              <Button
                loading={busy}
                disabled={data.used >= data.max_seats}
                onClick={createSeat}
              >
                افزودن صندلی / توکن
              </Button>
            </div>
          </Card>

          <Card title="توکن‌ها">
            {!data.seats.length ? (
              <EmptyState
                title="هنوز صندلی نیست"
                text="یک توکن بسازید و در پاپ‌آپ افزونه وارد کنید."
              />
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>برچسب</th>
                    <th>توکن</th>
                    <th>وضعیت</th>
                    <th>نصب</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {data.seats.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <strong>{s.label || "—"}</strong>
                      </td>
                      <td>
                        {s.token ? (
                          <div style={{ display: "grid", gap: 6 }}>
                            <code style={{ wordBreak: "break-all", fontSize: 12 }}>{s.token}</code>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={async () => {
                                await navigator.clipboard.writeText(s.token!);
                                toast.push("کپی شد", "ok");
                              }}
                            >
                              کپی
                            </Button>
                          </div>
                        ) : (
                          <code>{s.token_prefix}…</code>
                        )}
                      </td>
                      <td>
                        <Badge
                          tone={
                            s.status === "locked"
                              ? "accent"
                              : s.status === "available"
                                ? "success"
                                : "danger"
                          }
                        >
                          {s.status === "locked"
                            ? "قفل‌شده"
                            : s.status === "available"
                              ? "آزاد"
                              : s.status}
                        </Badge>
                      </td>
                      <td className="hint">
                        {s.bound_install_id
                          ? s.bound_install_id.slice(0, 8) + "…"
                          : "—"}
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          {s.status === "locked" ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              loading={busy}
                              onClick={() => resetSeat(s.id)}
                            >
                              ریست قفل
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
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>
      )}
    </Shell>
  );
}
