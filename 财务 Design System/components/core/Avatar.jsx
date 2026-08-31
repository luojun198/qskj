import React from "react";

const SIZES = { sm: 28, md: 40, lg: 56 };

/**
 * User avatar — image or initials on a bubble-gradient fill.
 */
export function Avatar({ src, name = "", size = "md", style, ...rest }) {
  const px = SIZES[size] || size;
  const initials = name.trim().slice(0, name.match(/[\u4e00-\u9fa5]/) ? 1 : 2).toUpperCase();
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: px,
        height: px,
        borderRadius: "50%",
        background: src ? "var(--ink-100)" : "var(--grad-bubble)",
        color: "var(--brand-contrast)",
        fontFamily: "var(--font-sans)",
        fontWeight: 700,
        fontSize: px * 0.4,
        overflow: "hidden",
        boxShadow: "var(--sheen)",
        flex: "0 0 auto",
        ...style,
      }}
      {...rest}
    >
      {src ? (
        <img src={src} alt={name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      ) : (
        initials || "?"
      )}
    </span>
  );
}
