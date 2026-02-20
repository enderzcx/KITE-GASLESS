const { ethers } = require('hardhat');

async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error('No deployer signer. Set PRIVATE_KEY in aa-v2/.env');
  }

  const entryPointAddress = process.env.ENTRY_POINT_ADDRESS || '0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108';
  if (!ethers.isAddress(entryPointAddress)) {
    throw new Error(`Invalid ENTRY_POINT_ADDRESS: ${entryPointAddress}`);
  }

  console.log('[deploy-v2] deployer:', deployer.address);
  console.log('[deploy-v2] entryPoint:', entryPointAddress);

  const Factory = await ethers.getContractFactory('GokiteAccountV2');
  const implementation = await Factory.deploy(entryPointAddress);
  await implementation.waitForDeployment();
  const implAddr = await implementation.getAddress();

  console.log('[deploy-v2] GokiteAccountV2 implementation:', implAddr);
}

main().catch((error) => {
  console.error('[deploy-v2] failed:', error);
  process.exit(1);
});

