import { ethers } from 'ethers';

export async function pollOnChainConfirmation({
  endpoint,
  hash,
  expectedTo,
  expectedAmount,
  tokenDecimals,
  onState,
  retries = 12,
  intervalMs = 3000
}) {
  const expectedToLc = (expectedTo || '').toLowerCase();
  let expectedRaw = '';

  try {
    expectedRaw = ethers.parseUnits(String(expectedAmount || '0'), tokenDecimals).toString();
  } catch {
    expectedRaw = '';
  }

  for (let i = 0; i < retries; i += 1) {
    try {
      const query = `
        {
          transfers(
            first: 1,
            where: { transactionHash: "${String(hash || '').toLowerCase()}" },
            orderBy: blockTimestamp,
            orderDirection: desc
          ) {
            transactionHash
            blockNumber
            from
            to
            value
          }
        }
      `;

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query })
      });
      const json = await res.json();
      const row = json?.data?.transfers?.[0];

      if (row) {
        const isMatch =
          (!expectedToLc || String(row.to || '').toLowerCase() === expectedToLc) &&
          (!expectedRaw || String(row.value) === expectedRaw);

        onState({
          stage: 'confirmed',
          message: 'On-chain confirmation received.',
          txHash: row.transactionHash || hash,
          blockNumber: String(row.blockNumber || ''),
          from: row.from || '',
          to: row.to || '',
          valueRaw: String(row.value || ''),
          match: isMatch
        });
        return;
      }

      onState((prev) => ({
        ...prev,
        stage: 'indexing',
        message: `Indexing on-chain data... retry ${i + 1}/${retries}`
      }));
    } catch {
      onState((prev) => ({
        ...prev,
        stage: 'indexing',
        message: `Querying Goldsky... retry ${i + 1}/${retries}`
      }));
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  onState((prev) => ({
    ...prev,
    stage: 'timeout',
    message: 'Timed out waiting for indexed confirmation. You can verify by tx hash in On-chain page.'
  }));
}
