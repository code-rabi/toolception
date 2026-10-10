import type { FastifyReply, FastifyRequest } from "fastify";

/**
 * Reduces an origin string to `scheme://host[:port]` in lower case, with
 * default ports dropped. Built from `protocol` and `host` rather than
 * `URL.origin`, which is `"null"` for non-http schemes, so entries like
 * `vscode-webview://abc` can be listed. The host is lower-cased explicitly
 * because `URL` keeps its case for non-http schemes.
 *
 * @param value - Raw origin, such as the `Origin` header or an allowlist entry
 * @returns The canonical origin, or `undefined` when `value` is not an origin
 */
export function normalizeOrigin(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (!url.host) return undefined;
    return `${url.protocol}//${url.host.toLowerCase()}`;
  } catch {
    return undefined;
  }
}

/**
 * Normalizes an allowlist, failing fast on entries that are not origins.
 *
 * @param allowedOrigins - Entries as configured by the caller
 * @returns The canonical origins
 * @throws When an entry cannot be parsed as an origin
 */
export function normalizeAllowedOrigins(
  allowedOrigins: readonly string[]
): string[] {
  return allowedOrigins.map((entry) => {
    const normalized = normalizeOrigin(entry);
    if (!normalized) {
      throw new Error(
        `Invalid allowedOrigins entry "${entry}": expected an origin such as "https://app.example.com"`
      );
    }
    return normalized;
  });
}

/** Fastify `onRequest` hook that answers `403` for a disallowed `Origin`. */
export type OriginGuard = (
  req: FastifyRequest,
  reply: FastifyReply
) => Promise<FastifyReply | undefined>;

/**
 * Builds a Fastify `onRequest` hook that enforces the MCP spec's Origin check
 * (protection against DNS rebinding) on the MCP endpoints.
 *
 * Requests without an `Origin` header are always allowed: they come from
 * non-browser clients, which are not the threat this check addresses. A
 * request that carries an `Origin` outside the allowlist gets `403`. The
 * header must already be a bare origin (no path, userinfo, query or explicit
 * default port), which is what browsers send; anything looser is refused.
 * Letter case is ignored.
 *
 * @param allowedOrigins - Canonical origins from {@link normalizeAllowedOrigins}
 * @returns The hook
 */
export function createOriginGuard(allowedOrigins: readonly string[]): OriginGuard {
  const allowed = new Set(allowedOrigins);
  return async function originGuard(
    req: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply | undefined> {
    const header = req.headers.origin;
    if (header === undefined) return undefined;
    const origin = normalizeOrigin(header);
    if (origin && header.toLowerCase() === origin && allowed.has(origin)) {
      return undefined;
    }
    return reply.code(403).send({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Forbidden: Origin not allowed" },
      id: null,
    });
  };
}
