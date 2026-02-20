export default function BalanceCard({ aaWallet, senderBalance, walletConnected }) {
  return (
    <div className="balance-card">
      <h2>Balance</h2>
      <div className="balance-status">
        {walletConnected ? 'Wallet Connected' : 'Wallet Not Connected'}
      </div>
      <div className="info-row balance-row">
        <span className="label hash">{aaWallet || 'AA Address'}:</span>
        <span className="value balance-value">{senderBalance} USDT</span>
      </div>
    </div>
  );
}
