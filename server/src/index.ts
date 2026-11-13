import express from "express";
import cors from "cors";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { api } from "./api/routes.js";
import { initTelemetry, shutdownTelemetry } from "./telemetry/otel.js";
import { log } from "./telemetry/logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 4000);
// Bind to loopback by default so an unauthenticated local instance is not
// reachable from the network. Set HOST=0.0.0.0 to expose it (do so only with
// API_AUTH_TOKEN set and CORS_ORIGINS configured).
const HOST = process.env.HOST ?? "127.0.0.1";

// Optional shared-secret auth. When API_AUTH_TOKEN is set, every /api request
// (except health) must present it via `Authorization: Bearer <token>` or the
// `x-api-key` header. Unset = open mode, intended for local development only.
const AUTH_TOKEN = process.env.API_AUTH_TOKEN?.trim() || "";

// CORS allowlist. Empty = no cross-origin requests permitted (same-origin only,
// which is how the bundled frontend and the dev proxy talk to the API).
const CORS_ORIGINS = (process.env.CORS_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const app = express();
app.disable("x-powered-by");
app.use(
  cors({
    origin(origin, cb) {
      // Same-origin / non-browser requests send no Origin header — always allow.
      if (!origin) return cb(null, true);
      if (CORS_ORIGINS.includes(origin)) return cb(null, true);
      // Not an error (that would leak CORS headers); just withhold them.
      return cb(null, false);
    },
    credentials: CORS_ORIGINS.length > 0,
  }),
);
app.use(express.json({ limit: "256kb" }));

// Minimal in-memory rate limiter (per-IP sliding window) for API routes.
const WINDOW_MS = 60_000;
const MAX_REQ = Number(process.env.RATE_LIMIT ?? 600);
// Cap on distinct tracked clients so the map cannot grow without bound under a
// stream of unique source IPs.
const MAX_CLIENTS = Number(process.env.RATE_LIMIT_MAX_CLIENTS ?? 10_000);
const hits = new Map<string, number[]>();

// Periodically evict clients whose window has fully expired so idle entries do
// not accumulate. unref() keeps this timer from holding the process open.
const sweep = setInterval(() => {
  const cutoff = Date.now() - WINDOW_MS;
  for (const [ip, times] of hits) {
    if (times.length === 0 || times[times.length - 1] <= cutoff) hits.delete(ip);
  }
}, WINDOW_MS);
sweep.unref?.();

app.use("/api", (req, res, next) => {
  const ip = req.ip ?? "unknown";
  const now = Date.now();
  const arr = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  arr.push(now);
  // Hard cap on tracked clients: once full, drop the oldest-touched entry
  // rather than letting the map grow unbounded.
  if (!hits.has(ip) && hits.size >= MAX_CLIENTS) {
    const oldest = hits.keys().next().value;
    if (oldest !== undefined) hits.delete(oldest);
  }
  hits.set(ip, arr);
  if (arr.length > MAX_REQ) {
    return res.status(429).json({ error: { code: "RATE_LIMITED", message: "Too many requests." } });
  }
  next();
});

// Authentication gate (no-op when API_AUTH_TOKEN is unset). Health stays open
// so liveness probes work without credentials.
app.use("/api", (req, res, next) => {
  if (!AUTH_TOKEN || req.path === "/health") return next();
  const header = req.get("authorization") ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const provided = bearer || (req.get("x-api-key") ?? "").trim();
  if (provided && timingSafeEqualStr(provided, AUTH_TOKEN)) return next();
  return res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Missing or invalid API token." } });
});

app.use("/api", api);

// Serve the built frontend if present (production single-origin mode).
const webDist = join(__dirname, "../../web/dist");
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    res.sendFile(join(webDist, "index.html"));
  });
}

// Safe error handler (never leak stack traces / secrets).
app.use(
  (err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    log("error", "unhandled", { error: err.message });
    res.status(500).json({ error: { code: "INTERNAL", message: "Internal server error." } });
  },
);

/** Constant-time string comparison to avoid leaking the token via timing. */
function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function main() {
  await initTelemetry();
  const server = app.listen(PORT, HOST, () => {
    log("info", "server.listening", { host: HOST, port: PORT, url: `http://${HOST}:${PORT}` });
    const exposed = HOST !== "127.0.0.1" && HOST !== "localhost" && HOST !== "::1";
    if (exposed && !AUTH_TOKEN) {
      log("warn", "server.insecure", {
        message:
          "Bound to a non-loopback address without API_AUTH_TOKEN. Anyone who can reach this port can run workflows and read/delete runs.",
      });
    }
    // eslint-disable-next-line no-console
    console.log(`\n  SYNAPSE backend ready → http://${HOST}:${PORT}\n`);
  });

  const shutdown = async () => {
    clearInterval(sweep);
    server.close();
    await shutdownTelemetry();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Fatal startup error:", err);
  process.exit(1);
});

export { app };
