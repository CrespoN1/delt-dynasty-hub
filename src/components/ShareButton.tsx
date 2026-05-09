"use client";

import { useState } from "react";

type Props = {
  url: string;
  title: string;
  text?: string;
  variant?: "primary" | "subtle";
};

export function ShareButton({ url, title, text, variant = "primary" }: Props) {
  const [copied, setCopied] = useState(false);

  async function handleClick() {
    const fullUrl = url.startsWith("http")
      ? url
      : typeof window !== "undefined"
      ? new URL(url, window.location.origin).toString()
      : url;
    const shareText = text ?? title;
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({ title, text: shareText, url: fullUrl });
        return;
      } catch (err) {
        // User cancelled or share failed — fall through to clipboard
        if ((err as Error).name === "AbortError") return;
      }
    }
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      await navigator.clipboard.writeText(`${shareText}\n${fullUrl}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  const base =
    "inline-flex items-center gap-2 rounded-full font-medium transition-colors";
  const styles =
    variant === "primary"
      ? `${base} px-4 py-2 bg-accent text-ink hover:bg-accent/90`
      : `${base} px-3 py-1.5 text-sm bg-white/10 hover:bg-white/20 text-white/80`;

  return (
    <button onClick={handleClick} className={styles} type="button">
      {copied ? (
        <>✓ Copied</>
      ) : (
        <>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
            <polyline points="16 6 12 2 8 6" />
            <line x1="12" y1="2" x2="12" y2="15" />
          </svg>
          Share
        </>
      )}
    </button>
  );
}
