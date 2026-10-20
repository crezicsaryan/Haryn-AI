"use client";

import { useEffect } from "react";

/**
 * Opens the print dialog once the document is actually ready.
 *
 * Printing on `load` alone is unreliable: the webfont and the layout shift land
 * after it, and the dialog captures the half-styled page. Waiting for
 * `document.fonts.ready` plus a frame gets the first paint of the final layout.
 */
export function PrintTrigger() {
  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        await document.fonts?.ready;
      } catch {
        /* font loading is best-effort */
      }
      if (cancelled) return;
      // One frame for layout to settle after the fonts swap.
      requestAnimationFrame(() => {
        if (!cancelled) window.print();
      });
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
