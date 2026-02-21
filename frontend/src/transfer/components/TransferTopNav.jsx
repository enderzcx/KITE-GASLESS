export default function TransferTopNav({ onBack, onOpenVault, onOpenAgentSettings, onOpenRecords, onOpenOnChain, onOpenAbuseCases }) {
  return (
    <div className="top-entry">
      {onBack && <button className="link-btn" onClick={onBack}>Switch Wallet</button>}
      {onOpenAgentSettings && <button className="link-btn" onClick={onOpenAgentSettings}>Dashboard</button>}
      {onOpenVault && <button className="link-btn" onClick={onOpenVault}>Open Vault Page</button>}
      {onOpenRecords && <button className="link-btn" onClick={onOpenRecords}>Transfer Records</button>}
      {onOpenOnChain && <button className="link-btn" onClick={onOpenOnChain}>On-chain Confirmation</button>}
      {onOpenAbuseCases && <button className="link-btn" onClick={onOpenAbuseCases}>Abuse / Limit Cases</button>}
    </div>
  );
}
