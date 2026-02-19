# Agent Metadata (TokenURI)

This folder contains public metadata JSON files used as ERC-8004 `tokenURI` targets.

## GitHub Raw URLs (use immediately)

- Agent 1:
  `https://raw.githubusercontent.com/enderzcx/KITE-GASLESS/main/metadata/agent-1.json`
- Agent 2:
  `https://raw.githubusercontent.com/enderzcx/KITE-GASLESS/main/metadata/agent-2.json`

## Important

If an agent was already registered with an old or invalid `tokenURI`, that token keeps the old URI unless your registry supports metadata update.

In most demos, the simplest way is:

1. Register a new agent with the new `tokenURI`.
2. Use the new `agentId` for demo/UI mapping.

## Move to IPFS later

When ready, upload these two JSON files to IPFS and replace with:

- `ipfs://<CID-for-agent-1>`
- `ipfs://<CID-for-agent-2>`

This improves permanence and verifiability for judging.
