import 'dotenv/config';
import { GameClient } from './GameClient.js';
import { ServerMsgType } from '../shared/protocol.js';
import type { ServerMsg } from '../shared/protocol.js';

const PRIVATE_KEY = process.env.PLAYER_PRIVATE_KEY as `0x${string}`;
if (!PRIVATE_KEY) {
  console.error('Set PLAYER_PRIVATE_KEY env var');
  process.exit(1);
}

const SERVER_URL = process.env.GAME_SERVER_URL || 'ws://localhost:3002';

async function main() {
  const client = new GameClient({
    serverUrl: SERVER_URL,
    privateKey: PRIVATE_KEY,
  });

  let gameActive = false;
  let posInterval: ReturnType<typeof setInterval> | null = null;
  let px = 0, pz = 0;

  client.onMessage = (msg: ServerMsg) => {
    if (msg.type === ServerMsgType.GameStarted) {
      gameActive = true;
      // Simulate random walking
      posInterval = setInterval(() => {
        px += (Math.random() - 0.5) * 2;
        pz += (Math.random() - 0.5) * 2;
        client.sendPosition(px, 0, pz);
      }, 100);

      // Try digging at random spots
      setTimeout(() => {
        if (gameActive) client.startDig(px, 0, pz);
      }, 5000);
    }

    if (msg.type === ServerMsgType.GameEnded) {
      gameActive = false;
      if (posInterval) clearInterval(posInterval);
    }
  };

  await client.connect();
  console.log('[Controller] Connected, joining room...');
  client.joinRoom();
}

main().catch(console.error);
