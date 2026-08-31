import React from "react";

/**
 * 财务洗头膏 primary button — bubbly, with the signature mint glow on `primary`.
 * @startingPoint section="Core" subtitle="Buttons with the mint-glow primary" viewport="700x200"
 */
export interface ButtonProps {
  /** Visual style. primary = mint glow; secondary = soap-blue; soft/ghost/outline = quiet; danger = coral. */
  variant?: "primary" | "secondary" | "soft" | "ghost" | "outline" | "danger";
  size?: "sm" | "md" | "lg";
  /** Leading icon node (e.g. a Lucide <i data-lucide>). */
  icon?: React.ReactNode;
  /** Trailing icon node. */
  iconRight?: React.ReactNode;
  fullWidth?: boolean;
  disabled?: boolean;
  type?: "button" | "submit" | "reset";
  children?: React.ReactNode;
  style?: React.CSSProperties;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
}

/** 财务洗头膏 primary button. */
export function Button(props: ButtonProps): JSX.Element;
