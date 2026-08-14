"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "./Button";

type ModalProps = {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  headerActions?: ReactNode;
  panelClassName?: string;
};

function focusables(root: HTMLElement) {
  return root.querySelectorAll<HTMLElement>(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  );
}

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  headerActions,
  panelClassName = ""
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const lastFocus = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    lastFocus.current = document.activeElement as HTMLElement | null;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const root = panelRef.current;
      if (!root) return;
      const nodes = focusables(root);
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Prefer a form field over the header close button
    const t = window.setTimeout(() => {
      const root = panelRef.current;
      if (!root) return;
      const preferred =
        root.querySelector<HTMLElement>(
          'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled])'
        ) ||
        root.querySelector<HTMLElement>(
          'button:not([disabled]):not([aria-label="بستن"]), [href], [tabindex]:not([tabindex="-1"])'
        );
      preferred?.focus();
    }, 30);

    return () => {
      window.clearTimeout(t);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      lastFocus.current?.focus?.();
    };
    // Only when open toggles — do not re-run on every parent render / onClose identity change
  }, [open]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={() => onCloseRef.current()} role="presentation">
      <div
        ref={panelRef}
        className={`modal-panel ${panelClassName}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? "modal-title" : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          {title ? <h2 id="modal-title">{title}</h2> : <div className="modal-header-spacer" />}
          <div className="modal-header-actions">
            {headerActions}
            <Button variant="ghost" size="sm" onClick={() => onCloseRef.current()} aria-label="بستن">
              ×
            </Button>
          </div>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-footer">{footer}</div> : null}
      </div>
    </div>
  );
}
