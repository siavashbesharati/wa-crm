"use client";

import Link from "next/link";
import type { ReactNode } from "react";

export function List({
  children,
  inset = true,
  className = ""
}: {
  children: ReactNode;
  inset?: boolean;
  className?: string;
}) {
  return (
    <div className={`ui-list${inset ? " inset" : ""} ${className}`.trim()} role="list">
      {children}
    </div>
  );
}

export function ListItem({
  title,
  subtitle,
  meta,
  leading,
  trailing,
  href,
  onClick,
  destructive = false,
  className = ""
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  meta?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  href?: string;
  onClick?: () => void;
  destructive?: boolean;
  className?: string;
}) {
  const body = (
    <>
      {leading ? <span className="ui-list-leading">{leading}</span> : null}
      <span className="ui-list-copy">
        <span className={`ui-list-title${destructive ? " danger" : ""}`}>{title}</span>
        {subtitle ? <span className="ui-list-sub">{subtitle}</span> : null}
      </span>
      {meta ? <span className="ui-list-meta">{meta}</span> : null}
      {trailing ? <span className="ui-list-trailing">{trailing}</span> : null}
    </>
  );

  if (href) {
    return (
      <Link href={href} className={`ui-list-item ${className}`.trim()} role="listitem" onClick={onClick}>
        {body}
      </Link>
    );
  }

  if (onClick) {
    return (
      <button
        type="button"
        className={`ui-list-item ${className}`.trim()}
        role="listitem"
        onClick={onClick}
      >
        {body}
      </button>
    );
  }

  return (
    <div className={`ui-list-item static ${className}`.trim()} role="listitem">
      {body}
    </div>
  );
}

export function ListSection({
  title,
  children,
  className = ""
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`ui-list-section ${className}`.trim()}>
      {title ? <h3 className="ui-list-section-title">{title}</h3> : null}
      {children}
    </section>
  );
}
