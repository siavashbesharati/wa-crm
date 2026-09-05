"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "./Button";
import { IconClose } from "./Icons";

type ModalProps = {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  headerActions?: ReactNode;
  panelClassName?: string;
  /** sheet = bottom sheet on mobile; full = nearly full-screen sheet; dialog = centered always */
  presentation?: "auto" | "sheet" | "full" | "dialog";
};

function focusables(root: HTMLElement) {
  return root.querySelectorAll<HTMLElement>(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  );
}

function useIsNarrow(breakpoint = 768) {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const apply = () => setNarrow(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [breakpoint]);
  return narrow;
}

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  headerActions,
  panelClassName = "",
  presentation = "auto"
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const lastFocus = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const narrow = useIsNarrow();
  const dragY = useRef(0);
  const dragging = useRef(false);
  const startY = useRef(0);

  const asSheet =
    presentation === "sheet" ||
    presentation === "full" ||
    (presentation === "auto" && narrow);

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
  }, [open]);

  function onPointerDown(e: React.PointerEvent) {
    if (!asSheet) return;
    const target = e.target as HTMLElement;
    if (!target.closest(".sheet-grab")) return;
    dragging.current = true;
    startY.current = e.clientY;
    dragY.current = 0;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!dragging.current || !panelRef.current) return;
    const dy = Math.max(0, e.clientY - startY.current);
    dragY.current = dy;
    panelRef.current.style.transform = `translateY(${dy}px)`;
    panelRef.current.style.transition = "none";
  }

  function onPointerUp() {
    if (!dragging.current || !panelRef.current) return;
    dragging.current = false;
    panelRef.current.style.transition = "";
    if (dragY.current > 120) {
      panelRef.current.style.transform = "";
      onCloseRef.current();
    } else {
      panelRef.current.style.transform = "";
    }
    dragY.current = 0;
  }

  if (!open) return null;

  const modeClass =
    presentation === "full"
      ? "sheet-full"
      : asSheet
        ? "sheet-panel"
        : "dialog-panel";

  return (
    <div
      className={`modal-backdrop${asSheet ? " sheet-backdrop" : ""}`}
      onClick={() => onCloseRef.current()}
      role="presentation"
    >
      <div
        ref={panelRef}
        className={`modal-panel ${modeClass} ${panelClassName}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? "modal-title" : undefined}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {asSheet ? <div className="sheet-handle sheet-grab" aria-hidden /> : null}
        <div className={`modal-header${asSheet ? " sheet-grab" : ""}`}>
          {title ? <h2 id="modal-title">{title}</h2> : <div className="modal-header-spacer" />}
          <div className="modal-header-actions">
            {headerActions}
            <Button
              variant="ghost"
              size="sm"
              className="modal-close-btn"
              onClick={() => onCloseRef.current()}
              aria-label="بستن"
            >
              <IconClose size={18} />
            </Button>
          </div>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-footer">{footer}</div> : null}
      </div>
    </div>
  );
}
