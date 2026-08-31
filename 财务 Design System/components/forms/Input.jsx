import React from "react";

/**
 * Text input with floating bubble focus ring. Supports leading/trailing adornments.
 */
export function Input({
  label,
  hint,
  error,
  prefix,
  suffix,
  size = "md",
  style,
  id,
  ...rest
}) {
  const [focus, setFocus] = React.useState(false);
  const h = size === "lg" ? 52 : size === "sm" ? 38 : 46;
  const inputId = id || React.useId();
  const borderColor = error
    ? "var(--danger)"
    : focus
    ? "var(--mint-400)"
    : "var(--border-default)";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7, ...style }}>
      {label ? (
        <label htmlFor={inputId} style={{ font: "var(--w-medium) 13px var(--font-sans)", color: "var(--text-strong)" }}>
          {label}
        </label>
      ) : null}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          height: h,
          padding: "0 14px",
          background: "var(--surface-card)",
          border: `1.5px solid ${borderColor}`,
          borderRadius: "var(--radius-md)",
          boxShadow: focus ? `0 0 0 4px ${error ? "var(--danger-soft)" : "var(--focus-ring)"}` : "none",
          transition: "border-color var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out)",
        }}
      >
        {prefix ? <span style={{ color: "var(--text-muted)", display: "inline-flex" }}>{prefix}</span> : null}
        <input
          id={inputId}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          style={{
            flex: 1,
            minWidth: 0,
            border: "none",
            outline: "none",
            background: "transparent",
            font: "var(--w-regular) 15px var(--font-sans)",
            color: "var(--text-strong)",
          }}
          {...rest}
        />
        {suffix ? <span style={{ color: "var(--text-muted)", display: "inline-flex" }}>{suffix}</span> : null}
      </div>
      {error ? (
        <span style={{ font: "var(--w-regular) 12px var(--font-sans)", color: "var(--danger)" }}>{error}</span>
      ) : hint ? (
        <span style={{ font: "var(--w-regular) 12px var(--font-sans)", color: "var(--text-muted)" }}>{hint}</span>
      ) : null}
    </div>
  );
}
