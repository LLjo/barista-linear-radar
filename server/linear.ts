import type { LinearErrorKind } from "./types.js";

export const LINEAR_GRAPHQL = "https://api.linear.app/graphql";
export const REQUEST_TIMEOUT_MS = 20_000;
/** Rate limited with no reset header: wait this long. */
export const DEFAULT_PAUSE_MS = 5 * 60_000;

/**
 * Every failure talking to Linear. `message` only ever comes from Linear's `errors[].message` or
 * a fixed line of ours — never from the request (which carries the key).
 */
export class LinearError extends Error {
  constructor(
    readonly kind: LinearErrorKind,
    readonly status: number,
    message: string,
    /** kind "rate": epoch ms when the limit lifts. */
    readonly retryAt?: number,
  ) {
    super(message);
    this.name = "LinearError";
  }
}

interface GqlBody<T> {
  data?: T;
  errors?: { message?: string; extensions?: { code?: string; type?: string } }[];
}

/** The latest `X-RateLimit-*-Reset` header (epoch ms; seconds are tolerated), else now + 5 min. */
export function resetAt(headers: Headers, now = Date.now()): number {
  let at = 0;
  headers.forEach((value, name) => {
    if (!/^x-ratelimit-.*reset$/i.test(name)) return;
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return;
    at = Math.max(at, n < 1e12 ? n * 1000 : n);
  });
  return at > now ? at : now + DEFAULT_PAUSE_MS;
}

const codeOf = (b: GqlBody<unknown> | null) => b?.errors?.find((e) => e.extensions?.code)?.extensions?.code ?? "";
const firstMessage = (b: GqlBody<unknown> | null) => b?.errors?.find((e) => typeof e.message === "string")?.message;

/**
 * One GraphQL request. Personal keys take no `Bearer`. Never logs the request, its headers or
 * the raw response; every failure is a {@link LinearError}.
 */
export async function gql<T>(key: string, query: string, variables: Record<string, unknown> = {}): Promise<{ data: T; complexity: number | null }> {
  let res: Response;
  try {
    res = await fetch(LINEAR_GRAPHQL, {
      method: "POST",
      headers: { Authorization: key, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (e) {
    const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    throw new LinearError("network", 0, timeout ? "Linear did not answer within 20 s" : "Could not reach Linear");
  }
  let body: GqlBody<T> | null = null;
  try {
    body = (await res.json()) as GqlBody<T>;
  } catch {
    body = null;
  }
  const code = codeOf(body);
  if (res.status === 401 || code === "AUTHENTICATION_ERROR") {
    throw new LinearError("auth", res.status, firstMessage(body) ?? "Linear rejected the key");
  }
  if (res.status === 429 || code === "RATELIMITED") {
    throw new LinearError("rate", res.status, firstMessage(body) ?? "Rate limited by Linear", resetAt(res.headers));
  }
  if (!res.ok) throw new LinearError("http", res.status, firstMessage(body) ?? `Linear answered HTTP ${res.status}`);
  if (body?.errors?.length || !body?.data) {
    throw new LinearError("graphql", res.status, firstMessage(body) ?? "Linear sent no data");
  }
  const c = Number(res.headers.get("x-complexity"));
  return { data: body.data, complexity: Number.isFinite(c) && c > 0 ? c : null };
}
