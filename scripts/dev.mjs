// Runs the backend (tsx watch) and the Vite dev server together, no extra deps.
import { spawn } from "node:child_process";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";

function run(name, args, color) {
  const p = spawn(npm, args, { shell: true });
  const tag = `\x1b[${color}m[${name}]\x1b[0m`;
  p.stdout.on("data", (d) => process.stdout.write(prefix(tag, d)));
  p.stderr.on("data", (d) => process.stderr.write(prefix(tag, d)));
  p.on("exit", (code) => {
    console.log(`${tag} exited with code ${code}`);
    process.exit(code ?? 0);
  });
  return p;
}

function prefix(tag, buf) {
  return buf
    .toString()
    .split("\n")
    .filter(Boolean)
    .map((l) => `${tag} ${l}\n`)
    .join("");
}

console.log("Starting SYNAPSE: backend :4000  +  web :5173 (proxying /api → :4000)\n");
run("server", ["--prefix", "server", "run", "dev"], "35");
run("web", ["--prefix", "web", "run", "dev"], "36");
