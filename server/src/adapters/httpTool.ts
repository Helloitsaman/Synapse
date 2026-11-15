/**
 * Generic HTTP tool adapter.
 *
 * Executes a declared HTTP request for `tool` nodes with hard safety rails:
 *  - URL allowlisting (host must match TOOL_ALLOWLIST, default: none allowed).
 *  - SSRF protection: rejects non-http(s) schemes, credentials in URL, and
 *    hosts that resolve to private/loopback/link-local/metadata ranges.
 *  - DNS-rebinding protection: the connection is pinned to the exact IP address
 *    that was validated, so a hostname cannot resolve to a public address during
 *    the safety check and a private address when the socket is opened
 *    (time-of-check/time-of-use). The original hostname is still used for the
 *    HTTP `Host` header and the TLS certificate (SNI) check.
 *  - Timeouts (bounded by the node timeout / AbortSignal).
 *  - No redirects are followed (redirect-based SSRF).
 *  - Input/output validation and a response size cap.
 */
import { lookup } from "node:dns/promises";
import net from "node:net";
import http from "node:http";
import https from "node:https";
import type { Adapter, AdapterContext, AdapterResult } from "./contract.js";
import { ADAPTER_CONTRACT_VERSION, AdapterError, emptyUsage } from "./contract.js";
import type { WorkflowNode } from "../types.js";

const MAX_RESPONSE_BYTES = 256 * 1024;

function parseAllowlist(): string[] {
  return (process.env.TOOL_ALLOWLIST ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Returns the embedded IPv4 address for an IPv4-mapped / IPv4-compatible IPv6
 * address (e.g. `::ffff:192.168.0.1` or `::ffff:c0a8:1`), else null.
 */
export function mappedIpv4(ip: string): string | null {
  const low = ip.toLowerCase();
  // Dotted form: ::ffff:192.168.0.1  (or deprecated ::192.168.0.1)
  const dotted = low.match(/^::(ffff:)?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dotted && net.isIPv4(dotted[2])) return dotted[2];
  // Hex form of a v4-mapped address: ::ffff:c0a8:0001
  const hex = low.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
  }
  return null;
}

export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true; // link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }
  if (net.isIPv6(ip)) {
    const low = ip.toLowerCase();
    // IPv4-mapped/compatible addresses tunnel an IPv4 target — validate that.
    const v4 = mappedIpv4(low);
    if (v4) return isPrivateIp(v4);
    if (low === "::1" || low === "::") return true;
    if (low.startsWith("fc") || low.startsWith("fd")) return true; // ULA
    if (low.startsWith("fe80")) return true; // link-local
    if (low.startsWith("fe9") || low.startsWith("fea") || low.startsWith("feb")) return true; // link-local range
    return false;
  }
  return true; // unknown format -> treat as unsafe
}

interface PinnedResponse {
  status: number;
  buf: Buffer;
}

/**
 * Perform an HTTP(S) request connecting to a pre-validated IP address while
 * presenting the original hostname for Host/SNI. Never follows redirects and
 * aborts once the response exceeds `maxBytes`.
 */
function requestPinned(
  url: URL,
  pinnedIp: string,
  opts: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal; maxBytes: number },
): Promise<PinnedResponse> {
  const isHttps = url.protocol === "https:";
  const mod = isHttps ? https : http;
  const port = url.port ? Number(url.port) : isHttps ? 443 : 80;
  const defaultPort = isHttps ? 443 : 80;
  const hostHeader = port === defaultPort ? url.hostname : `${url.hostname}:${port}`;

  return new Promise<PinnedResponse>((resolve, reject) => {
    const family = net.isIPv6(pinnedIp) ? 6 : 4;
    const req = mod.request({
      host: pinnedIp, // connect to the exact validated address (no re-resolution)
      port,
      family,
      method: opts.method,
      path: url.pathname + url.search,
      // Preserve the real hostname for the Host header and the TLS cert check.
      headers: { ...opts.headers, host: hostHeader },
      setHost: false,
      servername: isHttps ? url.hostname : undefined,
      // Pinned connect avoids DNS re-resolution; also guard against proxies that
      // might re-resolve by refusing to look up anything but the literal IP.
      lookup: (_hostname, _options, cb) => cb(null, pinnedIp as any, family),
    } as http.RequestOptions, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.destroy();
        reject(new AdapterError("Tool response was a redirect (not followed).", "SSRF_BLOCKED"));
        return;
      }
      const chunks: Buffer[] = [];
      let total = 0;
      res.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total > opts.maxBytes) {
          res.destroy();
          reject(new AdapterError("Tool response exceeds size cap.", "RESPONSE_TOO_LARGE"));
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => resolve({ status, buf: Buffer.concat(chunks) }));
      res.on("error", (err) => reject(new AdapterError(`Tool request failed: ${err.message}`, "TOOL_ERROR")));
    });

    const onAbort = () => {
      req.destroy(new Error("aborted"));
    };
    if (opts.signal) {
      if (opts.signal.aborted) {
        req.destroy(new Error("aborted"));
      } else {
        opts.signal.addEventListener("abort", onAbort, { once: true });
      }
    }

    req.on("error", (err) =>
      reject(new AdapterError(`Tool request failed: ${err.message}`, "TOOL_ERROR")),
    );
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}

export class HttpToolAdapter implements Adapter {
  readonly id = "http-tool";
  readonly contractVersion = ADAPTER_CONTRACT_VERSION;
  readonly capabilities = {
    ops: ["tool"],
    network: true,
    providerReportedUsage: false,
    credentialless: true,
    limitations: [
      "Only hosts in TOOL_ALLOWLIST are reachable (default: none).",
      "Blocks private/loopback/metadata IP ranges (SSRF protection).",
      "Connection is pinned to the validated IP (DNS-rebinding protection).",
      `Response body capped at ${MAX_RESPONSE_BYTES} bytes.`,
    ],
  };

  isAvailable() {
    const allow = parseAllowlist();
    if (allow.length === 0) {
      return {
        available: false,
        reason: "TOOL_ALLOWLIST is empty; no outbound hosts permitted.",
      };
    }
    return { available: true };
  }

  supports(node: WorkflowNode): boolean {
    return node.provider.adapter === "http-tool" && node.op === "tool";
  }

  async execute(ctx: AdapterContext): Promise<AdapterResult> {
    const { node, signal } = ctx;
    const cfg = node.config as Record<string, any>;
    const url = String(cfg.url ?? "");
    const method = String(cfg.method ?? "GET").toUpperCase();

    const pinnedIp = await this.resolveSafeIp(url);
    const parsed = new URL(url);

    if (!["GET", "POST"].includes(method)) {
      throw new AdapterError(`Unsupported method "${method}".`, "BAD_INPUT");
    }

    const res = await requestPinned(parsed, pinnedIp, {
      method,
      headers: { accept: "application/json, text/plain" },
      body: method === "POST" ? JSON.stringify(cfg.body ?? {}) : undefined,
      signal,
      maxBytes: MAX_RESPONSE_BYTES,
    });

    const text = new TextDecoder().decode(res.buf);
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* keep as text */
    }
    return {
      output: { type: "tool-response", status: res.status, body },
      usage: emptyUsage("none"),
      provenance: "live",
    };
  }

  /**
   * Validate the URL and return a single public IP address to pin the
   * connection to. Resolving once here and connecting to that exact address
   * closes the DNS time-of-check/time-of-use (rebinding) gap.
   */
  async resolveSafeIp(raw: string): Promise<string> {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new AdapterError(`Invalid tool URL "${raw}".`, "BAD_INPUT");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new AdapterError("Only http(s) URLs are allowed.", "SSRF_BLOCKED");
    }
    if (url.username || url.password) {
      throw new AdapterError("Credentials in URL are not allowed.", "SSRF_BLOCKED");
    }
    const allow = parseAllowlist();
    if (!allow.includes(url.hostname.toLowerCase())) {
      throw new AdapterError(
        `Host "${url.hostname}" is not in TOOL_ALLOWLIST.`,
        "HOST_NOT_ALLOWED",
      );
    }

    // IP literal: validate directly and pin it.
    const literal = net.isIP(url.hostname)
      ? url.hostname
      // URL wraps IPv6 literals in brackets.
      : net.isIP(url.hostname.replace(/^\[|\]$/g, ""))
        ? url.hostname.replace(/^\[|\]$/g, "")
        : "";
    if (literal) {
      if (isPrivateIp(literal)) {
        throw new AdapterError("Target IP is in a blocked range.", "SSRF_BLOCKED");
      }
      return literal;
    }

    let addrs: { address: string }[];
    try {
      addrs = await lookup(url.hostname, { all: true });
    } catch {
      throw new AdapterError(`Could not resolve host "${url.hostname}".`, "DNS_ERROR");
    }
    if (addrs.length === 0) {
      throw new AdapterError(`Could not resolve host "${url.hostname}".`, "DNS_ERROR");
    }
    // Every resolved address must be public; reject the whole request otherwise.
    for (const a of addrs) {
      if (isPrivateIp(a.address)) {
        throw new AdapterError("Resolved IP is in a blocked range.", "SSRF_BLOCKED");
      }
    }
    // Pin to the first validated address.
    return addrs[0].address;
  }
}
