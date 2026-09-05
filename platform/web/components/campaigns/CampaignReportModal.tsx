"use client";

import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Card";
import { tagLabel } from "@/components/crm/shared";
import { PageLoading } from "@/components/ui/Spinner";
import type { CampaignReport } from "@/lib/api";

type Props = {
  open: boolean;
  onClose: () => void;
  report: CampaignReport | null;
  loading: boolean;
};

function pct(n: number, d: number) {
  if (!d) return 0;
  return Math.round((n / d) * 100);
}

function formatMinutes(m: number | null | undefined) {
  if (m == null) return "—";
  if (m < 60) return `${Math.round(m)} دقیقه`;
  if (m < 60 * 24) return `${(m / 60).toFixed(1)} ساعت`;
  return `${(m / (60 * 24)).toFixed(1)} روز`;
}

function formatDate(s?: string | null) {
  if (!s) return "—";
  try {
    const d = new Date(s);
    return d.toLocaleString("fa-IR", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch {
    return s;
  }
}

const TIMELINE_BAR_MAX = 28;

export function CampaignReportModal({ open, onClose, report, loading }: Props) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="گزارش کمپین"
      presentation="full"
      panelClassName="camp-report-modal"
    >
      {loading ? (
        <div style={{ padding: 32 }}>
          <PageLoading />
        </div>
      ) : !report ? (
        <div className="camp-empty" style={{ padding: 40, textAlign: "center" }}>
          گزارشی برای این کمپین یافت نشد.
        </div>
      ) : (
<div className="camp-report">
          <div className="camp-report-header">
            <div>
              <div className="camp-report-name">{report.campaign.name}</div>
              <div className="camp-report-sub">
                کانال: {report.campaign.channel_label || "—"} · وضعیت:{" "}
                <Badge tone={report.campaign.status === "done" ? "success" : "accent"}>
                  {report.campaign.status}
                </Badge>
              </div>
            </div>
            <div className="camp-report-times">
              <span>شروع: {formatDate(report.campaign.started_at)}</span>
              <span>پایان: {formatDate(report.campaign.finished_at)}</span>
            </div>
          </div>
          <div className="camp-report-kpis">
            <div className="camp-kpi">
              <div className="camp-kpi-label">ارسال / تحویل</div>
              <div className="camp-kpi-value">
                {report.summary.sends_sent}
                <span className="camp-kpi-sub">/ {report.summary.sends_total}</span>
              </div>
              <div className="camp-kpi-meta">نرخ تحویل {pct(report.summary.sends_sent, report.summary.sends_total)}٪</div>
            </div>
            <div className="camp-kpi">
              <div className="camp-kpi-label">پاسخ</div>
              <div className="camp-kpi-value">
                {report.summary.replied_count}
                <span className="camp-kpi-sub">/ {report.summary.sends_sent}</span>
              </div>
              <div className="camp-kpi-meta">نرخ پاسخ {report.summary.reply_rate}٪</div>
            </div>
            <div className="camp-kpi">
              <div className="camp-kpi-label">تبدیل</div>
              <div className="camp-kpi-value">
                {report.summary.conversions}
                <span className="camp-kpi-sub">سرنخ</span>
              </div>
              <div className="camp-kpi-meta">نرخ تبدیل {report.summary.conversion_rate}٪</div>
            </div>
            <div className="camp-kpi">
              <div className="camp-kpi-label">میانگین پاسخ</div>
              <div className="camp-kpi-value">{formatMinutes(report.summary.avg_response_minutes)}</div>
              <div className="camp-kpi-meta">
                AI: {report.summary.automated_replied} · انسانی: {report.summary.human_replied}
              </div>
            </div>
          </div>
          <div className="camp-report-section">
            <div className="camp-section-title">وضعیت ارسال‌ها</div>
            <div className="camp-status-row">
              {([["sent", "ارسال‌شده", report.by_status.sent, "success"], ["failed", "ناموفق", report.by_status.failed, "danger"], ["queued", "در صف", report.by_status.queued, "accent"], ["pending", "در انتظار", report.by_status.pending, "default"], ["skipped", "ردشده", report.by_status.skipped, "default"]] as const).map(([k, label, n, tone]) => (
                <div key={k} className="camp-status-pill">
                  <span className={`camp-status-dot ${tone}`} />
                  <span className="camp-status-label">{label}</span>
                  <span className="camp-status-n">{n}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="camp-report-section">
            <div className="camp-section-title">پاسخ‌گویی: AI در مقابل انسان</div>
            {(() => {
              const total = report.summary.automated_replied + report.summary.human_replied;
              const aip = total ? pct(report.summary.automated_replied, total) : 0;
              return (
                <>
                  <div className="camp-ai-bar">
                    <div className="camp-ai-fill ai" style={{ width: `${aip}%` }} title={`AI: ${report.summary.automated_replied}`}>{aip >= 12 ? `AI ${aip}٪` : ""}</div>
                    <div className="camp-ai-fill human" style={{ width: `${100 - aip}%` }} title={`انسانی: ${report.summary.human_replied}`}>{100 - aip >= 12 ? `انسانی ${100 - aip}٪` : ""}</div>
                  </div>
                  <div className="camp-ai-meta">
                    رویداد پاسخ خودکار: {report.ai_engagement.auto_reply_events} · سرنخ پاسخ‌داده‌شده توسط AI: {report.ai_engagement.leads_ai_replied} · توسط انسان: {report.ai_engagement.leads_human_replied}
                  </div>
                </>
              );
            })()}
          </div>
<div className="camp-report-section">
            <div className="camp-section-title">قیف مراحل (Funnel)</div>
            {(() => {
              const max = Math.max(1, ...report.funnel.map((f) => f.count));
              return (
                <div className="camp-funnel">
                  {report.funnel.map((f) => (
                    <div key={f.stage} className="camp-funnel-row">
                      <div className="camp-funnel-stage">{f.stage}</div>
                      <div className="camp-funnel-bar"><div className="camp-funnel-fill" style={{ width: `${(f.count / max) * 100}%` }} /></div>
                      <div className="camp-funnel-n">{f.count}</div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
          <div className="camp-report-section">
            <div className="camp-section-title">روند ۱۴ روز اخیر</div>
            {(() => {
              const tl = report.timeline || [];
              const max = Math.max(1, ...tl.map((d) => Math.max(d.sent, d.replied, d.converted)));
              return (
                <div className="camp-timeline">
                  {tl.length === 0 ? <div className="camp-empty">داده‌ای برای نمایش نیست</div> : (
                    <div className="camp-timeline-grid">
                      {tl.map((d) => (
                        <div key={d.date} className="camp-timeline-col" title={d.date}>
                          <div className="camp-timeline-bars">
                            <div className="camp-timeline-bar sent" style={{ height: `${(d.sent / max) * TIMELINE_BAR_MAX}px` }} />
                            <div className="camp-timeline-bar replied" style={{ height: `${(d.replied / max) * TIMELINE_BAR_MAX}px` }} />
                            <div className="camp-timeline-bar converted" style={{ height: `${(d.converted / max) * TIMELINE_BAR_MAX}px` }} />
                          </div>
                          <div className="camp-timeline-date">{d.date.slice(5)}</div>
                          <div className="camp-timeline-n">{d.sent}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="camp-timeline-legend">
                    <span className="dot sent" /> ارسال <span className="dot replied" /> پاسخ <span className="dot converted" /> تبدیل
                  </div>
                </div>
              );
            })()}
          </div>
          <div className="camp-report-section">
            <div className="camp-section-title">برترین سرنخ‌ها ({report.top_leads.length})</div>
            {report.top_leads.length === 0 ? <div className="camp-empty">سرنخی برای نمایش نیست</div> : (
              <div className="camp-table-wrap">
                <table className="camp-table">
                  <thead><tr><th>نام</th><th>تلفن</th><th>مرحله</th><th>امتیاز</th><th>وضعیت</th><th>پاسخ</th><th>AI</th><th>تبدیل</th><th>زمان</th></tr></thead>
                  <tbody>
                    {report.top_leads.map((l) => (
                      <tr key={l.lead_id}>
                        <td><div className="camp-lead-name">{l.name || "—"}</div><div className="camp-lead-tags">{(l.tags || []).slice(0, 3).map((t) => <span key={t} className="camp-mini-chip">{tagLabel(t)}</span>)}</div></td>
                        <td className="camp-mono" dir="ltr">{l.phone || "—"}</td>
                        <td>{l.stage || "—"}</td>
                        <td>{l.lead_score}</td>
                        <td><Badge tone={l.send_status === "sent" ? "success" : l.send_status === "failed" ? "danger" : "default"}>{l.send_status}</Badge></td>
                        <td>{l.replied ? "✓" : "—"}</td>
                        <td>{l.ai_replied ? "✓" : "—"}</td>
                        <td>{l.is_conversion ? <Badge tone="success">تبدیل</Badge> : "—"}</td>
                        <td>{formatMinutes(l.response_minutes)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}