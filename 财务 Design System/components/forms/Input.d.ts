import React from "react";

/**
 * Labelled text field with a soft mint focus ring.
 * @startingPoint section="Forms" subtitle="Text field with label, hint & error" viewport="700x180"
 */
export interface InputProps {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  /** When set, border + ring turn coral and the message replaces hint. */
  error?: React.ReactNode;
  prefix?: React.ReactNode;
  suffix?: React.ReactNode;
  size?: "sm" | "md" | "lg";
  placeholder?: string;
  value?: string;
  type?: string;
  style?: React.CSSProperties;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

/** Labelled text field with a soft mint focus ring. */
export function Input(props: InputProps): JSX.Element;
