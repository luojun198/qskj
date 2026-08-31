import React from "react";

export interface AvatarProps {
  src?: string;
  /** Used for initials fallback + alt text. */
  name?: string;
  size?: "sm" | "md" | "lg" | number;
  style?: React.CSSProperties;
}

/** Round avatar; falls back to initials on a bubble gradient. */
export function Avatar(props: AvatarProps): JSX.Element;
