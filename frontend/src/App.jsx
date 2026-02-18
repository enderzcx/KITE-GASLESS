import { useState } from 'react';
import { ethers } from 'ethers';
import Transfer from './Transfer';
import LoginPage from './LoginPage';
import RequestPage from './RequestPage';
import VaultPage from './VaultPage';
import AgentSettingsPage from './AgentSettingsPage';
import RecordsPage from './RecordsPage';
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
    '/rpc';
  const bundlerUrl =
    import.meta.env.VITE_KITEAI_BUNDLER_URL ||
    import.meta.env.VITE_BUNDLER_URL ||
    '/bundler';

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
    setView('request');
  };

  return (
    <div className="app">
      {view === 'login' && <LoginPage onLogin={connectWalletAndEnter} />}
      {view === 'request' && (
        <RequestPage
          walletState={walletState}
          onOpenTransfer={() => setView('transfer')}
          onOpenVault={() => setView('vault')}
          onOpenAgentSettings={() => setView('agent-settings')}
          onOpenRecords={() => setView('records')}
        />
      )}
      {view === 'transfer' && (
        <Transfer walletState={walletState} onBack={() => setView('request')} />
      )}
      {view === 'vault' && (
        <VaultPage walletState={walletState} onBack={() => setView('request')} />
      )}
      {view === 'agent-settings' && (
        <AgentSettingsPage walletState={walletState} onBack={() => setView('request')} />
      )}
      {view === 'records' && (
        <RecordsPage onBack={() => setView('request')} />
      )}
    </div>
  );
}

export default App;

