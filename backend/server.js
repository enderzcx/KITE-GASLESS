import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';

const app = express();
const PORT = process.env.PORT || 3001;
const dataPath = path.resolve('data', 'records.json');

app.use(cors());
app.use(express.json());

function readRecords() {
  if (!fs.existsSync(dataPath)) {
    fs.mkdirSync(path.dirname(dataPath), { recursive: true });
    fs.writeFileSync(dataPath, '[]', 'utf8');
  }
  const raw = fs.readFileSync(dataPath, 'utf8');
  const cleaned = raw.replace(/^﻿/, '');
  return JSON.parse(cleaned || '[]');
}

function writeRecords(records) {
  fs.writeFileSync(dataPath, JSON.stringify(records, null, 2), 'utf8');
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
    status: record.status || 'unknown'
  };
  records.unshift(normalized);
  writeRecords(records);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
});
