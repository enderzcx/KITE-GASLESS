# KiteClaw Agent Network (Prototype)

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![Version](https://img.shields.io/badge/version-v1.9.0-blue)](#release)

KiteClaw is an auditable Agent Network prototype on Kite Testnet.
It focuses on one verifiable loop:

`identity -> XMTP coordination -> x402 settlement -> result -> decision`

with downloadable evidence for third-party replay.

## Release

Current version: `v1.9.0`

Latest release tag:
- `v1.9.0` -> `f81a698271853b1cef55589fe2a4ad1bcf320876`

## Scope

- Stage: prototype (not a generalized production platform yet).
- Core value: auditable multi-agent execution, not chat-only demos.
- Stack anchors:
  - `ERC8004`: identity and agent trust metadata
  - `XMTP`: task transport and runtime event timeline
  - `x402`: payment challenge/proof and on-chain settlement evidence
- Web demo focus:
  - execution visualization
  - evidence download
  - audit history

## Public Demo

- URL: `https://kiteclaw.duckdns.org`
- Current web routes:
  - `/` Agent Network demo and run flow
  - `/history` audit history with evidence/receipt download

Note:
- Historical docs or screenshots may mention `/market`, `/trace/:requestId`, `/ops`.
- The current tracked web app uses `/` and `/history`.

## XMTP Audit Model

XMTP payload is off-chain, so auditability is done by binding transport evidence to x402 settlement evidence under the same `traceId/requestId`.

What is recorded:
- task-level ids: `traceId`, `requestId`, `taskId`
- routing: `fromAgentId`, `toAgentId`, `channel`, `hopIndex`
- transport refs: `conversationId`, `messageId`, timestamps
- settlement refs: `payment.requestId`, `txHash`, `block`, `status`, `explorer`, `verifiedAt`

Where to inspect:
- `GET /api/xmtp/events`
- `GET /api/demo/trace/:traceId`
- `GET /api/evidence/export?traceId=...`

Since `v1.9.0`, exported evidence now includes XMTP hop timeline:
- `evidence.xmtp.total`
- `evidence.xmtp.hops[]` (contains `conversationId/messageId/hopIndex/...`)
- `evidence.xmtp.hops[].hopDigest` (per-hop digest for tamper checks)
- `evidence.xmtp.digest` (global digest over normalized hop timeline)

Current build exports schema-versioned and digest-bound evidence:
- `evidence.schemaVersion`
- `evidence.digest` (package-level digest)
- `evidence.integrity.digestInput` (deterministic digest input)
- `evidence.xmtp.integrity.hopFields` (XMTP hop digest field set)

Quick verify:

```bash
curl -sS "https://kiteclaw.duckdns.org/api/evidence/export?traceId=<TRACE_ID>" \
| jq '.evidence.xmtp | {total, firstHop: (.hops[0] | {traceId,requestId,conversationId,messageId,hopIndex,kind})}'
```

Digest verify (package + XMTP timeline):

```bash
curl -sS "https://kiteclaw.duckdns.org/api/evidence/export?traceId=<TRACE_ID>" > /tmp/evidence.json

node - <<'NODE'
const fs = require('fs');
const crypto = require('crypto');

function stableSerialize(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableSerialize(item)).join(',')}]`;
  const entries = Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableSerialize(v)}`).join(',')}}`;
}
function sha256Stable(value) {
  return crypto.createHash('sha256').update(stableSerialize(value), 'utf8').digest('hex');
}
function pickHopMaterial(hop) {
  return {
    id: hop.id || '',
    createdAt: hop.createdAt || '',
    runtimeName: hop.runtimeName || '',
    direction: (hop.direction || '').toLowerCase(),
    kind: (hop.kind || '').toLowerCase(),
    fromAgentId: hop.fromAgentId || '',
    toAgentId: hop.toAgentId || '',
    channel: hop.channel || '',
    hopIndex: Number.isFinite(Number(hop.hopIndex)) ? Number(hop.hopIndex) : null,
    traceId: hop.traceId || '',
    requestId: hop.requestId || '',
    taskId: hop.taskId || '',
    conversationId: hop.conversationId || '',
    messageId: hop.messageId || '',
    status: (hop.status || '').toLowerCase(),
    phase: (hop.phase || '').toLowerCase(),
    detail: hop.detail || '',
    resultSummary: hop.resultSummary || '',
    error: hop.error || '',
    payment: hop.payment
      ? {
          mode: (hop.payment.mode || '').toLowerCase(),
          requestId: hop.payment.requestId || '',
          txHash: hop.payment.txHash || '',
          block: Number.isFinite(Number(hop.payment.block)) ? Number(hop.payment.block) : null,
          status: (hop.payment.status || '').toLowerCase(),
          explorer: hop.payment.explorer || '',
          verifiedAt: hop.payment.verifiedAt || ''
        }
      : null,
    receiptRef: hop.receiptRef
      ? {
          requestId: hop.receiptRef.requestId || '',
          txHash: hop.receiptRef.txHash || '',
          block: Number.isFinite(Number(hop.receiptRef.block)) ? Number(hop.receiptRef.block) : null,
          status: (hop.receiptRef.status || '').toLowerCase(),
          explorer: hop.receiptRef.explorer || '',
          verifiedAt: hop.receiptRef.verifiedAt || '',
          endpoint: hop.receiptRef.endpoint || ''
        }
      : null
  };
}

const payload = JSON.parse(fs.readFileSync('/tmp/evidence.json', 'utf8'));
const e = payload.evidence || {};
const x = e.xmtp || {};

const xmtpInput = {
  scope: 'xmtp-hop-core-v1',
  traceId: String(x.integrity?.digestInput?.traceId || e.traceId || ''),
  requestId: String(x.integrity?.digestInput?.requestId || ''),
  taskId: String(x.integrity?.digestInput?.taskId || ''),
  total: Number(x.total || 0),
  hops: Array.isArray(x.hops) ? x.hops.map((h) => pickHopMaterial(h)) : []
};
const xmtpDigest = sha256Stable(xmtpInput);
const evidenceDigest = sha256Stable(e.integrity?.digestInput || {});

console.log({
  schemaVersion: e.schemaVersion || '',
  xmtpDigest,
  xmtpDigestExported: x.digest?.value || '',
  xmtpDigestMatch: xmtpDigest === String(x.digest?.value || ''),
  evidenceDigest,
  evidenceDigestExported: e.digest?.value || '',
  evidenceDigestMatch: evidenceDigest === String(e.digest?.value || '')
});
NODE
```

## Core API Surface

Workflow and evidence:
- `POST /api/workflow/btc-price/run`
- `POST /api/workflow/risk-score/run`
- `POST /api/workflow/info/run`
- `POST /api/workflow/hyperliquid-order/run`
- `GET /api/demo/trace/:traceId`
- `GET /api/demo/trace-by-request/:requestId`
- `GET /api/evidence/export?traceId=...`
- `GET /api/receipt/:requestId`
- `GET /api/x402/mapping/latest`
- `GET /api/x402/requests`

XMTP and network orchestration:
- `GET /api/xmtp/status`
- `POST /api/xmtp/start`
- `POST /api/xmtp/stop`
- `POST /api/xmtp/groups/ensure`
- `POST /api/xmtp/groups/send`
- `GET /api/xmtp/events`
- `POST /api/xmtp/dm/send`
- `POST /api/network/tasks/run`
- `POST /api/network/demo/router-info-technical/run`
- `GET /api/network/commands`
- `POST /api/network/commands`

Analysis and execution:
- `POST /api/analysis/info/run`
- `POST /api/analysis/technical/run`
- `GET /api/message-providers/status`
- `GET /api/agent001/hyperliquid/status`
- `POST /api/agent001/hyperliquid/order`
- `GET /api/hyperliquid/testnet/health`
- `POST /api/hyperliquid/testnet/order`

## Local Quick Start

Prerequisites:
- Node.js 20+
- npm

### 1) Backend

```bash
cd backend
npm install
cp .env.example .env
npm start
```

Backend default URL: `http://localhost:3001`

### 2) Web App (Next.js)

```bash
cd agent-network
npm install
npm run dev
```

Web default URL: `http://localhost:3000`

Optional web env (`agent-network/.env.local`):

```env
NEXT_PUBLIC_BACKEND_URL=http://127.0.0.1:3001
```

## Production Deployment (Nginx + PM2)

This repo ships deployment scripts for:
- backend (`kiteclaw-backend`)
- web app (`kiteclaw-agent-network`)

### 1) Prepare server

```bash
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx
sudo npm i -g pm2
```

Install Node.js 20 if needed:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

### 2) Deploy

```bash
export REPO_URL=https://github.com/enderzcx/KITE-GASLESS.git
export BRANCH=main
bash deploy/scripts/deploy.sh
```

Before first deploy, create backend env:

```bash
cp backend/.env.production.example backend/.env
bash deploy/scripts/validate-prod-env.sh backend/.env
```

### 3) Nginx config

Render template:

```bash
sed 's/__SERVER_NAME__/your-subdomain.duckdns.org/g' deploy/nginx/kiteclaw.conf | sudo tee /etc/nginx/conf.d/kiteclaw.conf >/dev/null
sudo nginx -t
sudo systemctl reload nginx
```

If your distro uses `sites-available/sites-enabled`, adapt the target paths accordingly.

### 4) HTTPS

```bash
sudo certbot --nginx -d your-subdomain.duckdns.org
```

### 5) Smoke checks

```bash
curl -sS https://your-subdomain.duckdns.org/api/chat/agent/health
curl -sS https://your-subdomain.duckdns.org/api/xmtp/status
```

### 6) Backup

```bash
bash deploy/scripts/backup-data.sh
```

## AA-v2 Notes

`aa-v2` contains the account abstraction implementation used by this project for:
- one-time authorization
- constrained session execution
- repeated payments without repeated wallet popups

Session payment policy (must-read):
- `backend/docs/aa-session-policy.md`
- Default posture: `KITE_ALLOW_BACKEND_USEROP_SIGN=0`, `KITE_ALLOW_EOA_RELAY_FALLBACK=0`

Useful scripts:
- `npm --prefix backend run aa:ensure`
- `npm --prefix backend run aa:session:router`
- `npm --prefix backend run aa:upgrade`

## Repository Layout

```text
KITE GASLESS/
|- aa-v2/         # AA contracts and scripts
|- agent-network/ # Next.js web app
|- backend/       # Express API, XMTP runtimes, x402, evidence
|- deploy/        # Nginx/PM2/deploy/backup scripts
|- README.md
|- LICENSE
```

## License

MIT License. See `LICENSE`.
