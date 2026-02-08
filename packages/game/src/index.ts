import 'dotenv/config';
import { YellowService } from './server/YellowService.js';
import { WagerManager } from './server/WagerManager.js';
import { GameServer } from './server/GameServer.js';
import { config } from './config.js';

process.on('unhandledRejection', (e) => console.error('UNHANDLED REJECTION:', e));
process.on('uncaughtException', (e) => console.error('UNCAUGHT EXCEPTION:', e));

async function main() {
  if (!config.privateKey) {
    throw new Error('Missing PRIVATE_KEY');
  }

  console.log('[Game] Starting...');

  const yellowService = new YellowService();
  await yellowService.connect();
  console.log('[Game] Yellow service connected');

  const wagerManager = new WagerManager(yellowService);
  const gameServer = new GameServer(yellowService, wagerManager);
  gameServer.start();

  console.log('[Game] Server ready');
}

main().catch((e) => {
  console.error('[Game] Fatal:', e);
  process.exit(1);
});
