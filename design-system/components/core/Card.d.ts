import React from "react";

export interface CardProps {
  /** Adds hover lift + pointer cursor. */
  interactive?: boolean;
  /** Inner padding in px (default 24). */
  padding?: number;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}

/** Soft white container with bubbly rounding and a soft cool shadow. */
export function Card(props: CardProps): JSX.Element;
