export default function IdentityCard({ identity, identityError }) {
  return (
    <div className="info-card">
      <h2>Verifiable Agent Identity</h2>
      {identityError && <div className="request-error">identity error: {identityError}</div>}
      {!identityError && !identity?.available && (
        <div className="info-row">
          <span className="label">Status:</span>
          <span className="value">not configured ({identity?.reason || 'unknown'})</span>
        </div>
      )}
      {identity?.available && (
        <>
          <div className="info-row">
            <span className="label">Agent ID:</span>
            <span className="value">{identity?.configured?.agentId || '-'}</span>
          </div>
          <div className="info-row">
            <span className="label">Registry:</span>
            <span className="value hash">{identity?.configured?.registry || '-'}</span>
          </div>
          <div className="info-row">
            <span className="label">Agent Wallet:</span>
            <span className="value hash">{identity?.agentWallet || '-'}</span>
          </div>
        </>
      )}
    </div>
  );
}
