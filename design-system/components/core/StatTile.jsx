import React from "react";

/**
 * A dashboard metric tile — label, big tabular number, optional delta.
 */
export function StatTile({ label, value, unit = "¥", delta, deltaTone = "auto", icon, style, ...rest }) {
  const up = typeof delta === "string" ? delta.trim().startsWith("+") : delta > 0;
  const tone = deltaTone === "auto" ? (up ? "var(--success)" : "var(--danger)") : deltaTone;
  return (
    <div
      style={{
        background: "var(--surface-card)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--shadow-sm)",
        padding: 20,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        ...style,
      }}
      {...rest}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ font: "var(--w-medium) 13px var(--font-sans)", color: "var(--text-muted)" }}>{label}</span>
        {icon ? (
          <span style={{
            display: "inline-flex", width: 30, height: 30, alignItems: "center", justifyContent: "center",
            borderRadius: "var(--radius-sm)", background: "var(--mint-50)", color: "var(--mint-600)",
          }}>{icon}</span>
        ) : null}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
        {unit ? <span style={{ font: "var(--w-medium) 18px var(--font-num)", color: "var(--text-muted)" }}>{unit}</span> : null}
        <span style={{
          font: "var(--w-bold) 30px var(--font-num)", color: "var(--text-strong)",
          fontVariantNumeric: "tabular-nums", letterSpacing: "var(--ls-tight)",
        }}>{value}</span>
      </div>
      {delta != null ? (
        <span style={{ font: "var(--w-bold) 13px var(--font-num)", color: tone, fontVariantNumeric: "tabular-nums" }}>
          {up ? "▲" : "▼"} {String(delta).replace(/^[+-]/, "")}
        </span>
      ) : null}
    </div>
  );
}
