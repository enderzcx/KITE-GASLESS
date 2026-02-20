require('dotenv').config();
require('@nomicfoundation/hardhat-ethers');

const { RPC_URL, PRIVATE_KEY } = process.env;

module.exports = {
  solidity: {
    version: '0.8.28',
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      },
      viaIR: true
    }
  },
  networks: {
    kite: {
      url: RPC_URL || 'https://rpc-testnet.gokite.ai/',
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : []
    }
  }
};
