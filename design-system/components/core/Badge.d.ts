import React from "react";

export interface BadgeProps {
  tone?: "brand" | "blue" | "neutral" | "success" | "warning" | "danger" | "solid";
  /** Show a leading status dot. */
  dot?: boolean;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}

/** Pill-shaped status / category label. */
export function Badge(props: BadgeProps): JSX.Element;
