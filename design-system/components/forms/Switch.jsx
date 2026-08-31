import React from "react";

/**
 * On/off switch with a bubbly knob.
 */
export function Switch({ checked = false, onChange, disabled = false, label, style, ...rest }) {
  const toggle = () => { if (!disabled && onChange) onChange(!checked); };
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 10, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1, ...style }}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={toggle}
        disabled={disabled}
        style={{
          position: "relative",
          width: 46,
          height: 28,
          flex: "0 0 auto",
          border: "none",
          borderRadius: "var(--radius-pill)",
          background: checked ? "var(--mint-500)" : "var(--ink-200)",
          boxShadow: checked ? "var(--shadow-mint)" : "inset 0 1px 2px rgba(12,42,46,.12)",
          cursor: disabled ? "not-allowed" : "pointer",
          transition: "background var(--dur-base) var(--ease-out), box-shadow var(--dur-base) var(--ease-out)",
          padding: 0,
        }}
        {...rest}
      >
        <span
          style={{
            position: "absolute",
            top: 3,
            left: checked ? 21 : 3,
            width: 22,
            height: 22,
            borderRadius: "50%",
            background: "#fff",
            boxShadow: "0 2px 5px rgba(12,42,46,.25)",
            transition: "left var(--dur-base) var(--ease-bubble)",
          }}
        />
      </button>
      {label ? <span style={{ font: "var(--w-medium) 14px var(--font-sans)", color: "var(--text-body)" }}>{label}</span> : null}
    </label>
  );
}
