"use client";

export function Badge({
  children,
  tone = "default"
}: {
  children: React.ReactNode;
  tone?: "default" | "accent" | "success" | "danger" | "online" | "offline";
}) {
  const cls =
    tone === "default" ? "" : tone;
  return <span className={`badge ${cls}`.trim()}>{children}</span>;
}

export function EmptyState({
  title,
  text,
  action
}: {
  title: string;
  text?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      {text && <p className="hint" style={{ margin: "0 0 14px" }}>{text}</p>}
      {action}
    </div>
  );
}

export function Card({
  children,
  title,
  actions,
  flat = false,
  className = ""
}: {
  children: React.ReactNode;
  title?: string;
  actions?: React.ReactNode;
  flat?: boolean;
  className?: string;
}) {
  return (
    <div className={`card ${flat ? "flat" : ""} ${className}`.trim()}>
      {(title || actions) && (
        <div className="card-head">
          {title ? <h3>{title}</h3> : <span />}
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}
