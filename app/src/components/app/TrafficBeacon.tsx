"use client";

import { useEffect, useRef } from "react";
import Script from "next/script";

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        opts: {
          sitekey: string;
          callback: (token: string) => void;
          size: "invisible";
        },
      ) => void;
    };
  }
}

/**
 * Fires a single tracking beacon when an app page mounts. Server-side dedupe
 * (per visitor/session) means refreshes and re-mounts won't double-count.
 *
 * Also renders an invisible Cloudflare Turnstile challenge and sends its
 * token along with the beacon — the server only marks a view
 * revenue-eligible once that token verifies (see src/lib/turnstile.ts). If no
 * site key is configured (e.g. local dev), the beacon fires without a token
 * and the view is simply tracked as non-revenue-eligible.
 */
export function TrafficBeacon({
  appId,
  path,
}: {
  appId: string;
  path: string;
}) {
  const sent = useRef(false);
  const widgetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (sent.current) return;

    function send(turnstileToken: string | null) {
      if (sent.current) return;
      sent.current = true;
      const referrer =
        typeof document !== "undefined" ? document.referrer : undefined;
      fetch("/api/track", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ appId, path, referrer, turnstileToken }),
        keepalive: true,
      }).catch(() => {
        /* tracking is best-effort */
      });
    }

    const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    if (!siteKey || !window.turnstile || !widgetRef.current) {
      // No CAPTCHA configured (e.g. local dev) — track without a token; the
      // server marks such views as not revenue-eligible.
      send(null);
      return;
    }
    window.turnstile.render(widgetRef.current, {
      sitekey: siteKey,
      size: "invisible",
      callback: send,
    });
  }, [appId, path]);

  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js"
        strategy="afterInteractive"
      />
      <div ref={widgetRef} />
    </>
  );
}
