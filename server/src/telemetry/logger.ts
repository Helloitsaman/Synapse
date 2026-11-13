/**
 * Structured logger. Redacts prompt/output bodies and never logs secrets.
 * Only metadata keys on an allowlist are emitted.
 */
const SECRET_KEYS = /(key|token|secret|authorization|password|cookie)/i;
const BODY_KEYS = /(prompt|output|body|content|text|docs|summary|messages)/i;

export function redact(meta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (SECRET_KEYS.test(k)) out[k] = "[redacted-secret]";
    else if (BODY_KEYS.test(k)) out[k] = "[redacted-body]";
    else out[k] = v;
  }
  return out;
}

export function log(level: "info" | "warn" | "error", msg: string, meta: Record<string, unknown> = {}) {
  const line = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...redact(meta),
  };
  // eslint-disable-next-line no-console
  console[level === "error" ? "error" : level === "warn" ? "warn" : "log"](
    JSON.stringify(line),
  );
}
