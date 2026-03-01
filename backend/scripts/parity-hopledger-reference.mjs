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

function hasFlag(name) {
  const argv = process.argv.slice(2);
  return argv.includes(`--${name}`);
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

function runGitCommand(hopLedgerDir, args = []) {
  const run = spawnSync("git", args, {
    cwd: hopLedgerDir,
    encoding: "utf8"
  });
  return {
    ok: run.status === 0,
    status: run.status,
    stdout: String(run.stdout || "").trim(),
    stderr: String(run.stderr || "").trim()
  };
}

function collectHopLedgerGitMetadata(hopLedgerDir) {
  const branch = runGitCommand(hopLedgerDir, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const commit = runGitCommand(hopLedgerDir, ["rev-parse", "HEAD"]);
  const status = runGitCommand(hopLedgerDir, ["status", "--porcelain"]);

  return {
    branch: branch.stdout || "",
    commit: commit.stdout || "",
    shortCommit: commit.stdout ? String(commit.stdout).slice(0, 12) : "",
    dirty: Boolean(status.stdout),
    statusSummary: status.stdout || "",
    available: Boolean(branch.ok && commit.ok && status.ok),
    error:
      branch.ok && commit.ok && status.ok
        ? ""
        : String(branch.stderr || commit.stderr || status.stderr || "git metadata unavailable").trim()
  };
}

function main() {
  const explicitHopLedgerDir = getArg("hop-ledger-dir", "");
  const hopLedgerDir = path.resolve(repoRoot, explicitHopLedgerDir || "hop-ledger");
  const requireCleanHopLedger = hasFlag("require-clean-hop-ledger");
  const requireCleanBackend = hasFlag("require-clean-backend");
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

  const hopLedgerGit = collectHopLedgerGitMetadata(hopLedgerDir);
  const backendGit = collectHopLedgerGitMetadata(repoRoot);
  const parityOk = checks.every((item) => item.ok);
  const hopLedgerCleanOk = !requireCleanHopLedger || !hopLedgerGit.dirty;
  const backendCleanOk = !requireCleanBackend || !backendGit.dirty;
  const output = {
    ok: parityOk && hopLedgerCleanOk && backendCleanOk,
    hopLedgerDir,
    hopLedgerGit,
    backendGit,
    checksGate: {
      parityOk,
      requireCleanHopLedger,
      requireCleanBackend,
      hopLedgerCleanOk,
      backendCleanOk
    },
    total: checks.length,
    passed: checks.filter((item) => item.ok).length,
    checks
  };
  console.log(JSON.stringify(output, null, 2));
  if (!output.ok) process.exit(1);
}

main();
