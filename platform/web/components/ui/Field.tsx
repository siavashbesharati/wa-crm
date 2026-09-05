"use client";

import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

type FieldBase = {
  label: string;
  hint?: string;
  error?: string;
  className?: string;
  full?: boolean;
};

export function Field({
  label,
  hint,
  error,
  className = "",
  full = false,
  children
}: FieldBase & { children: ReactNode }) {
  return (
    <label className={`ui-field${full ? " full" : ""} ${className}`.trim()}>
      <span className="ui-field-label">{label}</span>
      {children}
      {hint && !error ? <span className="ui-field-hint">{hint}</span> : null}
      {error ? (
        <span className="ui-field-error" role="alert">
          {error}
        </span>
      ) : null}
    </label>
  );
}

export function TextInput({
  label,
  hint,
  error,
  className = "",
  full,
  ...rest
}: FieldBase & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <Field label={label} hint={hint} error={error} className={className} full={full}>
      <input className="ui-input" {...rest} />
    </Field>
  );
}

export function TextTextarea({
  label,
  hint,
  error,
  className = "",
  full,
  ...rest
}: FieldBase & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <Field label={label} hint={hint} error={error} className={className} full={full}>
      <textarea className="ui-input ui-textarea" {...rest} />
    </Field>
  );
}

export function TextSelect({
  label,
  hint,
  error,
  className = "",
  full,
  children,
  ...rest
}: FieldBase & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <Field label={label} hint={hint} error={error} className={className} full={full}>
      <select className="ui-input" {...rest}>
        {children}
      </select>
    </Field>
  );
}
