import { useEffect, useMemo, useState } from 'react';
import { ethers } from 'ethers';

const GOLDSKY_ENDPOINT =
  import.meta.env.VITE_KITECLAW_GOLDSKY_ENDPOINT ||
  'https://api.goldsky.com/api/public/project_cmlrmfrtks90001wg8goma8pv/subgraphs/kk/1.0.0/gn';

const explorerTx = (txHash) => `https://testnet.kitescan.ai/tx/${txHash}`;

function OnChainPage({ onBack }) {
  const [txHashFilter, setTxHashFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [transfers, setTransfers] = useState([]);
  const [appRecords, setAppRecords] = useState([]);
  const [x402Requests, setX402Requests] = useState([]);
  const [lastQueryMode, setLastQueryMode] = useState('recent');
  const [identity, setIdentity] = useState(null);
  const [identityError, setIdentityError] = useState('');

  const loadTransfers = async () => {
    try {
      setLoading(true);
      setStatus('Loading on-chain confirmations...');
      const normalizedFilter = txHashFilter.trim().toLowerCase();
      const isTxHashFilter = normalizedFilter.startsWith('0x') && normalizedFilter.length === 66;
      const query = isTxHashFilter
        ? `
            {
              transfers(
                first: 20,
                where: { transactionHash: "${normalizedFilter}" },
                orderBy: blockTimestamp,
                orderDirection: desc
              ) {
                id
                from
                to
                value
                transactionHash
                blockNumber
                blockTimestamp
              }
            }
          `
        : `
            {
              transfers(first: 100, orderBy: blockTimestamp, orderDirection: desc) {
                id
                from
                to
                value
                transactionHash
                blockNumber
                blockTimestamp
              }
            }
          `;

      const res = await fetch(GOLDSKY_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query })
      });
      const json = await res.json();
      if (!res.ok || json.errors) {
        throw new Error(json?.errors?.[0]?.message || `HTTP ${res.status}`);
      }
      const rows = json?.data?.transfers || [];
      setTransfers(rows);
      setLastQueryMode(isTxHashFilter ? 'txhash' : 'recent');
      if (isTxHashFilter) {
        setStatus(`Loaded ${rows.length} transfer(s) by tx hash.`);
      } else if (!normalizedFilter) {
        setStatus(`Loaded ${Math.min(10, rows.length)} latest indexed transfer(s).`);
      } else {
        setStatus('Tx hash format is invalid. Please input a full 0x + 64 hex hash.');
        setTransfers([]);
      }
    } catch (err) {
      setStatus(`Failed to load Goldsky data: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const loadAppRecords = async () => {
    try {
      const res = await fetch('/api/records');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setAppRecords(Array.isArray(data) ? data : []);
    } catch {
      setAppRecords([]);
    }
  };

  const loadX402Requests = async () => {
    try {
      const normalizedFilter = txHashFilter.trim().toLowerCase();
      const isTxHash = normalizedFilter.startsWith('0x') && normalizedFilter.length === 66;
      const query = isTxHash ? `?txHash=${normalizedFilter}&limit=50` : '?limit=50';
      const res = await fetch(`/api/x402/requests${query}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setX402Requests(Array.isArray(data?.items) ? data.items : []);
    } catch {
      setX402Requests([]);
    }
  };

  const loadIdentity = async () => {
    try {
      const res = await fetch('/api/identity');
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.reason || `HTTP ${res.status}`);
      setIdentity(data.profile || null);
      setIdentityError('');
    } catch (error) {
      setIdentity(null);
      setIdentityError(error.message || 'identity load failed');
    }
  };

  useEffect(() => {
    loadTransfers();
    loadAppRecords();
    loadX402Requests();
    loadIdentity();
  }, []);

  const normalizedTxHash = txHashFilter.trim().toLowerCase();
  const isTxHashFilter = normalizedTxHash.startsWith('0x') && normalizedTxHash.length === 66;
  const matchedAppRecord = useMemo(
    () => appRecords.find((r) => (r.txHash || '').toLowerCase() === normalizedTxHash),
    [appRecords, normalizedTxHash]
  );

  const filtered = useMemo(() => {
    if (lastQueryMode === 'txhash') return transfers;
    return transfers.slice(0, 10);
  }, [transfers, lastQueryMode]);

  const rows = useMemo(() => {
    const onChainRows = filtered.map((item) => ({ ...item, source: 'On-chain (Goldsky)' }));
    if (!isTxHashFilter || !matchedAppRecord) return onChainRows;

    let amountRaw = '';
    try {
      amountRaw = ethers.parseUnits(String(matchedAppRecord.amount || '0'), 18).toString();
    } catch {
      amountRaw = String(matchedAppRecord.amount || '');
    }

    const appRow = {
      id: `app-${matchedAppRecord.txHash}`,
      from: '-',
      to: matchedAppRecord.recipient || '-',
      value: amountRaw,
      transactionHash: matchedAppRecord.txHash,
      blockNumber: '-',
      blockTimestamp: matchedAppRecord.time
        ? String(Math.floor(new Date(matchedAppRecord.time).getTime() / 1000))
        : '0',
      source: 'App Record'
    };
    return [appRow, ...onChainRows];
  }, [filtered, isTxHashFilter, matchedAppRecord]);

  const reconciliation = useMemo(() => {
    if (!isTxHashFilter) {
      return {
        appRecordFound: false,
        onChainRecordFound: false,
        amountAddressMatch: false
      };
    }

    const onChain = transfers[0];
    const appFound = Boolean(matchedAppRecord);
    const chainFound = Boolean(onChain);
    let amountMatch = false;
    let addressMatch = false;

    if (appFound && chainFound) {
      try {
        const appRaw = ethers.parseUnits(String(matchedAppRecord.amount || '0'), 18).toString();
        amountMatch = appRaw === String(onChain.value);
      } catch {
        amountMatch = false;
      }
      addressMatch =
        (matchedAppRecord.recipient || '').toLowerCase() === String(onChain.to || '').toLowerCase();
    }

    return {
      appRecordFound: appFound,
      onChainRecordFound: chainFound,
      amountAddressMatch: appFound && chainFound && amountMatch && addressMatch
    };
  }, [isTxHashFilter, transfers, matchedAppRecord]);

  const handleFilterKeyDown = (event) => {
    if (event.key === 'Enter') {
      loadTransfers();
      loadX402Requests();
    }
  };

  const displayedX402Requests = useMemo(() => {
    const normalizedFilter = txHashFilter.trim().toLowerCase();
    const isTxHash = normalizedFilter.startsWith('0x') && normalizedFilter.length === 66;
    if (isTxHash) {
      return x402Requests.filter((item) => String(item.paymentTxHash || '').toLowerCase() === normalizedFilter);
    }
    return x402Requests.slice(0, 10);
  }, [txHashFilter, x402Requests]);

  const refreshAll = async () => {
    await Promise.all([loadTransfers(), loadX402Requests(), loadAppRecords()]);
  };

  return (
    <div className="transfer-container records-page">
      <div className="top-entry">
        {onBack && (
          <button className="link-btn" onClick={onBack}>
            Back to Request Page
          </button>
        )}
        <button className="link-btn" onClick={loadTransfers} disabled={loading}>
          {loading ? 'Refreshing...' : 'Refresh On-chain Data'}
        </button>
        <button className="link-btn" onClick={refreshAll} disabled={loading}>
          {loading ? 'Refreshing...' : 'Refresh All'}
        </button>
      </div>

      <h1>On-chain Confirmation</h1>

      <div className="vault-card">
        <div className="result-row">
          <span className="label">Goldsky Endpoint:</span>
          <span className="value hash">{GOLDSKY_ENDPOINT}</span>
        </div>
        <div className="vault-actions">
          <div className="vault-input">
            <label>Query by Tx Hash (optional)</label>
            <input
              type="text"
              value={txHashFilter}
              onChange={(e) => setTxHashFilter(e.target.value)}
              onKeyDown={handleFilterKeyDown}
              placeholder="0x... full transaction hash"
            />
          </div>
        </div>
        {status && <div className="request-error">{status}</div>}
      </div>

      <div className="vault-card">
        <h2>Verifiable Agent Identity</h2>
        {identityError && <div className="request-error">identity error: {identityError}</div>}
        {!identityError && !identity?.available && (
          <div className="result-row">
            <span className="label">Status:</span>
            <span className="value">not configured ({identity?.reason || 'unknown'})</span>
          </div>
        )}
        {identity?.available && (
          <>
            <div className="result-row">
              <span className="label">Agent ID:</span>
              <span className="value">{identity?.configured?.agentId || '-'}</span>
            </div>
            <div className="result-row">
              <span className="label">Registry:</span>
              <span className="value hash">{identity?.configured?.registry || '-'}</span>
            </div>
            <div className="result-row">
              <span className="label">Agent Wallet:</span>
              <span className="value hash">{identity?.agentWallet || '-'}</span>
            </div>
          </>
        )}
      </div>

      {isTxHashFilter && (
        <div className="vault-card">
          <h2>Reconciliation Card</h2>
          <div className="result-row">
            <span className="label">app record found:</span>
            <span className="value">{String(reconciliation.appRecordFound)}</span>
          </div>
          <div className="result-row">
            <span className="label">on-chain record found:</span>
            <span className="value">{String(reconciliation.onChainRecordFound)}</span>
          </div>
          <div className="result-row">
            <span className="label">amount/address match:</span>
            <span className="value">{String(reconciliation.amountAddressMatch)}</span>
          </div>
        </div>
      )}

      <div className="vault-card">
        <h2>x402 Payment Mapping</h2>
        <div className="records-head onchain-head">
          <span>Action</span>
          <span>Agent ID</span>
          <span>Request ID</span>
          <span>Payer</span>
          <span>Amount</span>
          <span>Status</span>
          <span>Paid At</span>
          <span>Payment Tx Hash</span>
        </div>

        {displayedX402Requests.length === 0 && (
          <div className="result-row">No x402 mappings match your filter.</div>
        )}

        {displayedX402Requests.map((item) => (
          <div className="records-row onchain-row" key={item.requestId}>
            <span className="records-cell">{item.action || '-'}</span>
            <span className="records-cell">
              {item?.identity?.agentId || item?.agentId || identity?.configured?.agentId || '-'}
            </span>
            <span className="records-cell hash">{item.requestId}</span>
            <span className="records-cell hash">{item.payer || '-'}</span>
            <span className="records-cell">{item.amount || '-'}</span>
            <span className="records-cell">{item.status || '-'}</span>
            <span className="records-cell">
              {item.paidAt ? new Date(Number(item.paidAt)).toISOString() : '-'}
            </span>
            <span className="records-cell hash">
              {item.paymentTxHash ? (
                <a className="tx-link" href={explorerTx(item.paymentTxHash)} target="_blank" rel="noreferrer">
                  {item.paymentTxHash}
                </a>
              ) : (
                '-'
              )}
            </span>
          </div>
        ))}
      </div>

      <div className="vault-card">
        <div className="records-head onchain-head">
          <span>Source</span>
          <span>Time (UTC)</span>
          <span>From</span>
          <span>To</span>
          <span>Amount (raw)</span>
          <span>Block</span>
          <span>Tx Hash</span>
        </div>

        {rows.length === 0 && (
          <div className="result-row">No indexed transfers match your filter.</div>
        )}

        {rows.map((item) => (
          <div className="records-row onchain-row" key={item.id}>
            <span className="records-cell source-cell">Source: {item.source}</span>
            <span className="records-cell">
              {item.blockTimestamp === '0' || item.blockTimestamp === 0
                ? '-'
                : new Date(Number(item.blockTimestamp) * 1000).toISOString()}
            </span>
            <span className="records-cell hash">{item.from}</span>
            <span className="records-cell hash">{item.to}</span>
            <span className="records-cell">{item.value}</span>
            <span className="records-cell">{item.blockNumber}</span>
            <span className="records-cell hash">
              <a className="tx-link" href={explorerTx(item.transactionHash)} target="_blank" rel="noreferrer">
                {item.transactionHash}
              </a>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default OnChainPage;
