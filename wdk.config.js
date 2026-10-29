// WDK worklet bundle config (read by `npx wdk-worklet-bundler generate`).
// Only the ERC-4337 EVM wallet: Sepolia, with gas paid in test USDt through
// the Candide paymaster, so the demo never needs Sepolia ETH.
module.exports = {
  networks: {
    ethereum: {
      package: '@tetherto/wdk-wallet-evm-erc-4337',
    },
  },
};
