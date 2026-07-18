import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { getSession, type SessionPayload } from "./session";
import { fetchUserById } from "./indexerClient";

// Small helpers for consistent JSON API responses and auth guards.

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ ok: true, data }, init);
}

export function fail(message: string, status = 400, extra?: unknown) {
  return NextResponse.json(
    { ok: false, error: message, details: extra },
    { status },
  );
}

/** Wrap a route handler so thrown errors become clean JSON responses. */
export function handler<T extends unknown[]>(
  fn: (...args: T) => Promise<Response>,
) {
  return async (...args: T): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err instanceof ZodError) {
        return fail("Validation failed", 422, err.flatten());
      }
      if (err instanceof ApiError) {
        return fail(err.message, err.status);
      }
      console.error("[api] unhandled error:", err);
      return fail("Internal server error", 500);
    }
  };
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/** Require an authenticated session; throws 401 otherwise. */
export async function requireSession(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) throw new ApiError("Authentication required", 401);
  return session;
}

/** Require an authenticated session AND load the user record. */
export async function requireUser() {
  const session = await requireSession();
  const user = await fetchUserById(session.userId);
  if (!user) throw new ApiError("User not found", 401);
  return user;
}
