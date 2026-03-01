import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(backendDir, "..");

function getArg(name, fallback = "") {
  const argv = process.argv.slice(2);
  const needle = `--${name}`;
  const idx = argv.indexOf(needle);
  if (idx >= 0 && argv[idx + 1]) return String(argv[idx + 1]).trim();
  return fallback;
}

function toInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(Math.round(n), max));
}

function findArtifacts(pilotRoot, rounds) {
  const dirs = fs
    .readdirSync(pilotRoot, { withFileTypes: true })
    .filter((item) => item.isDirectory())
    .map((item) => item.name)
    .sort((a, b) => Number(b) - Number(a))
    .slice(0, rounds);
  return dirs.map((name) => path.resolve(pilotRoot, name));
}

function runParityScript(hopLedgerDir, artifactDir) {
  const script = path.resolve(hopLedgerDir, "scripts", "digest-parity-kite.mjs");
  const run = spawnSync("node", [script, "--artifact", artifactDir], {
    cwd: hopLedgerDir,
    encoding: "utf8"
  });
  const stdout = String(run.stdout || "").trim();
  const stderr = String(run.stderr || "").trim();
  let payload = null;
  try {
    payload = stdout ? JSON.parse(stdout) : null;
  } catch {
    payload = null;
  }
  return {
    ok: run.status === 0 && payload?.ok === true,
    status: run.status,
    stdout,
    stderr,
    payload
  };
}

function main() {
  const explicitHopLedgerDir = getArg("hop-ledger-dir", "");
  const hopLedgerDir = path.resolve(repoRoot, explicitHopLedgerDir || "hop-ledger");
  if (!fs.existsSync(hopLedgerDir)) {
    throw new Error(`hop-ledger directory not found: ${hopLedgerDir}`);
  }
  const artifact = getArg("artifact", "");
  const rounds = toInt(getArg("rounds", "5"), 5, 1, 20);
  const pilotRoot = path.resolve(hopLedgerDir, "artifacts", "pilot");
  if (!fs.existsSync(pilotRoot)) {
    throw new Error(`pilot artifact root not found: ${pilotRoot}`);
  }

  const artifacts = artifact ? [path.resolve(hopLedgerDir, artifact)] : findArtifacts(pilotRoot, rounds);
  if (!artifacts.length) {
    throw new Error(`no artifacts found under ${pilotRoot}`);
  }

  const checks = artifacts.map((artifactDir) => {
    const result = runParityScript(hopLedgerDir, artifactDir);
    return {
      artifactDir,
      ok: result.ok,
      runStatus: result.status,
      requestId: String(result?.payload?.requestId || "").trim(),
      traceId: String(result?.payload?.traceId || "").trim(),
      checks: result?.payload?.checks || null,
      stderr: result.stderr || ""
    };
  });

  const output = {
    ok: checks.every((item) => item.ok),
    hopLedgerDir,
    total: checks.length,
    passed: checks.filter((item) => item.ok).length,
    checks
  };
  console.log(JSON.stringify(output, null, 2));
  if (!output.ok) process.exit(1);
}

main();
