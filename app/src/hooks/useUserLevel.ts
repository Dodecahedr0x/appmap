"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/providers/AuthProvider";

export interface UserLevel {
  level: number;
  title: string;
}

/** The signed-in user's XP level, for the navbar badge. `null` while signed
    out or loading — callers should just hide the badge in that case, same
    convention as `useWalletBalances`'s `neb: null`. */
export function useUserLevel(): UserLevel | null {
  const { user } = useAuth();
  const [level, setLevel] = useState<UserLevel | null>(null);

  useEffect(() => {
    if (!user) {
      setLevel(null);
      return;
    }
    let cancelled = false;
    fetch("/api/xp/me")
      .then((r) => r.json())
      .then((json) => {
        if (!cancelled && json.ok && json.data) {
          setLevel({ level: json.data.level, title: json.data.title });
        }
      })
      .catch(() => {
        if (!cancelled) setLevel(null);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  return level;
}
