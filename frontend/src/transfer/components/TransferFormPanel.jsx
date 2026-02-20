export default function TransferFormPanel({
  owner,
  loading,
  isAuthenticated,
  authStatus,
  actionType,
  queryText,
  reactiveSymbol,
  reactiveTakeProfit,
  reactiveStopLoss,
  x402Challenge,
  onConnect,
  onAuthenticate,
  onActionChange,
  onQueryChange,
  onReactiveSymbolChange,
  onReactiveTakeProfitChange,
  onReactiveStopLossChange,
  onRequest402,
  onPayAndSubmit
}) {
  return (
    <div className="transfer-card">
      <h2>Transfer</h2>
      <button onClick={onConnect} className="connect-btn">
        {owner ? 'Connected' : 'Connect Wallet'}
      </button>
      <button onClick={onAuthenticate} className="connect-btn" disabled={loading || !owner}>
        {isAuthenticated ? 'Authenticated' : 'Authentication'}
      </button>
      {authStatus && <div className="request-error">{authStatus}</div>}

      <div className="form-group">
        <label>
          Action:
          <select value={actionType} onChange={(e) => onActionChange(e.target.value)} disabled={loading}>
            <option value="kol-score">KOL Score Report (x402)</option>
            <option value="reactive-stop-orders">Reactive Contracts - Stop Orders (agent2)</option>
          </select>
        </label>
      </div>

      <div className="form-group">
        <label>
          Query:
          <input
            type="text"
            value={queryText}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="KOL score report for AI payment campaign"
            disabled={loading}
          />
        </label>
      </div>

      {actionType === 'reactive-stop-orders' && (
        <>
          <div className="form-group">
            <label>
              Symbol:
              <input
                type="text"
                value={reactiveSymbol}
                onChange={(e) => onReactiveSymbolChange(e.target.value)}
                placeholder="BTC-USDT"
                disabled={loading}
              />
            </label>
          </div>
          <div className="form-group">
            <label>
              Take Profit:
              <input
                type="number"
                value={reactiveTakeProfit}
                onChange={(e) => onReactiveTakeProfitChange(e.target.value)}
                placeholder="70000"
                disabled={loading}
              />
            </label>
          </div>
          <div className="form-group">
            <label>
              Stop Loss:
              <input
                type="number"
                value={reactiveStopLoss}
                onChange={(e) => onReactiveStopLossChange(e.target.value)}
                placeholder="62000"
                disabled={loading}
              />
            </label>
          </div>
        </>
      )}

      <button onClick={onRequest402} disabled={loading} className={loading ? 'loading' : ''}>
        {loading ? 'Requesting...' : 'Request Payment Info (402)'}
      </button>
      <button
        onClick={onPayAndSubmit}
        disabled={loading || !x402Challenge}
        className={loading ? 'loading' : ''}
      >
        {loading ? 'Paying...' : 'Pay & Submit Proof'}
      </button>
    </div>
  );
}
