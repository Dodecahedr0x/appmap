"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

type ToastKind = "success" | "error" | "info";
interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  leaving: boolean;
}

// Matches the exit transition duration below — the toast is kept in the DOM
// (marked `leaving`) for this long so the fade/translate can finish before
// it's actually removed, instead of vanishing mid-animation.
const EXIT_MS = 200;

interface ToastApi {
  toast: (message: string, kind?: ToastKind) => void;
  success: (message: string) => void;
  error: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

let counter = 0;

export function Toaster({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Marks the toast as leaving so it plays its exit transition, then drops
  // it from state once that transition has had time to finish.
  const remove = useCallback((id: number) => {
    setToasts((t) => t.map((x) => (x.id === id ? { ...x, leaving: true } : x)));
    setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id));
    }, EXIT_MS);
  }, []);

  const toast = useCallback(
    (message: string, kind: ToastKind = "info") => {
      const id = ++counter;
      setToasts((t) => [...t, { id, kind, message, leaving: false }]);
      setTimeout(() => remove(id), 4500);
    },
    [remove],
  );

  const api = useMemo<ToastApi>(
    () => ({
      toast,
      success: (m: string) => toast(m, "success"),
      error: (m: string) => toast(m, "error"),
    }),
    [toast],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={cn(
              "pointer-events-auto rounded-card border border-hairline bg-ivory px-4 py-3 text-sm transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.2,0,0,1)]",
              t.leaving ? "translate-y-1 opacity-0" : "animate-fade-in translate-y-0 opacity-100",
              t.kind === "success" &&
                "border-forest/30 bg-forest/5 text-forest",
              t.kind === "error" &&
                "border-red-400/30 bg-red-400/10 text-red-400",
              t.kind === "info" &&
                "border-hairline text-ink",
            )}
            onClick={() => remove(t.id)}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <Toaster>");
  return ctx;
}
