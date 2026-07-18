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
import { explorerTxUrl } from "@/lib/explorer";
import { ToastGlow } from "./ToastGlow";

type ToastKind = "success" | "error" | "info";
interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  leaving: boolean;
  explorerUrl?: string;
}

interface ToastOptions {
  /** A confirmed transaction's signature — renders a "View on Explorer" link. */
  txSig?: string;
}

// Matches the exit transition duration below — the toast is kept in the DOM
// (marked `leaving`) for this long so the fade/translate can finish before
// it's actually removed, instead of vanishing mid-animation.
const EXIT_MS = 200;

interface ToastApi {
  toast: (message: string, kind?: ToastKind, opts?: ToastOptions) => void;
  success: (message: string, opts?: ToastOptions) => void;
  error: (message: string, opts?: ToastOptions) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

let counter = 0;

// RGB (0-1) per kind, fed to ToastGlow's shader — same hues as the kind's
// text/border color below, just as floats instead of a Tailwind class.
const GLOW_COLOR: Record<ToastKind, readonly [number, number, number]> = {
  success: [0.180, 0.969, 0.776], // aurora mint
  error: [0.973, 0.443, 0.443], // red-400
  info: [0.329, 0.725, 1.0], // plasma blue
};

// Circle + glyph, one compound path per kind (multiple M subpaths in a
// single `d`) — reads as a clear status icon rather than a bare checkmark
// floating with nothing around it.
const ICON_PATH: Record<ToastKind, string> = {
  success: "M12 2a10 10 0 100 20 10 10 0 000-20zM7.5 12.5l2.5 2.5 6-6",
  error: "M12 2a10 10 0 100 20 10 10 0 000-20zM9 9l6 6M15 9l-6 6",
  info: "M12 2a10 10 0 100 20 10 10 0 000-20zM12 11v5M12 8h.01",
};

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
    (message: string, kind: ToastKind = "info", opts?: ToastOptions) => {
      const id = ++counter;
      const explorerUrl = opts?.txSig ? explorerTxUrl(opts.txSig) : undefined;
      setToasts((t) => [...t, { id, kind, message, leaving: false, explorerUrl }]);
      setTimeout(() => remove(id), 4500);
    },
    [remove],
  );

  const api = useMemo<ToastApi>(
    () => ({
      toast,
      success: (m: string, opts?: ToastOptions) => toast(m, "success", opts),
      error: (m: string, opts?: ToastOptions) => toast(m, "error", opts),
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
              "pointer-events-auto relative overflow-hidden rounded-card border bg-ivory/90 backdrop-blur-md transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.2,0,0,1)]",
              t.leaving ? "translate-y-1 opacity-0" : "animate-fade-in translate-y-0 opacity-100",
              t.kind === "success" && "border-forest/30",
              t.kind === "error" && "border-red-400/30",
              t.kind === "info" && "border-hairline",
            )}
          >
            <ToastGlow color={GLOW_COLOR[t.kind]} />
            <div className="relative flex items-start gap-2.5 px-4 py-3">
              <svg
                className={cn(
                  "mt-0.5 h-4 w-4 shrink-0",
                  t.kind === "success" && "text-forest",
                  t.kind === "error" && "text-red-400",
                  t.kind === "info" && "text-cobalt",
                )}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={ICON_PATH[t.kind]} />
              </svg>
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "text-sm",
                    t.kind === "success" && "text-forest",
                    t.kind === "error" && "text-red-400",
                    t.kind === "info" && "text-ink",
                  )}
                >
                  {t.message}
                </p>
                {t.explorerUrl && (
                  <a
                    href={t.explorerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-cobalt hover:text-cobalt-deep hover:underline"
                  >
                    View on Explorer
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M17 7l-10 10M7 7h10v10"
                      />
                    </svg>
                  </a>
                )}
              </div>
              <button
                type="button"
                onClick={() => remove(t.id)}
                aria-label="Dismiss"
                className="shrink-0 rounded-full p-0.5 text-slate-steel transition-colors hover:text-ink"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
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
