import { afterEach, describe, expect, spyOn, test } from "bun:test";
import viewer from "./fixtures/viewer.json";
import { DEFAULT_PAUSE_MS, gql, LINEAR_GRAPHQL, LinearError, resetAt } from "./linear.js";

// Invented: never a real key.
const KEY = "fake-linear-key-for-tests-0123456789";
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function answer(body: unknown, init: ResponseInit = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = (async (url: string, i: RequestInit) => {
    calls.push({ url, init: i });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), init);
  }) as unknown as typeof fetch;
  return calls;
}

async function failure(p: Promise<unknown>): Promise<LinearError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof LinearError) return e;
    throw e;
  }
  throw new Error("expected a LinearError");
}

describe("gql", () => {
  test("POSTs the query with the bare key (no Bearer), JSON, and a timeout signal", async () => {
    const calls = answer(viewer, { headers: { "X-Complexity": "1234" } });
    const r = await gql(KEY, "query { viewer { id } }", { a: 1 });
    expect(r.data).toEqual(viewer.data);
    expect(r.complexity).toBe(1234);
    expect(calls[0].url).toBe(LINEAR_GRAPHQL);
    const h = calls[0].init.headers as Record<string, string>;
    expect(h.Authorization).toBe(KEY);
    expect(h["Content-Type"]).toBe("application/json");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ query: "query { viewer { id } }", variables: { a: 1 } });
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
  });

  test("401 is auth", async () => {
    answer({ errors: [{ message: "Authentication required, not authenticated", extensions: { code: "AUTHENTICATION_ERROR" } }] }, { status: 401 });
    const e = await failure(gql(KEY, "q"));
    expect(e).toMatchObject({ kind: "auth", status: 401, message: "Authentication required, not authenticated" });
  });

  test("AUTHENTICATION_ERROR in a 200 body is auth", async () => {
    answer({ errors: [{ message: "nope", extensions: { code: "AUTHENTICATION_ERROR" } }] });
    expect((await failure(gql(KEY, "q"))).kind).toBe("auth");
  });

  test("429 is rate, paused until the latest reset header", async () => {
    answer({ errors: [{ message: "Rate limit exceeded", extensions: { code: "RATELIMITED" } }] }, {
      status: 429,
      headers: { "X-RateLimit-Requests-Reset": "4102444800000", "X-RateLimit-Complexity-Reset": "4102444900000" },
    });
    const e = await failure(gql(KEY, "q"));
    expect(e).toMatchObject({ kind: "rate", retryAt: 4102444900000 });
  });

  test("RATELIMITED in a 400 body is rate, 5 min without a header", async () => {
    answer({ errors: [{ message: "Rate limit exceeded", extensions: { code: "RATELIMITED" } }] }, { status: 400 });
    const before = Date.now();
    const e = await failure(gql(KEY, "q"));
    expect(e.kind).toBe("rate");
    expect(e.retryAt!).toBeGreaterThanOrEqual(before + DEFAULT_PAUSE_MS);
  });

  test("a 5xx is http, with Linear's message or a fixed one", async () => {
    answer("<html>bad gateway</html>", { status: 502 });
    expect(await failure(gql(KEY, "q"))).toMatchObject({ kind: "http", status: 502, message: "Linear answered HTTP 502" });
  });

  test("errors in a 200 body are graphql", async () => {
    answer({ errors: [{ message: "Cannot query field \"x\"", extensions: { code: "GRAPHQL_VALIDATION_FAILED" } }] });
    expect(await failure(gql(KEY, "q"))).toMatchObject({ kind: "graphql", message: "Cannot query field \"x\"" });
  });

  test("a thrown fetch is network; a timeout says so", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    expect(await failure(gql(KEY, "q"))).toMatchObject({ kind: "network", message: "Could not reach Linear" });
    globalThis.fetch = (async () => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    }) as unknown as typeof fetch;
    expect(await failure(gql(KEY, "q"))).toMatchObject({ kind: "network", message: "Linear did not answer within 20 s" });
  });

  test("a body that stalls past the timeout is network, not graphql", async () => {
    globalThis.fetch = (async () =>
      new Response(new ReadableStream({ pull: (c) => c.error(new DOMException("The operation timed out.", "TimeoutError")) }), { status: 200 })) as unknown as typeof fetch;
    expect(await failure(gql(KEY, "q"))).toMatchObject({ kind: "network", message: "Linear did not answer within 20 s" });
  });

  test("a hung request is cut off by its own signal", async () => {
    globalThis.fetch = ((_u: string, i: RequestInit) =>
      new Promise((_, reject) => {
        if (i.signal!.aborted) reject(i.signal!.reason);
        i.signal!.addEventListener("abort", () => reject(i.signal!.reason));
      })) as unknown as typeof fetch;
    const timeout = spyOn(AbortSignal, "timeout").mockImplementation(() => AbortSignal.abort(new DOMException("t", "TimeoutError")));
    try {
      expect((await failure(gql(KEY, "q"))).kind).toBe("network");
      expect(timeout).toHaveBeenCalledWith(20_000);
    } finally {
      timeout.mockRestore();
    }
  });

  test("never logs, and no error carries the key", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => spyOn(console, m));
    try {
      for (const [body, status] of [[{ errors: [{ message: "x", extensions: { code: "AUTHENTICATION_ERROR" } }] }, 401], ["oops", 500], [viewer, 200]] as const) {
        answer(body, { status });
        try {
          await gql(KEY, "q");
        } catch (e) {
          expect(JSON.stringify(e) + String((e as Error).message)).not.toContain(KEY);
        }
      }
      for (const s of spies) expect(s).not.toHaveBeenCalled();
    } finally {
      for (const s of spies) s.mockRestore();
    }
  });
});

describe("resetAt", () => {
  test("seconds are read as seconds; a reset in the past falls back to 5 min", () => {
    const now = 1_000_000_000_000;
    expect(resetAt(new Headers({ "x-ratelimit-requests-reset": String(now / 1000 + 60) }), now)).toBe(now + 60_000);
    expect(resetAt(new Headers({ "x-ratelimit-requests-reset": "5" }), now)).toBe(now + DEFAULT_PAUSE_MS);
  });
});
