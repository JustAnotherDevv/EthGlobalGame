export const config = {
  privateKey: process.env.PRIVATE_KEY as `0x${string}`,
  port: parseInt(process.env.GAME_PORT || '3002', 10),
  yellowWsUrl: process.env.YELLOW_WS_URL || 'wss://clearnet-sandbox.yellow.com/ws',
  yellowToken: (process.env.YELLOW_TOKEN || '0xDB9F293e3898c9E5536A3be1b0C56c89d2b32DEb') as `0x${string}`,
  yellowCustody: (process.env.YELLOW_CUSTODY || '0x019B65A265EB3363822f2752141b3dF16131b262') as `0x${string}`,
  yellowAdjudicator: (process.env.YELLOW_ADJUDICATOR || '0x7c7ccbc98469190849BCC6c926307794fDfB11F2') as `0x${string}`,
  wagerAmount: parseInt(process.env.WAGER_AMOUNT || '5', 10),
  rpcUrl: process.env.RPC_URL || 'https://1rpc.io/sepolia',
};
