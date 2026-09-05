"use client";

import Link from "next/link";
import { useEffect, useRef, type ReactNode } from "react";

export type ActionSheetItem = {
  id: string;
  label: string;
  tone?: "default" | "danger" | "accent";
  disabled?: boolean;
  href?: string;
  onSelect?: () => void;
};

type Props = {
  open: boolean;
  title?: string;
  onClose: () => void;
  items: ActionSheetItem[];
  cancelLabel?: string;
};

export function ActionSheet({
  open,
  title,
  onClose,
  items,
  cancelLabel = "انصراف"
}: Props) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="action-sheet-backdrop"
      role="presentation"
      onClick={() => onCloseRef.current()}
    >
      <div
        className="action-sheet"
        role="menu"
        aria-label={title || "عملیات"}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-handle" aria-hidden />
        {title ? <div className="action-sheet-title">{title}</div> : null}
        <div className="action-sheet-group">
          {items.map((item) => {
            const cls = `action-sheet-item${item.tone === "danger" ? " danger" : ""}${item.tone === "accent" ? " accent" : ""}`;
            if (item.href) {
              return (
                <Link
                  key={item.id}
                  href={item.href}
                  role="menuitem"
                  className={cls}
                  aria-disabled={item.disabled || undefined}
                  onClick={(e) => {
                    if (item.disabled) {
                      e.preventDefault();
                      return;
                    }
                    item.onSelect?.();
                    onCloseRef.current();
                  }}
                >
                  {item.label}
                </Link>
              );
            }
            return (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                className={cls}
                disabled={item.disabled}
                onClick={() => {
                  item.onSelect?.();
                  onCloseRef.current();
                }}
              >
                {item.label}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          className="action-sheet-item action-sheet-cancel"
          onClick={() => onCloseRef.current()}
        >
          {cancelLabel}
        </button>
      </div>
    </div>
  );
}

export function ActionSheetSlot({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}
