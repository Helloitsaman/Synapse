import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Isolate persistence to a throwaway temp dir so tests never touch real data.
process.env.SYNAPSE_DATA_DIR = mkdtempSync(join(tmpdir(), "synapse-test-"));
