import React from "react";

export interface TabItem {
  value: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  /** Optional count badge. */
  count?: number;
}

export interface TabsProps {
  tabs: TabItem[];
  /** Active tab value (controlled). Defaults to the first tab. */
  value?: string;
  onChange?: (value: string) => void;
  style?: React.CSSProperties;
}

/** Pill-style segmented tab bar. */
export function Tabs(props: TabsProps): JSX.Element;
