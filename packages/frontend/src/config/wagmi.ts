import { getDefaultConfig } from '@rainbow-me/rainbowkit'
import { mainnet, polygon, optimism, arbitrum, base, sepolia } from 'wagmi/chains'

export const config = getDefaultConfig({
  appName: '3D Controller Game',
  projectId: 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6', // Get your own from https://cloud.walletconnect.com
  chains: [mainnet, polygon, optimism, arbitrum, base, sepolia],
  ssr: false,
})
