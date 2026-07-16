"use client";

import { useEffect, useRef } from "react";

/**
 * Fires a single tracking beacon when an app page mounts. Server-side dedupe
 * (per visitor/session) means refreshes and re-mounts won't double-count.
 */
export function TrafficBeacon({
  appId,
  path,
}: {
  appId: string;
  path: string;
}) {
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    const referrer =
      typeof document !== "undefined" ? document.referrer : undefined;
    fetch("/api/track", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ appId, path, referrer }),
      keepalive: true,
    }).catch(() => {
      /* tracking is best-effort */
    });
  }, [appId, path]);

  return null;
}
