import { useEffect, useState } from 'react';
import { ethers } from 'ethers';

const DEFAULT_VAULT_IMPLEMENTATION = '0xB5AAFCC6DD4DFc2B80fb8BCcf406E1a2Fd559e23';
const ERC1967_PROXY_CREATION_CODE =
  '0x60806040526102a88038038061001481610168565b92833981016040828203126101645781516001600160a01b03811692909190838303610164576020810151906001600160401b03821161016457019281601f8501121561016457835161006e610069826101a1565b610168565b9481865260208601936020838301011161016457815f926020809301865e86010152823b15610152577f360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc80546001600160a01b031916821790557fbc7cd75a20ee27fd9adebab32041f755214dbc6bffa90cc0225b39da2e5c2d3b5f80a282511561013a575f8091610122945190845af43d15610132573d91610113610069846101a1565b9283523d5f602085013e6101bc565b505b604051608d908161021b8239f35b6060916101bc565b50505034156101245763b398979f60e01b5f5260045ffd5b634c9c8ce360e01b5f5260045260245ffd5b5f80fd5b6040519190601f01601f191682016001600160401b0381118382101761018d57604052565b634e487b7160e01b5f52604160045260245ffd5b6001600160401b03811161018d57601f01601f191660200190565b906101e057508051156101d157602081519101fd5b63d6bda27560e01b5f5260045ffd5b81511580610211575b6101f1575090565b639996b31560e01b5f9081526001600160a01b0391909116600452602490fd5b50803b156101e956fe60806040525f8073ffffffffffffffffffffffffffffffffffffffff7f360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc5416368280378136915af43d5f803e156053573d5ff35b3d5ffdfea2646970667358221220359eac519e2625610420a0e3cfdfe26e6cc711dbb451880735ac4544d4ccdcf264736f6c634300081c0033';

const VAULT_ADDRESS_FROM_ENV =
  import.meta.env.VITE_KITECLAW_VAULT_ADDRESS ||
  import.meta.env.VITE_VAULT_ADDRESS ||
  '';
const VAULT_IMPLEMENTATION =
  import.meta.env.VITE_KITECLAW_VAULT_IMPLEMENTATION ||
  DEFAULT_VAULT_IMPLEMENTATION;
const SETTLEMENT_TOKEN =
  import.meta.env.VITE_KITEAI_SETTLEMENT_TOKEN ||
  import.meta.env.VITE_SETTLEMENT_TOKEN ||
  '0x0fF5393387ad2f9f691FD6Fd28e07E3969e27e63';
const TOKEN_DECIMALS = 18;
const KITE_CHAIN_ID_HEX = '0x940';
const VAULT_ADDRESS_STORAGE_KEY = 'kiteclaw_vault_address';

const resolveInitialVaultAddress = () => {
  const localVault = localStorage.getItem(VAULT_ADDRESS_STORAGE_KEY) || '';
  if (ethers.isAddress(localVault)) return localVault;
  if (ethers.isAddress(VAULT_ADDRESS_FROM_ENV)) return VAULT_ADDRESS_FROM_ENV;
  return '';
};

const vaultInterface = new ethers.Interface([
  {
    inputs: [],
    name: 'getAvailableBalance',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [],
    name: 'getSpendingRules',
    outputs: [
      {
        components: [
          {
            components: [
              { internalType: 'uint256', name: 'timeWindow', type: 'uint256' },
              { internalType: 'uint160', name: 'budget', type: 'uint160' },
              { internalType: 'uint96', name: 'initialWindowStartTime', type: 'uint96' },
              { internalType: 'bytes32[]', name: 'targetProviders', type: 'bytes32[]' }
            ],
            internalType: 'struct IClientAgentVault.Rule',
            name: 'rule',
            type: 'tuple'
          },
          {
            components: [
              { internalType: 'uint128', name: 'amountUsed', type: 'uint128' },
              { internalType: 'uint128', name: 'currentTimeWindowStartTime', type: 'uint128' }
            ],
            internalType: 'struct IClientAgentVault.Usage',
            name: 'usage',
            type: 'tuple'
          }
        ],
        internalType: 'struct IClientAgentVault.SpendingRule[]',
        name: '',
        type: 'tuple[]'
      }
    ],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [
      {
        components: [
          { internalType: 'uint256', name: 'timeWindow', type: 'uint256' },
          { internalType: 'uint160', name: 'budget', type: 'uint160' },
          { internalType: 'uint96', name: 'initialWindowStartTime', type: 'uint96' },
          { internalType: 'bytes32[]', name: 'targetProviders', type: 'bytes32[]' }
        ],
        internalType: 'struct IClientAgentVault.Rule[]',
        name: 'rules',
        type: 'tuple[]'
      }
    ],
    name: 'setSpendingRules',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    inputs: [
      { internalType: 'address', name: 'token', type: 'address' },
      { internalType: 'uint256', name: 'amount', type: 'uint256' }
    ],
    name: 'withdrawFunds',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  }
]);

const erc20Interface = new ethers.Interface([
  'function transfer(address to, uint256 amount) returns (bool)'
]);

function VaultPage({ onBack, walletState }) {
  const [vaultAddress, setVaultAddress] = useState(() => resolveInitialVaultAddress());
  const [vaultBalance, setVaultBalance] = useState('0');
  const [singleLimit, setSingleLimit] = useState('5');
  const [dailyLimit, setDailyLimit] = useState('50');
  const [depositAmount, setDepositAmount] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [rules, setRules] = useState([]);
  const [vaultStatus, setVaultStatus] = useState('');

  const rpcUrl =
    import.meta.env.VITE_KITEAI_RPC_URL ||
    import.meta.env.VITE_KITE_RPC_URL ||
    'https://rpc-testnet.gokite.ai/';

  const logRecord = async (record) => {
    try {
      await fetch('/api/records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(record)
      });
    } catch {
      // ignore logging errors
    }
  };

  const getSigner = async () => {
    if (walletState?.ownerAddress && typeof window.ethereum !== 'undefined') {
      const currentChainId = await window.ethereum.request({ method: 'eth_chainId' });
      if (currentChainId !== KITE_CHAIN_ID_HEX) {
        try {
          await window.ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: KITE_CHAIN_ID_HEX }]
          });
        } catch (switchErr) {
          if (switchErr?.code === 4902) {
            await window.ethereum.request({
              method: 'wallet_addEthereumChain',
              params: [
                {
                  chainId: KITE_CHAIN_ID_HEX,
                  chainName: 'KiteAI Testnet',
                  rpcUrls: ['https://rpc-testnet.gokite.ai/'],
                  nativeCurrency: {
                    name: 'KITE',
                    symbol: 'KITE',
                    decimals: 18
                  },
                  blockExplorerUrls: ['https://testnet.kitescan.ai/']
                }
              ]
            });
          } else {
            throw switchErr;
          }
        }
      }
      const provider = new ethers.BrowserProvider(window.ethereum);
      return provider.getSigner();
    }
    throw new Error('Please connect wallet to manage vault operations.');
  };

  const ensureVaultAddress = (address = vaultAddress) => {
    if (!address) {
      setVaultStatus('Vault address missing. Click "Create Vault" or set VITE_KITECLAW_VAULT_ADDRESS in .env.');
      return false;
    }
    if (!ethers.isAddress(address)) {
      setVaultStatus(`Invalid Vault address format: ${address}`);
      return false;
    }
    return true;
  };

  const handleCreateVault = async () => {
    if (!walletState?.ownerAddress) {
      setVaultStatus('No signer available. Please connect wallet.');
      return;
    }
    try {
      setVaultStatus('Creating Vault...');
      const signer = await getSigner();
      const owner = await signer.getAddress();
      const provider = signer.provider;

      const implCode = await provider.getCode(VAULT_IMPLEMENTATION);
      if (!implCode || implCode === '0x') {
        setVaultStatus(
          `No contract code at Vault implementation. Check VITE_KITECLAW_VAULT_IMPLEMENTATION: ${VAULT_IMPLEMENTATION}`
        );
        return;
      }

      const initIface = new ethers.Interface([
        'function initialize(address allowedToken, address owner)'
      ]);
      const initData = initIface.encodeFunctionData('initialize', [SETTLEMENT_TOKEN, owner]);
      const constructorArgs = ethers.AbiCoder.defaultAbiCoder().encode(
        ['address', 'bytes'],
        [VAULT_IMPLEMENTATION, initData]
      );
      const deployData = ERC1967_PROXY_CREATION_CODE + constructorArgs.slice(2);

      const tx = await signer.sendTransaction({ data: deployData });
      setVaultStatus(`Vault creation submitted, waiting confirmation: ${tx.hash}`);
      const receipt = await signer.provider.waitForTransaction(tx.hash, 1, 60000);
      if (!receipt) {
        setVaultStatus(`Tx submitted. Not confirmed in 60s, continue polling in background: ${tx.hash}`);
        void pollVaultDeploymentResult(signer.provider, tx.hash);
        return;
      }
      const deployedAddress = receipt?.contractAddress;
      if (!deployedAddress) {
        throw new Error('Vault address not found in receipt. Please check transaction.');
      }

      setVaultAddress(deployedAddress);
      setVaultStatus(`Vault created successfully: ${deployedAddress}`);
      await loadVaultBalance(deployedAddress);
      await loadRules(deployedAddress);
    } catch (err) {
      setVaultStatus(`Vault creation failed: ${err.message}`);
    }
  };

  const pollVaultDeploymentResult = async (provider, txHash) => {
    for (let i = 0; i < 24; i += 1) {
      try {
        const receipt = await provider.getTransactionReceipt(txHash);
        if (receipt) {
          const deployedAddress = receipt.contractAddress;
          if (deployedAddress) {
            setVaultAddress(deployedAddress);
            setVaultStatus(`Vault created successfully: ${deployedAddress}`);
            await loadVaultBalance(deployedAddress);
            await loadRules(deployedAddress);
            return;
          }
          setVaultStatus(`Transaction confirmed but no contract address returned. Please check tx: ${txHash}`);
          return;
        }
      } catch {
        // keep polling
      }
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
    setVaultStatus(`Transaction still pending. Refresh later or check by hash: ${txHash}`);
  };

  const loadVaultBalance = async (address = vaultAddress) => {
    if (!ensureVaultAddress(address)) return;
    try {
      const provider = new ethers.JsonRpcProvider(rpcUrl);
      const data = vaultInterface.encodeFunctionData('getAvailableBalance', []);
      const result = await provider.call({ to: address, data });
      const balance = ethers.getBigInt(result);
      setVaultBalance(ethers.formatUnits(balance, TOKEN_DECIMALS));
    } catch (err) {
      setVaultStatus(`Failed to fetch balance: ${err.message}`);
    }
  };

  const loadRules = async (address = vaultAddress) => {
    if (!ensureVaultAddress(address)) return;
    try {
      const provider = new ethers.JsonRpcProvider(rpcUrl);
      const data = vaultInterface.encodeFunctionData('getSpendingRules', []);
      const result = await provider.call({ to: address, data });
      const decoded = vaultInterface.decodeFunctionResult('getSpendingRules', result)[0];
      setRules(decoded);
    } catch (err) {
      setVaultStatus(`Failed to fetch rules: ${err.message}`);
    }
  };

  useEffect(() => {
    loadVaultBalance();
    loadRules();
  }, [vaultAddress]);

  useEffect(() => {
    if (ethers.isAddress(vaultAddress)) {
      localStorage.setItem(VAULT_ADDRESS_STORAGE_KEY, vaultAddress);
    }
  }, [vaultAddress]);

  useEffect(() => {
    if (VAULT_ADDRESS_FROM_ENV && !ethers.isAddress(VAULT_ADDRESS_FROM_ENV) && !vaultAddress) {
      setVaultStatus(`Ignored invalid placeholder Vault address from .env: ${VAULT_ADDRESS_FROM_ENV}`);
    }
  }, []);

  const handleSetRules = async () => {
    if (!ensureVaultAddress()) return;
    if (!walletState?.ownerAddress) {
      setVaultStatus('No signer available. Please connect wallet.');
      return;
    }
    try {
      setVaultStatus('Applying...');
      const signer = await getSigner();
      const latestBlock = await signer.provider.getBlock('latest');
      const nowTs = Number(latestBlock?.timestamp || Math.floor(Date.now() / 1000));

      const rulesToSet = [
        [0, ethers.parseUnits(singleLimit || '0', TOKEN_DECIMALS), 0, []],
        [86400, ethers.parseUnits(dailyLimit || '0', TOKEN_DECIMALS), Math.max(0, nowTs - 1), []]
      ];

      const data = vaultInterface.encodeFunctionData('setSpendingRules', [rulesToSet]);
      const tx = await signer.sendTransaction({
        to: vaultAddress,
        data
      });
      await tx.wait();
      setVaultStatus(`Rules updated: ${tx.hash}`);
      await loadRules();
    } catch (err) {
      setVaultStatus(`Failed: ${err.message}`);
    }
  };

  const handleDeposit = async () => {
    if (!ensureVaultAddress()) return;
    if (!walletState?.ownerAddress) {
      setVaultStatus('No signer available. Please connect wallet.');
      return;
    }
    if (!depositAmount) {
      setVaultStatus('Please enter deposit amount.');
      return;
    }
    try {
      setVaultStatus('Depositing...');
      const signer = await getSigner();
      const data = erc20Interface.encodeFunctionData('transfer', [
        vaultAddress,
        ethers.parseUnits(depositAmount, TOKEN_DECIMALS)
      ]);
      const tx = await signer.sendTransaction({
        to: SETTLEMENT_TOKEN,
        data
      });
      await tx.wait();
      setVaultStatus(`Deposit successful: ${tx.hash}`);
      setDepositAmount('');
      await loadVaultBalance();

      await logRecord({
        type: 'Vault',
        amount: depositAmount,
        token: SETTLEMENT_TOKEN,
        recipient: vaultAddress,
        txHash: tx.hash,
        status: 'success'
      });
    } catch (err) {
      setVaultStatus(`Deposit failed: ${err.message}`);
      await logRecord({
        type: 'Vault',
        amount: depositAmount,
        token: SETTLEMENT_TOKEN,
        recipient: vaultAddress,
        txHash: '',
        status: 'error'
      });
    }
  };

  const handleWithdraw = async () => {
    if (!ensureVaultAddress()) return;
    if (!walletState?.ownerAddress) {
      setVaultStatus('No signer available. Please connect wallet.');
      return;
    }
    if (!withdrawAmount) {
      setVaultStatus('Please enter withdrawal amount.');
      return;
    }
    try {
      setVaultStatus('Withdrawing...');
      const signer = await getSigner();
      const data = vaultInterface.encodeFunctionData('withdrawFunds', [
        SETTLEMENT_TOKEN,
        ethers.parseUnits(withdrawAmount, TOKEN_DECIMALS)
      ]);
      const tx = await signer.sendTransaction({
        to: vaultAddress,
        data
      });
      await tx.wait();
      setVaultStatus(`Withdrawal successful: ${tx.hash}`);
      setWithdrawAmount('');
      await loadVaultBalance();

      await logRecord({
        type: 'Vault',
        amount: withdrawAmount,
        token: SETTLEMENT_TOKEN,
        recipient: signer.address,
        txHash: tx.hash,
        status: 'success'
      });
    } catch (err) {
      setVaultStatus(`Withdrawal failed: ${err.message}`);
      await logRecord({
        type: 'Vault',
        amount: withdrawAmount,
        token: SETTLEMENT_TOKEN,
        recipient: '',
        txHash: '',
        status: 'error'
      });
    }
  };

  const renderRuleLabel = (timeWindow) => {
    if (timeWindow === 0) return 'Single-spend';
    if (timeWindow === 86400) return 'Daily-spend';
    return 'Periodic-spend';
  };

  return (
    <div className="transfer-container">
      <div className="top-entry">
        {onBack && (
          <button className="link-btn" onClick={onBack}>
            Back to Transfer Page
          </button>
        )}
      </div>

      <h1>Vault Management</h1>

      <div className="vault-card">
        <h2>Vault Balance & Spending Rules</h2>
        <div className="result-row">
          <span className="label">Current Owner:</span>
          <span className="value hash">{walletState?.ownerAddress || 'Not connected'}</span>
        </div>
        <div className="result-row">
          <span className="label">Current AA:</span>
          <span className="value hash">{walletState?.aaAddress || 'Not generated'}</span>
        </div>
        <div className="result-row">
          <span className="label">Vault Implementation:</span>
          <span className="value hash">{VAULT_IMPLEMENTATION}</span>
        </div>
        <div className="result-row">
          <span className="label">Vault Address:</span>
          <span className="value hash">{vaultAddress || 'Not created / not configured'}</span>
        </div>
        <div className="result-row">
          <span className="label">Current Balance:</span>
          <span className="value">{vaultBalance} USDT</span>
        </div>

        <div className="vault-actions">
          <button onClick={handleCreateVault}>Create Vault</button>
        </div>

        <div className="vault-actions">
          <div className="vault-input">
            <label>Single Tx Limit (USDT)</label>
            <input
              type="text"
              value={singleLimit}
              onChange={(e) => setSingleLimit(e.target.value)}
              placeholder="5"
            />
          </div>
          <div className="vault-input">
            <label>Daily Limit (USDT)</label>
            <input
              type="text"
              value={dailyLimit}
              onChange={(e) => setDailyLimit(e.target.value)}
              placeholder="50"
            />
          </div>
          <button onClick={handleSetRules}>Update Spending Rules</button>
        </div>

        <div className="vault-actions">
          <div className="vault-input">
            <label>Deposit Amount (USDT)</label>
            <input
              type="text"
              value={depositAmount}
              onChange={(e) => setDepositAmount(e.target.value)}
              placeholder="0.3"
            />
          </div>
          <button onClick={handleDeposit}>Deposit to Vault</button>
        </div>

        <div className="vault-actions">
          <div className="vault-input">
            <label>Withdrawal Amount (USDT)</label>
            <input
              type="text"
              value={withdrawAmount}
              onChange={(e) => setWithdrawAmount(e.target.value)}
              placeholder="1.0"
            />
          </div>
          <button onClick={handleWithdraw}>Withdraw to Owner Wallet</button>
        </div>

        {rules.length > 0 && (
          <div className="rules-list">
            <h3>Current Rules</h3>
            {rules.map((item, index) => (
              <div className="result-row" key={`rule-${index}`}>
                <span className="label">Rule {index + 1}：</span>
                <span className="value">
                  {renderRuleLabel(Number(item.rule.timeWindow))} limit {ethers.formatUnits(item.rule.budget, TOKEN_DECIMALS)} USDT used {ethers.formatUnits(item.usage.amountUsed, TOKEN_DECIMALS)}
                </span>
              </div>
            ))}
          </div>
        )}

        {vaultStatus && <div className="request-error">{vaultStatus}</div>}
      </div>
    </div>
  );
}

export default VaultPage;



