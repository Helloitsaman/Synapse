/**
 * Minimal, dependency-free `.env` loader (side effect on import).
 *
 * Import this FIRST in the server entrypoint — before any module that reads
 * environment variables at load time — so values from the file are in place.
 *
 * Precedence: variables ALREADY present in the real environment (exported in the
 * launching shell, or set by the OS/CI) always WIN. The file only fills in what
 * is unset. This keeps the shell as the authoritative, documented path while
 * making `server/.env` work as `.env.example` suggests.
 *
 * Security: values are NEVER logged (only the count of loaded keys and their
 * names, never their values). A missing file is not an error.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Candidate file: SYNAPSE_ENV_FILE if set, else server/.env. */
function envFilePath(): string {
  if (process.env.SYNAPSE_ENV_FILE) return resolve(process.env.SYNAPSE_ENV_FILE);
  return join(__dirname, "../.env"); // server/.env (this file lives in server/src)
}

/** Parse a dotenv line into [key, value], or null to skip. */
function parseLine(line: string): [string, string] | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const withoutExport = trimmed.replace(/^export\s+/, "");
  const eq = withoutExport.indexOf("=");
  if (eq <= 0) return null;
  const key = withoutExport.slice(0, eq).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return null;
  let value = withoutExport.slice(eq + 1).trim();
  // Strip matching surrounding quotes; leave inner content verbatim.
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  } else {
    // For unquoted values, drop a trailing inline comment.
    const hash = value.indexOf(" #");
    if (hash >= 0) value = value.slice(0, hash).trim();
  }
  return [key, value];
}

export function loadDotenv(): { file: string; loaded: string[] } {
  const file = envFilePath();
  if (!existsSync(file)) return { file, loaded: [] };
  const loaded: string[] = [];
  let content = "";
  try {
    content = readFileSync(file, "utf8");
  } catch {
    return { file, loaded: [] };
  }
  for (const raw of content.split(/\r?\n/)) {
    const parsed = parseLine(raw);
    if (!parsed) continue;
    const [key, value] = parsed;
    if (process.env[key] === undefined) {
      process.env[key] = value;
      loaded.push(key);
    }
  }
  return { file, loaded };
}

// Load on import. Report names only (never values).
const result = loadDotenv();
if (result.loaded.length > 0) {
  // eslint-disable-next-line no-console
  console.log(`  Loaded ${result.loaded.length} var(s) from ${result.file}: ${result.loaded.join(", ")}`);
}
