import WebSocket from 'ws';
import { ClientMsgType, ServerMsgType } from '../shared/protocol.js';
import type { ClientMsg, ServerMsg } from '../shared/protocol.js';
import { YellowClient } from './YellowClient.js';

export interface GameClientConfig {
  serverUrl: string;
  privateKey: `0x${string}`;
}

export class GameClient {
  private ws!: WebSocket;
  private yellowClient: YellowClient;
  private address: string;
  playerId: string | null = null;
  roomId: string | null = null;
  onMessage?: (msg: ServerMsg) => void;

  constructor(private cfg: GameClientConfig) {
    this.yellowClient = new YellowClient({ privateKey: cfg.privateKey });
    this.address = this.yellowClient.address;
  }

  async connect(): Promise<void> {
    console.log('[GameClient] Connecting to Yellow...');
    await this.yellowClient.connect();
    console.log('[GameClient] Yellow ready');

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.cfg.serverUrl);

      this.ws.on('open', () => {
        console.log('[GameClient] Connected to game server');
        resolve();
      });

      this.ws.on('error', reject);

      this.ws.on('message', (raw) => {
        let msg: ServerMsg;
        try { msg = JSON.parse(raw.toString()); }
        catch { return; }

        this.handleServerMessage(msg);
        this.onMessage?.(msg);
      });

      this.ws.on('close', () => {
        console.log('[GameClient] Disconnected');
      });
    });
  }

  private async handleServerMessage(msg: ServerMsg) {
    switch (msg.type) {
      case ServerMsgType.RoomJoined:
        this.playerId = msg.playerId;
        this.roomId = msg.roomId;
        console.log(`[GameClient] Joined room ${msg.roomId} as ${msg.playerId}`);
        break;

      case ServerMsgType.WagerRequired:
        console.log(`[GameClient] Wager required: ${msg.amount} ${msg.asset}`);
        try {
          await this.yellowClient.transferTo(msg.serverAddress, msg.amount);
          this.send({ type: ClientMsgType.WagerConfirmed });
          console.log('[GameClient] Wager sent');
        } catch (e) {
          console.error('[GameClient] Wager transfer failed:', e);
        }
        break;

      case ServerMsgType.WagerAccepted:
        console.log(`[GameClient] Wager accepted for ${msg.playerId}`);
        break;

      case ServerMsgType.GameStarting:
        console.log(`[GameClient] Game starting in ${msg.countdown}ms`);
        break;

      case ServerMsgType.GameStarted:
        console.log(`[GameClient] Game started! Seed: ${msg.seed}, Resources: ${msg.resources.length}`);
        break;

      case ServerMsgType.ChestFound:
        console.log(`[GameClient] Chest found by ${msg.playerId}!`);
        break;

      case ServerMsgType.GameEnded:
        console.log(`[GameClient] Game ended: ${msg.reason}, winner: ${msg.winnerId}`);
        break;

      case ServerMsgType.PayoutComplete:
        console.log(`[GameClient] Payout: ${msg.amount} to ${msg.winnerId}`);
        break;

      case ServerMsgType.Error:
        console.error(`[GameClient] Error: ${msg.message}`);
        break;
    }
  }

  joinRoom() {
    this.send({ type: ClientMsgType.JoinRoom, address: this.address });
  }

  sendPosition(x: number, y: number, z: number) {
    this.send({ type: ClientMsgType.PositionUpdate, position: { x, y, z } });
  }

  startHarvest(resourceId: string) {
    this.send({ type: ClientMsgType.StartHarvest, resourceId });
  }

  startDig(x: number, y: number, z: number) {
    this.send({ type: ClientMsgType.StartDig, position: { x, y, z } });
  }

  leave() {
    this.send({ type: ClientMsgType.LeaveRoom });
  }

  private send(msg: ClientMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }
}
