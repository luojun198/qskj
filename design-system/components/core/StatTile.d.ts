import React from "react";

export interface StatTileProps {
  label: React.ReactNode;
  /** The number, pre-formatted (e.g. "12,480.00"). Rendered in tabular figures. */
  value: React.ReactNode;
  /** Leading unit, default "¥". Pass "" to hide. */
  unit?: string;
  /** Delta string like "+8.2%" or "-1.4%". Drives the arrow + color. */
  delta?: string | number;
  deltaTone?: "auto" | string;
  icon?: React.ReactNode;
  style?: React.CSSProperties;
}

/** Dashboard metric tile with a big tabular figure and optional delta. */
export function StatTile(props: StatTileProps): JSX.Element;
