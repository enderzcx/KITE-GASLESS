/**
 * Gokite Account Abstraction SDK (ES Module version)
 * 
 * Single-file version with ERC-4337 transfer helpers
 */

import { ethers } from 'ethers';

const NETWORKS = {
  kite_testnet: {
    chainId: 2368,
    entryPoint: '0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108',
    accountFactory: '0xAba80c4c8748c114Ba8b61cda3b0112333C3b96E',
    accountImplementation: '0xF7681F4f70a2F2d114D03e6B93189cb549B8A503'
  }
};

const ERC1967_PROXY_CREATION_CODE =
  '0x60806040526102a88038038061001481610168565b92833981016040828203126101645781516001600160a01b03811692909190838303610164576020810151906001600160401b03821161016457019281601f8501121561016457835161006e610069826101a1565b610168565b9481865260208601936020838301011161016457815f926020809301865e86010152823b15610152577f360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc80546001600160a01b031916821790557fbc7cd75a20ee27fd9adebab32041f755214dbc6bffa90cc0225b39da2e5c2d3b5f80a282511561013a575f8091610122945190845af43d15610132573d91610113610069846101a1565b9283523d5f602085013e6101bc565b505b604051608d908161021b8239f35b6060916101bc565b50505034156101245763b398979f60e01b5f5260045ffd5b634c9c8ce360e01b5f5260045260245ffd5b5f80fd5b6040519190601f01601f191682016001600160401b0381118382101761018d57604052565b634e487b7160e01b5f52604160045260245ffd5b6001600160401b03811161018d57601f01601f191660200190565b906101e057508051156101d157602081519101fd5b63d6bda27560e01b5f5260045ffd5b81511580610211575b6101f1575090565b639996b31560e01b5f9081526001600160a01b0391909116600452602490fd5b50803b156101e956fe60806040525f8073ffffffffffffffffffffffffffffffffffffffff7f360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc5416368280378136915af43d5f803e156053573d5ff35b3d5ffdfea2646970667358221220359eac519e2625610420a0e3cfdfe26e6cc711dbb451880735ac4544d4ccdcf264736f6c634300081c0033';

export class GokiteAASDK {
  constructor(config) {
    this.config = {
      network: config.network || 'kite_testnet',
      ...config
    };
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
    
    this.entryPointAbi = [
      'function getNonce(address sender, uint192 key) view returns (uint256)',
      'function getUserOpHash(tuple(address sender, uint256 nonce, bytes initCode, bytes callData, bytes32 accountGasLimits, uint256 preVerificationGas, bytes32 gasFees, bytes paymasterAndData, bytes signature) userOp) view returns (bytes32)'
    ];
    
    this.entryPoint = new ethers.Contract(config.entryPointAddress, this.entryPointAbi, this.provider);
    
    this.accountAbi = [
      'function execute(address dest, uint256 value, bytes calldata func) external',
      'function executeBatch(address[] calldata dest, uint256[] calldata value, bytes[] calldata func) external',
      'function getNonce() view returns (uint256)'
    ];
    
    this.account = null;
    if (this.config.proxyAddress) {
      this.setProxyAddress(this.config.proxyAddress);
    }
  }

  setProxyAddress(proxyAddress) {
    this.config.proxyAddress = proxyAddress;
    this.account = new ethers.Contract(proxyAddress, this.accountAbi, this.provider);
    return proxyAddress;
  }

  getAccountAddress(owner, salt = 0n) {
    const network = NETWORKS[this.config.network];
    if (!network) {
      throw new Error(`Unsupported network for AA address derivation: ${this.config.network}`);
    }
    const initializeCallData = new ethers.Interface([
      'function initialize(address)'
    ]).encodeFunctionData('initialize', [owner]);
    const constructorArgs = ethers.AbiCoder.defaultAbiCoder().encode(
      ['address', 'bytes'],
      [network.accountImplementation, initializeCallData]
    );
    const fullCreationCode = ERC1967_PROXY_CREATION_CODE + constructorArgs.slice(2);
    return ethers.getCreate2Address(
      network.accountFactory,
      ethers.zeroPadValue(ethers.toBeHex(salt), 32),
      ethers.keccak256(fullCreationCode)
    );
  }

  ensureAccountAddress(owner, salt = 0n) {
    this.config.ownerAddress = owner;
    this.config.salt = salt;
    const aaAddress = this.getAccountAddress(owner, salt);
    this.setProxyAddress(aaAddress);
    return aaAddress;
  }

  buildInitCode(owner, salt = 0n) {
    const network = NETWORKS[this.config.network];
    if (!network) {
      throw new Error(`Unsupported network for initCode: ${this.config.network}`);
    }
    const factoryIface = new ethers.Interface([
      'function createAccount(address owner, uint256 salt) returns (address)'
    ]);
    const callData = factoryIface.encodeFunctionData('createAccount', [owner, salt]);
    return network.accountFactory + callData.slice(2);
  }

  async isAccountDeployed(address) {
    const code = await this.provider.getCode(address);
    return code && code !== '0x';
  }

  async getNonce() {
    if (!this.config.proxyAddress) {
      throw new Error('AA wallet address is not set. Call ensureAccountAddress(owner) first.');
    }
    try {
      return await this.entryPoint.getNonce(this.config.proxyAddress, 0);
    } catch {
      return 0n;
    }
  }

  packAccountGasLimits(verificationGasLimit, callGasLimit) {
    const packed = (verificationGasLimit << 128n) | callGasLimit;
    return ethers.zeroPadValue(ethers.toBeHex(packed), 32);
  }

  packGasFees(maxPriorityFeePerGas, maxFeePerGas) {
    const packed = (maxPriorityFeePerGas << 128n) | maxFeePerGas;
    return ethers.zeroPadValue(ethers.toBeHex(packed), 32);
  }

  async getUserOpHash(userOp) {
    const accountGasLimits = this.packAccountGasLimits(userOp.verificationGasLimit, userOp.callGasLimit);
    const gasFees = this.packGasFees(userOp.maxPriorityFeePerGas, userOp.maxFeePerGas);
    
    const formattedUserOp = {
      sender: userOp.sender,
      nonce: userOp.nonce,
      initCode: userOp.initCode,
      callData: userOp.callData,
      accountGasLimits: accountGasLimits,
      preVerificationGas: userOp.preVerificationGas,
      gasFees: gasFees,
      paymasterAndData: userOp.paymasterAndData,
      signature: userOp.signature
    };

    return await this.entryPoint.getUserOpHash(formattedUserOp);
  }

  async sendUserOperationAndWait(request, signFunction) {
    try {
      if (!this.config.proxyAddress || !this.account) {
        throw new Error('AA wallet address is not set. Call ensureAccountAddress(owner) first.');
      }
      const nonce = await this.getNonce();
      const executeCallData = this.account.interface.encodeFunctionData('execute', [
        request.target,
        request.value,
        request.callData
      ]);
      const isDeployed = await this.isAccountDeployed(this.config.proxyAddress);
      const ownerAddress = this.config.ownerAddress;
      const salt = this.config.salt ?? 0n;
      if (!isDeployed && !ownerAddress) {
        throw new Error('AA account not deployed and ownerAddress is missing. Call ensureAccountAddress(owner) first.');
      }

      const userOp = {
        sender: this.config.proxyAddress,
        nonce: nonce.toString(),
        initCode: isDeployed ? '0x' : this.buildInitCode(ownerAddress, salt),
        callData: executeCallData,
        // First tx (account undeployed) needs much higher gas for initCode validation + deployment.
        callGasLimit: isDeployed ? 100000n : 300000n,
        verificationGasLimit: isDeployed ? 100000n : 1500000n,
        preVerificationGas: isDeployed ? 50000n : 300000n,
        maxFeePerGas: 1000000000n,
        maxPriorityFeePerGas: 1000000000n,
        paymasterAndData: '0x',
        signature: '0x'
      };

      const userOpHash = await this.getUserOpHash(userOp);
      const signature = await signFunction(userOpHash);
      userOp.signature = signature;

      const userOpHashFromBundler = await this.sendToBundler(userOp);
      const receipt = await this.waitForUserOperation(userOpHashFromBundler);

      return {
        status: receipt.success ? 'success' : 'failed',
        transactionHash: receipt.transactionHash,
        userOpHash: userOpHashFromBundler,
        receipt: receipt
      };
    } catch (error) {
      return { status: 'failed', reason: error.message, error: error };
    }
  }

  async sendBatchUserOperationAndWait(batchRequest, signFunction) {
    try {
      if (!this.config.proxyAddress || !this.account) {
        throw new Error('AA wallet address is not set. Call ensureAccountAddress(owner) first.');
      }
      const nonce = await this.getNonce();
      const normalizedValues = batchRequest.values.length === 0 
        ? new Array(batchRequest.targets.length).fill(0n)
        : batchRequest.values;
      const isDeployed = await this.isAccountDeployed(this.config.proxyAddress);
      const ownerAddress = this.config.ownerAddress;
      const salt = this.config.salt ?? 0n;
      if (!isDeployed && !ownerAddress) {
        throw new Error('AA account not deployed and ownerAddress is missing. Call ensureAccountAddress(owner) first.');
      }

      const executeBatchCallData = this.account.interface.encodeFunctionData('executeBatch', [
        batchRequest.targets,
        normalizedValues,
        batchRequest.callDatas
      ]);

      const userOp = {
        sender: this.config.proxyAddress,
        nonce: nonce.toString(),
        initCode: isDeployed ? '0x' : this.buildInitCode(ownerAddress, salt),
        callData: executeBatchCallData,
        callGasLimit: isDeployed ? 200000n : 400000n,
        verificationGasLimit: isDeployed ? 200000n : 1800000n,
        preVerificationGas: isDeployed ? 100000n : 350000n,
        maxFeePerGas: 1000000000n,
        maxPriorityFeePerGas: 1000000000n,
        paymasterAndData: '0x',
        signature: '0x'
      };

      const userOpHash = await this.getUserOpHash(userOp);
      const signature = await signFunction(userOpHash);
      userOp.signature = signature;

      const userOpHashFromBundler = await this.sendToBundler(userOp);
      const receipt = await this.waitForUserOperation(userOpHashFromBundler);

      return {
        status: receipt.success ? 'success' : 'failed',
        transactionHash: receipt.transactionHash,
        userOpHash: userOpHashFromBundler,
        receipt: receipt
      };
    } catch (error) {
      return { status: 'failed', reason: error.message, error: error };
    }
  }

  async sendERC20(request, signFunction) {
    const erc20Interface = new ethers.Interface([
      'function transfer(address to, uint256 amount) returns (bool)'
    ]);

    return this.sendUserOperationAndWait({
      target: request.tokenAddress,
      value: 0n,
      callData: erc20Interface.encodeFunctionData('transfer', [request.recipient, request.amount])
    }, signFunction);
  }

  async approveERC20(request, signFunction) {
    const erc20Interface = new ethers.Interface([
      'function approve(address spender, uint256 amount) returns (bool)'
    ]);

    return this.sendUserOperationAndWait({
      target: request.tokenAddress,
      value: 0n,
      callData: erc20Interface.encodeFunctionData('approve', [request.spender, request.amount])
    }, signFunction);
  }

  async getBalance() {
    return this.provider.getBalance(this.config.proxyAddress);
  }

  async getERC20Balance(tokenAddress) {
    const erc20Interface = new ethers.Interface([
      'function balanceOf(address account) view returns (uint256)'
    ]);

    const data = erc20Interface.encodeFunctionData('balanceOf', [this.config.proxyAddress]);
    const result = await this.provider.call({ to: tokenAddress, data: data });
    return ethers.getBigInt(result);
  }

  async sendToBundler(userOp) {
    const formatHex = (value) => {
      if (typeof value === 'bigint' || typeof value === 'number') {
        return '0x' + value.toString(16);
      }
      if (typeof value === 'string' && value.startsWith('0x')) {
        return value;
      }
      return '0x' + BigInt(value).toString(16);
    };

    const request = {
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_sendUserOperation',
      params: [
        {
          sender: userOp.sender,
          nonce: formatHex(userOp.nonce),
          initCode: userOp.initCode,
          callData: userOp.callData,
          callGasLimit: formatHex(userOp.callGasLimit),
          verificationGasLimit: formatHex(userOp.verificationGasLimit),
          preVerificationGas: formatHex(userOp.preVerificationGas),
          maxFeePerGas: formatHex(userOp.maxFeePerGas),
          maxPriorityFeePerGas: formatHex(userOp.maxPriorityFeePerGas),
          paymasterAndData: userOp.paymasterAndData,
          signature: userOp.signature
        },
        this.config.entryPointAddress
      ]
    };

    const response = await fetch(this.config.bundlerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request)
    });

    const result = await response.json();
    
    if (result.error) {
      throw new Error(`Bundler error: ${result.error.message}`);
    }

    return result.result;
  }

  async waitForUserOperation(userOpHash, timeout = 60000, pollInterval = 2000) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const receipt = await this.getUserOperationReceipt(userOpHash);
      
      if (receipt) {
        return {
          success: receipt.success,
          transactionHash: receipt.receipt.transactionHash,
          blockNumber: receipt.receipt.blockNumber,
          gasUsed: receipt.receipt.gasUsed,
          actualGasCost: receipt.actualGasCost,
          actualGasUsed: receipt.actualGasUsed,
          receipt: receipt
        };
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    throw new Error(`Timeout waiting for UserOperation ${userOpHash}`);
  }

  async getUserOperationReceipt(userOpHash) {
    const request = {
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_getUserOperationReceipt',
      params: [userOpHash]
    };

    const response = await fetch(this.config.bundlerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request)
    });

    const result = await response.json();
    
    if (result.error) {
      throw new Error(`Bundler error: ${result.error.message}`);
    }

    return result.result;
  }
}


