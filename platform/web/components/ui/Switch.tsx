"use client";

type SwitchProps = {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  hint?: string;
  className?: string;
  full?: boolean;
};

/** Consistent toggle used instead of native checkboxes across the panel. */
export function Switch({
  checked,
  onChange,
  label,
  hint,
  className = "",
  full = false
}: SwitchProps) {
  return (
    <div
      className={`switch-row${full ? " full" : ""} ${className}`.trim()}
    >
      <div className="switch-row-copy">
        <strong>{label}</strong>
        {hint ? <div className="hint">{hint}</div> : null}
      </div>
      <button
        type="button"
        className={`ui-switch${checked ? " on" : ""}`}
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
      >
        <span className="ui-switch-knob" />
      </button>
    </div>
  );
}
