import React from "react";

/**
 * Soft container surface. The bubbly card with optional hover lift.
 */
export function Card({ interactive = false, padding = 24, children, style, ...rest }) {
  const [hover, setHover] = React.useState(false);
  return (
    <div
      onMouseEnter={() => interactive && setHover(true)}
      onMouseLeave={() => interactive && setHover(false)}
      style={{
        background: "var(--surface-card)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-lg)",
        boxShadow: hover ? "var(--shadow-lg)" : "var(--shadow-sm)",
        padding,
        transition: "box-shadow var(--dur-base) var(--ease-out), transform var(--dur-base) var(--ease-out)",
        transform: hover ? "translateY(-3px)" : "none",
        cursor: interactive ? "pointer" : "default",
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}
