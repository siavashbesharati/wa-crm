"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode
} from "react";

export function Badge({
  children,
  tone = "default"
}: {
  children: ReactNode;
  tone?: "default" | "accent" | "success" | "danger" | "online" | "offline";
}) {
  const cls = tone === "default" ? "" : tone;
  return <span className={`badge ${cls}`.trim()}>{children}</span>;
}

export function EmptyState({
  title,
  text,
  action
}: {
  title: string;
  text?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      {text && <p className="hint" style={{ margin: "0 0 14px" }}>{text}</p>}
      {action}
    </div>
  );
}

export type HelpContent = {
  title?: string;
  body: string;
  tips?: string[];
};

export function HelpTip({
  help,
  className = ""
}: {
  help: string | HelpContent;
  className?: string;
}) {
  const content: HelpContent =
    typeof help === "string" ? { body: help } : help;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const tipId = useId();

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) close();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  return (
    <div className={`help-tip ${className}`.trim()} ref={rootRef}>
      <button
        type="button"
        className={`help-tip-btn${open ? " open" : ""}`}
        aria-label="راهنما"
        aria-expanded={open}
        aria-controls={tipId}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        ؟
      </button>
      {open && (
        <div className="help-tip-pop" id={tipId} role="dialog" aria-label="توضیح">
          <div className="help-tip-pop-glow" aria-hidden />
          {content.title ? <strong className="help-tip-pop-title">{content.title}</strong> : null}
          <p className="help-tip-pop-body">{content.body}</p>
          {content.tips && content.tips.length > 0 ? (
            <ul className="help-tip-pop-tips">
              {content.tips.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </div>
  );
}

export function Card({
  children,
  title,
  actions,
  help,
  flat = false,
  className = ""
}: {
  children: ReactNode;
  title?: string;
  actions?: ReactNode;
  help?: string | HelpContent;
  flat?: boolean;
  className?: string;
}) {
  const showHead = !!(title || actions || help);
  return (
    <div className={`card ${flat ? "flat" : ""} ${className}`.trim()}>
      {showHead && (
        <div className="card-head">
          <div className="card-head-title">
            {title ? <h3>{title}</h3> : <span />}
            {help ? <HelpTip help={help} /> : null}
          </div>
          {actions ? <div className="card-head-actions">{actions}</div> : null}
        </div>
      )}
      {children}
    </div>
  );
}
