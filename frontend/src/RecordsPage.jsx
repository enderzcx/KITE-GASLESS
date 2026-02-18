import { useEffect, useState } from 'react';

function RecordsPage({ onBack }) {
  const [records, setRecords] = useState([]);
  const [status, setStatus] = useState('');

  const loadRecords = async () => {
    try {
      setStatus('Loading...');
      const res = await fetch('/api/records');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = await res.text();
      const data = raw ? JSON.parse(raw) : [];
      setRecords(Array.isArray(data) ? data : []);
      setStatus('');
    } catch (err) {
      setStatus(`Failed to load records: ${err.message}`);
    }
  };

  useEffect(() => {
    loadRecords();
  }, []);

  return (
    <div className="transfer-container records-page">
      <div className="top-entry">
        {onBack && (
          <button className="link-btn" onClick={onBack}>
            Back
          </button>
        )}
        <button className="link-btn" onClick={loadRecords}>
          Refresh Records
        </button>
      </div>

      <h1>Transfer Records</h1>
      {status && <div className="request-error">{status}</div>}

      <div className="vault-card">
        <div className="records-head">
          <span>Time</span>
          <span>Type</span>
          <span>Amount</span>
          <span>Token</span>
          <span>To</span>
          <span>Status</span>
          <span>Tx Hash</span>
        </div>

        {records.length === 0 && <div className="result-row">No records yet.</div>}
        {records.map((record, index) => (
          <div className="records-row" key={`record-${index}`}>
            <span className="records-cell">{record.time}</span>
            <span className="records-cell">{record.type}</span>
            <span className="records-cell">{record.amount}</span>
            <span className="records-cell">{record.token}</span>
            <span className="records-cell hash">{record.recipient}</span>
            <span className={`records-cell status ${record.status}`}>{record.status}</span>
            <span className="records-cell hash">
              {record.txHash ? (
                <a
                  className="tx-link"
                  href={`https://testnet.kitescan.ai/tx/${record.txHash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {record.txHash}
                </a>
              ) : (
                '-'
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default RecordsPage;
