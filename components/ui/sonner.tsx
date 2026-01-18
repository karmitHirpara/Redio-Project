"use client";

import type React from "react";
import { Toaster as SonnerToaster, ToasterProps } from "sonner";

// Thin wrapper around Sonner's Toaster so existing imports keep working.
// Theme is controlled at the app level; we just apply basic styling tokens.
const Toaster = (props: ToasterProps) => {
  return (
    <SonnerToaster
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
