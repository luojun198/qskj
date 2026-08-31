import React from "react";

const TONES = {
  brand:   { bg: "var(--mint-100)",    fg: "var(--mint-700)" },
  blue:    { bg: "var(--blue-100)",    fg: "var(--blue-700)" },
  neutral: { bg: "var(--ink-100)",     fg: "var(--ink-700)" },
  success: { bg: "var(--success-soft)",fg: "#0a7d57" },
  warning: { bg: "var(--warning-soft)",fg: "#a96b10" },
  danger:  { bg: "var(--danger-soft)", fg: "#c23139" },
  solid:   { bg: "var(--mint-500)",    fg: "var(--brand-contrast)" },
};

/**
 * Small status / category label.
 */
export function Badge({ tone = "brand", dot = false, children, style, ...rest }) {
  const t = TONES[tone] || TONES.brand;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        height: 24,
        padding: "0 10px",
        background: t.bg,
        color: t.fg,
        fontFamily: "var(--font-sans)",
        fontSize: 12.5,
        fontWeight: 700,
        lineHeight: 1,
        borderRadius: "var(--radius-pill)",
        whiteSpace: "nowrap",
        ...style,
      }}
      {...rest}
    >
      {dot ? (
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor" }} />
      ) : null}
      {children}
    </span>
  );
}
