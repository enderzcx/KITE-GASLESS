export default function AccountInfoCard({ aaWallet, owner, actionType }) {
  return (
    <div className="info-card">
      <h2>Account Info</h2>
      <div className="info-row">
        <span className="label">AA Wallet:</span>
        <span className="value">{aaWallet || 'Not generated'}</span>
      </div>
      <div className="info-row">
        <span className="label">Owner:</span>
        <span className="value">{owner || 'Not connected'}</span>
      </div>
      <div className="info-row">
        <span className="label">Paid Action:</span>
        <span className="value">{actionType}</span>
      </div>
    </div>
  );
}
