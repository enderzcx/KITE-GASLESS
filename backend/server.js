import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const app = express();
const PORT = process.env.PORT || 3001;
const dataPath = path.resolve('data', 'records.json');
const x402Path = path.resolve('data', 'x402_requests.json');

const SETTLEMENT_TOKEN =
  process.env.KITE_SETTLEMENT_TOKEN || '0x0fF5393387ad2f9f691FD6Fd28e07E3969e27e63';
const MERCHANT_ADDRESS =
  process.env.KITE_MERCHANT_ADDRESS || '0x6D705b93F0Da7DC26e46cB39Decc3baA4fb4dd29';
const X402_PRICE = process.env.X402_PRICE || '0.05';
const X402_TTL_MS = 10 * 60 * 1000;

app.use(cors());
app.use(express.json());

function ensureJsonFile(targetPath) {
  if (!fs.existsSync(targetPath)) {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, '[]', 'utf8');
  }
}

function readJsonArray(targetPath) {
  ensureJsonFile(targetPath);
  const raw = fs.readFileSync(targetPath, 'utf8');
  const cleaned = raw.replace(/^\uFEFF/, '');
  return JSON.parse(cleaned || '[]');
}

function writeJsonArray(targetPath, records) {
  fs.writeFileSync(targetPath, JSON.stringify(records, null, 2), 'utf8');
}

function readRecords() {
  return readJsonArray(dataPath);
}

function writeRecords(records) {
  writeJsonArray(dataPath, records);
}

function readX402Requests() {
  return readJsonArray(x402Path);
}

function writeX402Requests(records) {
  writeJsonArray(x402Path, records);
}

function normalizeAddress(address = '') {
  return String(address).trim().toLowerCase();
}

function createX402Request(query, payer) {
  const now = Date.now();
  const requestId = `x402_${now}_${crypto.randomBytes(4).toString('hex')}`;
  return {
    requestId,
    query,
    payer,
    amount: X402_PRICE,
    tokenAddress: SETTLEMENT_TOKEN,
    recipient: MERCHANT_ADDRESS,
    status: 'pending',
    createdAt: now,
    expiresAt: now + X402_TTL_MS
  };
}

function buildPaymentRequiredResponse(reqItem, reason = '') {
  return {
    error: 'payment_required',
    reason,
    x402: {
      version: '0.1-demo',
      requestId: reqItem.requestId,
      expiresAt: reqItem.expiresAt,
      accepts: [
        {
          scheme: 'kite-aa-erc20',
          network: 'kite_testnet',
          tokenAddress: reqItem.tokenAddress,
          amount: reqItem.amount,
          recipient: reqItem.recipient,
          decimals: 18
        }
      ]
    }
  };
}

function validatePaymentProof(reqItem, paymentProof) {
  if (!paymentProof || typeof paymentProof !== 'object') {
    return 'missing payment proof';
  }
  if (!paymentProof.txHash) {
    return 'missing txHash';
  }
  if (paymentProof.requestId !== reqItem.requestId) {
    return 'requestId mismatch';
  }
  if (normalizeAddress(paymentProof.tokenAddress) !== normalizeAddress(reqItem.tokenAddress)) {
    return 'token mismatch';
  }
  if (normalizeAddress(paymentProof.recipient) !== normalizeAddress(reqItem.recipient)) {
    return 'recipient mismatch';
  }
  if (String(paymentProof.amount) !== String(reqItem.amount)) {
    return 'amount mismatch';
  }
  return '';
}

function verifyProofByLocalRecord(reqItem, paymentProof) {
  const records = readRecords();
  const found = records.find((item) => {
    return (
      normalizeAddress(item.txHash) === normalizeAddress(paymentProof.txHash) &&
      normalizeAddress(item.token) === normalizeAddress(reqItem.tokenAddress) &&
      normalizeAddress(item.recipient) === normalizeAddress(reqItem.recipient) &&
      String(item.amount) === String(reqItem.amount) &&
      String(item.status).toLowerCase() === 'success'
    );
  });
  return Boolean(found);
}

app.get('/api/records', (req, res) => {
  const records = readRecords();
  res.json(records);
});

app.post('/api/records', (req, res) => {
  const record = req.body || {};
  const records = readRecords();
  const normalized = {
    time: record.time || new Date().toISOString(),
    type: record.type || 'unknown',
    amount: record.amount || '',
    token: record.token || '',
    recipient: record.recipient || '',
    txHash: record.txHash || '',
    status: record.status || 'unknown',
    requestId: record.requestId || '',
    signerMode: record.signerMode || ''
  };
  records.unshift(normalized);
  writeRecords(records);
  res.json({ ok: true });
});

app.post('/api/x402/kol-score', (req, res) => {
  const body = req.body || {};
  const query = String(body.query || '').trim();
  const payer = String(body.payer || '').trim();
  const requestId = String(body.requestId || '').trim();
  const paymentProof = body.paymentProof;

  if (!query) {
    return res.status(400).json({ error: 'query is required' });
  }

  const requests = readX402Requests();

  if (!requestId || !paymentProof) {
    const reqItem = createX402Request(query, payer);
    requests.unshift(reqItem);
    writeX402Requests(requests);
    return res.status(402).json(buildPaymentRequiredResponse(reqItem));
  }

  const reqItem = requests.find((item) => item.requestId === requestId);
  if (!reqItem) {
    const fallbackItem = createX402Request(query, payer);
    requests.unshift(fallbackItem);
    writeX402Requests(requests);
    return res.status(402).json(buildPaymentRequiredResponse(fallbackItem, 'request not found, regenerated'));
  }

  if (Date.now() > reqItem.expiresAt) {
    reqItem.status = 'expired';
    writeX402Requests(requests);
    return res.status(402).json(buildPaymentRequiredResponse(reqItem, 'request expired'));
  }

  if (reqItem.status === 'paid') {
    return res.json({
      ok: true,
      mode: 'x402',
      requestId: reqItem.requestId,
      reused: true,
      result: {
        summary: 'KOL score report already unlocked',
        topKOLs: [
          { handle: '@alpha_kol', score: 91 },
          { handle: '@beta_growth', score: 88 },
          { handle: '@gamma_builder', score: 84 }
        ]
      }
    });
  }

  const validationError = validatePaymentProof(reqItem, paymentProof);
  if (validationError) {
    return res.status(402).json(buildPaymentRequiredResponse(reqItem, validationError));
  }

  const verified = verifyProofByLocalRecord(reqItem, paymentProof);
  if (!verified) {
    return res.status(402).json(buildPaymentRequiredResponse(reqItem, 'proof not found in transfer records'));
  }

  reqItem.status = 'paid';
  reqItem.paidAt = Date.now();
  reqItem.paymentTxHash = paymentProof.txHash;
  writeX402Requests(requests);

  return res.json({
    ok: true,
    mode: 'x402',
    requestId: reqItem.requestId,
    payment: {
      txHash: paymentProof.txHash,
      amount: reqItem.amount,
      tokenAddress: reqItem.tokenAddress,
      recipient: reqItem.recipient
    },
    result: {
      summary: 'KOL score report unlocked by x402 payment',
      topKOLs: [
        { handle: '@alpha_kol', score: 91 },
        { handle: '@beta_growth', score: 88 },
        { handle: '@gamma_builder', score: 84 }
      ]
    }
  });
});

app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
});
