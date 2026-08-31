import React from "react";

/**
 * Pill tab bar. Controlled via value/onChange. Sliding mint pill marks the active tab.
 */
export function Tabs({ tabs = [], value, onChange, style, ...rest }) {
  const active = value ?? (tabs[0] && tabs[0].value);
  return (
    <div
      style={{
        display: "inline-flex",
        gap: 4,
        padding: 4,
        background: "var(--surface-sunken)",
        borderRadius: "var(--radius-pill)",
        ...style,
      }}
      {...rest}
    >
      {tabs.map((t) => {
        const on = t.value === active;
        return (
          <button
            key={t.value}
            type="button"
            onClick={() => onChange && onChange(t.value)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              height: 36,
              padding: "0 18px",
              border: "none",
              borderRadius: "var(--radius-pill)",
              background: on ? "var(--surface-card)" : "transparent",
              color: on ? "var(--mint-700)" : "var(--text-muted)",
              boxShadow: on ? "var(--shadow-sm)" : "none",
              font: "var(--w-bold) 14px var(--font-sans)",
              cursor: "pointer",
              whiteSpace: "nowrap",
              transition: "color var(--dur-fast) var(--ease-out), background var(--dur-fast) var(--ease-out)",
            }}
          >
            {t.icon ? <span style={{ display: "inline-flex" }}>{t.icon}</span> : null}
            {t.label}
            {t.count != null ? (
              <span style={{
                font: "var(--w-bold) 11px var(--font-num)", padding: "1px 7px", borderRadius: "var(--radius-pill)",
                background: on ? "var(--mint-100)" : "var(--ink-200)", color: on ? "var(--mint-700)" : "var(--ink-600)",
              }}>{t.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
