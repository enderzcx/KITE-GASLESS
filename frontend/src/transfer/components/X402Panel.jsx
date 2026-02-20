export default function X402Panel({ x402Lookup, x402Challenge }) {
  return (
    <div className="transfer-card x402-card">
      <h2>x402 Mapping</h2>
      <div className="result-row"><span className="label">Lookup:</span><span className="value">{x402Lookup.loading ? 'loading' : x402Lookup.found ? 'found' : 'not found'}</span></div>
      <div className="result-row"><span className="label">Message:</span><span className="value">{x402Lookup.message}</span></div>
      {x402Lookup.item && (
        <>
          <div className="result-row"><span className="label">Action:</span><span className="value">{x402Lookup.item.action || '-'}</span></div>
          <div className="result-row"><span className="label">Request ID:</span><span className="value hash">{x402Lookup.item.requestId || '-'}</span></div>
          <div className="result-row"><span className="label">Payer:</span><span className="value hash">{x402Lookup.item.payer || '-'}</span></div>
          <div className="result-row"><span className="label">Status:</span><span className="value">{x402Lookup.item.status || '-'}</span></div>
          <div className="result-row"><span className="label">Amount:</span><span className="value">{x402Lookup.item.amount || '-'} USDT</span></div>
          <div className="result-row"><span className="label">Payment Tx:</span><span className="value hash">{x402Lookup.item.paymentTxHash || '-'}</span></div>
          <div className="result-row"><span className="label">Policy decision:</span><span className="value">{x402Lookup.item?.policy?.decision || '-'}</span></div>
          <div className="result-row">
            <span className="label">Policy snapshot:</span>
            <span className="value hash">{x402Lookup.item?.policy?.snapshot ? JSON.stringify(x402Lookup.item.policy.snapshot) : '-'}</span>
          </div>
        </>
      )}
      <div className="result-row"><span className="label">Challenge:</span><span className="value">{x402Challenge ? 'ready' : 'none'}</span></div>
      {x402Challenge && (
        <>
          <div className="result-row"><span className="label">Challenge Request ID:</span><span className="value hash">{x402Challenge.requestId}</span></div>
          <div className="result-row"><span className="label">Challenge Recipient:</span><span className="value hash">{x402Challenge.recipient}</span></div>
          <div className="result-row"><span className="label">Challenge Amount:</span><span className="value">{x402Challenge.amount} USDT</span></div>
          <div className="result-row"><span className="label">Challenge Query:</span><span className="value">{x402Challenge.query}</span></div>
          {x402Challenge.actionType === 'reactive-stop-orders' && (
            <>
              <div className="result-row"><span className="label">Symbol:</span><span className="value">{x402Challenge?.actionParams?.symbol || '-'}</span></div>
              <div className="result-row"><span className="label">Take Profit:</span><span className="value">{x402Challenge?.actionParams?.takeProfit ?? '-'}</span></div>
              <div className="result-row"><span className="label">Stop Loss:</span><span className="value">{x402Challenge?.actionParams?.stopLoss ?? '-'}</span></div>
            </>
          )}
        </>
      )}
    </div>
  );
}
