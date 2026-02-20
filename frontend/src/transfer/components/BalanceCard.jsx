export default function BalanceCard({ aaWallet, senderBalance }) {
  return (
    <div className="balance-card">
      <h2>Balance</h2>
      <div className="info-row">
        <span className="label">{aaWallet || 'AA Address'}:</span>
        <span className="value">{senderBalance} USDT</span>
      </div>
    </div>
  );
}
