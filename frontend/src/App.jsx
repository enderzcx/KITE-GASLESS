import { useState } from 'react';
import { ethers } from 'ethers';
import Transfer from './Transfer';
import LoginPage from './LoginPage';
import VaultPage from './VaultPage';
import AgentSettingsPage from './AgentSettingsPage';
import RecordsPage from './RecordsPage';
import OnChainPage from './OnChainPage';
import AbuseCasesPage from './AbuseCasesPage';
import { GokiteAASDK } from './gokite-aa-sdk';
import './App.css';

function App() {
  const [view, setView] = useState('login');
  const [walletState, setWalletState] = useState({
    ownerAddress: '',
    aaAddress: ''
  });

  const rpcUrl =
    import.meta.env.VITE_KITEAI_RPC_URL ||
    import.meta.env.VITE_KITE_RPC_URL ||
    'https://rpc-testnet.gokite.ai/';
  const bundlerUrl =
    import.meta.env.VITE_KITEAI_BUNDLER_URL ||
    import.meta.env.VITE_BUNDLER_URL ||
    'https://bundler-service.staging.gokite.ai/rpc/';

  const connectWalletAndEnter = async () => {
    if (typeof window.ethereum === 'undefined') {
      throw new Error('Please install MetaMask or a compatible wallet first');
    }
    const provider = new ethers.BrowserProvider(window.ethereum);
    const signer = await provider.getSigner();
    const ownerAddress = await signer.getAddress();

    const sdk = new GokiteAASDK({
      network: 'kite_testnet',
      rpcUrl,
      bundlerUrl,
      entryPointAddress: '0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108'
    });
    const aaAddress = sdk.getAccountAddress(ownerAddress);

    setWalletState({ ownerAddress, aaAddress });
    setView('transfer');
  };

  return (
    <div className="app">
      {view === 'login' && <LoginPage onLogin={connectWalletAndEnter} />}
      {view === 'transfer' && (
        <Transfer
          walletState={walletState}
          onBack={() => setView('login')}
          onOpenVault={() => setView('vault')}
          onOpenAgentSettings={() => setView('agent-settings')}
          onOpenRecords={() => setView('records')}
          onOpenOnChain={() => setView('on-chain')}
          onOpenAbuseCases={() => setView('abuse-cases')}
        />
      )}
      {view === 'vault' && <VaultPage walletState={walletState} onBack={() => setView('transfer')} />}
      {view === 'agent-settings' && (
        <AgentSettingsPage walletState={walletState} onBack={() => setView('transfer')} />
      )}
      {view === 'records' && <RecordsPage onBack={() => setView('transfer')} />}
      {view === 'on-chain' && <OnChainPage walletState={walletState} onBack={() => setView('transfer')} />}
      {view === 'abuse-cases' && (
        <AbuseCasesPage walletState={walletState} onBack={() => setView('transfer')} />
      )}
    </div>
  );
}

export default App;
