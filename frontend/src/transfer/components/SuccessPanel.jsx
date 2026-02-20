export default function SuccessPanel({ status, txHash, userOpHash, paidResult, aaWallet, senderBalance }) {
  if (status !== 'success') return null;

  return (
    <div className="success-card">
      <h2>Paid Action Successful!</h2>
      <div className="info-row"><span className="label">Transaction Hash:</span><span className="value hash">{txHash}</span></div>
      <div className="info-row"><span className="label">UserOp Hash:</span><span className="value hash">{userOpHash}</span></div>
      {paidResult && (
        <>
          <div className="info-row"><span className="label">Action:</span><span className="value">{paidResult.action}</span></div>
          <div className="info-row"><span className="label">Flow Mode:</span><span className="value">{paidResult.flowMode || '-'}</span></div>
          {paidResult.flowMode === 'a2a+x402' && (
            <>
              <div className="info-row"><span className="label">Source Agent ID:</span><span className="value">{paidResult.sourceAgentId || '-'}</span></div>
              <div className="info-row"><span className="label">Target Agent ID:</span><span className="value">{paidResult.targetAgentId || '-'}</span></div>
            </>
          )}
          <div className="info-row"><span className="label">Result:</span><span className="value">{paidResult.summary}</span></div>
          {paidResult.orderPlan && (
            <>
              <div className="info-row"><span className="label">Symbol:</span><span className="value">{paidResult.orderPlan.symbol}</span></div>
              <div className="info-row"><span className="label">Take Profit:</span><span className="value">{paidResult.orderPlan.takeProfit}</span></div>
              <div className="info-row"><span className="label">Stop Loss:</span><span className="value">{paidResult.orderPlan.stopLoss}</span></div>
            </>
          )}
          {!paidResult.orderPlan && Array.isArray(paidResult.topKOLs) && paidResult.topKOLs.length > 0 && (
            <div className="info-row">
              <span className="label">Top KOLs:</span>
              <span className="value">{paidResult.topKOLs.map((item) => `${item.handle}(${item.score})`).join(', ')}</span>
            </div>
          )}
        </>
      )}
      <div className="balance-update">
        <h3>Post-payment Balance</h3>
        <div className="info-row">
          <span className="label">{aaWallet || 'AA Address'}:</span>
          <span className="value">{senderBalance} USDT</span>
        </div>
      </div>
    </div>
  );
}
