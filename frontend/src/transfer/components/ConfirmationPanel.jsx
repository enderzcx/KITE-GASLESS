export default function ConfirmationPanel({ confirmState }) {
  return (
    <div className="transfer-card confirm-card">
      <h2>x402 Settlement Confirmation</h2>
      <div className="result-row"><span className="label">Stage:</span><span className="value">{confirmState.stage}</span></div>
      <div className="result-row"><span className="label">Message:</span><span className="value">{confirmState.message}</span></div>
      <div className="result-row"><span className="label">Tx Hash:</span><span className="value hash">{confirmState.txHash || '-'}</span></div>
      <div className="result-row"><span className="label">Block:</span><span className="value">{confirmState.blockNumber || '-'}</span></div>
      <div className="result-row"><span className="label">From:</span><span className="value hash">{confirmState.from || '-'}</span></div>
      <div className="result-row"><span className="label">To:</span><span className="value hash">{confirmState.to || '-'}</span></div>
      <div className="result-row"><span className="label">Amount (raw):</span><span className="value">{confirmState.valueRaw || '-'}</span></div>
      <div className="result-row"><span className="label">Match:</span><span className="value">{confirmState.match === null ? '-' : String(confirmState.match)}</span></div>
    </div>
  );
}
