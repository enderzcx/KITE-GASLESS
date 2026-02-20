import { ethers } from 'ethers';

export function useTransferAuth({
  sdk,
  walletState,
  owner,
  setOwner,
  setAAWallet,
  setSenderBalance,
  setAuthStatus,
  setIsAuthenticated,
  constants
}) {
  const { AUTH_STORAGE_PREFIX, SETTLEMENT_TOKEN, TOKEN_DECIMALS } = constants;

  const handleConnectWallet = async () => {
    try {
      if (typeof window.ethereum !== 'undefined') {
        const provider = new ethers.BrowserProvider(window.ethereum);
        const signer = await provider.getSigner();
        const address = await signer.getAddress();
        const derivedAA = sdk.ensureAccountAddress(address);

        setOwner(address);
        setAAWallet(derivedAA);

        const balance = await sdk.getERC20Balance(SETTLEMENT_TOKEN);
        setSenderBalance(ethers.formatUnits(balance, TOKEN_DECIMALS));

        alert(`Wallet connected: ${address}`);
      } else {
        alert('Please install MetaMask or another wallet.');
      }
    } catch (error) {
      alert(`Connection failed: ${error.message}`);
    }
  };

  const handleAuthentication = async () => {
    const currentOwner = walletState?.ownerAddress || owner;
    if (!currentOwner) {
      setAuthStatus('Please connect your wallet first.');
      return;
    }
    if (typeof window.ethereum === 'undefined') {
      setAuthStatus('No wallet environment detected.');
      return;
    }
    try {
      setAuthStatus('Authenticating...');
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const challenge = `KiteClaw Authentication\\nOwner: ${currentOwner}\\nTime: ${Date.now()}`;
      await signer.signMessage(challenge);
      const authKey = `${AUTH_STORAGE_PREFIX}${currentOwner.toLowerCase()}`;
      localStorage.setItem(authKey, 'ok');
      setIsAuthenticated(true);
      setAuthStatus('Authentication successful.');
    } catch (error) {
      setAuthStatus(`Authentication failed: ${error.message}`);
    }
  };

  return {
    handleConnectWallet,
    handleAuthentication
  };
}
