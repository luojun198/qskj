import React from "react";

const SIZES = {
  sm: { fontSize: 13, padding: "0 14px", height: 34, gap: 6, radius: "var(--radius-sm)" },
  md: { fontSize: 15, padding: "0 20px", height: 44, gap: 8, radius: "var(--radius-md)" },
  lg: { fontSize: 17, padding: "0 28px", height: 54, gap: 10, radius: "var(--radius-lg)" },
};

function variantStyle(variant, hover, active) {
  switch (variant) {
    case "secondary":
      return {
        background: hover ? "var(--blue-600)" : "var(--blue-500)",
        color: "#fff",
        boxShadow: active ? "none" : "var(--shadow-blue)",
      };
    case "ghost":
      return {
        background: hover ? "var(--mint-50)" : "transparent",
        color: "var(--mint-700)",
        boxShadow: "none",
      };
    case "soft":
      return {
        background: hover ? "var(--mint-100)" : "var(--mint-50)",
        color: "var(--mint-700)",
        boxShadow: "none",
      };
    case "outline":
      return {
        background: hover ? "var(--mint-50)" : "transparent",
        color: "var(--mint-700)",
        boxShadow: "inset 0 0 0 1.5px var(--mint-300)",
      };
    case "danger":
      return {
        background: hover ? "#e0434a" : "var(--danger)",
        color: "#fff",
        boxShadow: "none",
      };
    case "primary":
    default:
      return {
        background: hover ? "var(--mint-600)" : "var(--mint-500)",
        color: "var(--brand-contrast)",
        boxShadow: active ? "var(--sheen)" : "var(--shadow-mint), var(--sheen)",
      };
  }
}

/**
 * Primary action button. Bubbly, soft, with a mint glow on the primary variant.
 */
export function Button({
  variant = "primary",
  size = "md",
  icon,
  iconRight,
  fullWidth = false,
  disabled = false,
  type = "button",
  children,
  style,
  ...rest
}) {
  const [hover, setHover] = React.useState(false);
  const [active, setActive] = React.useState(false);
  const s = SIZES[size] || SIZES.md;
  const v = variantStyle(variant, hover && !disabled, active && !disabled);

  return (
    <button
      type={type}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setActive(false); }}
      onMouseDown={() => setActive(true)}
      onMouseUp={() => setActive(false)}
      style={{
        display: fullWidth ? "flex" : "inline-flex",
        width: fullWidth ? "100%" : undefined,
        alignItems: "center",
        justifyContent: "center",
        gap: s.gap,
        height: s.height,
        padding: s.padding,
        fontFamily: "var(--font-sans)",
        fontSize: s.fontSize,
        fontWeight: 700,
        lineHeight: 1,
        border: "none",
        borderRadius: s.radius,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.45 : 1,
        transform: active && !disabled ? "translateY(1px) scale(0.98)" : "none",
        transition: "background var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-bubble), box-shadow var(--dur-fast) var(--ease-out)",
        whiteSpace: "nowrap",
        ...v,
        ...style,
      }}
      {...rest}
    >
      {icon ? <span style={{ display: "inline-flex", fontSize: "1.15em" }}>{icon}</span> : null}
      {children}
      {iconRight ? <span style={{ display: "inline-flex", fontSize: "1.15em" }}>{iconRight}</span> : null}
    </button>
  );
}
