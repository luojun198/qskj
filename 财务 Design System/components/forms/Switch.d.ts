import React from "react";

export interface SwitchProps {
  checked?: boolean;
  onChange?: (next: boolean) => void;
  disabled?: boolean;
  label?: React.ReactNode;
  style?: React.CSSProperties;
}

/** Controlled on/off switch with a bubbly knob and mint glow when on. */
export function Switch(props: SwitchProps): JSX.Element;
