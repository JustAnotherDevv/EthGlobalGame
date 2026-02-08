import type WebSocket from 'ws';
import type { Vec3, Inventory, PlayerUpgrades } from '../shared/types.js';
import type { ServerMsg } from '../shared/protocol.js';

let nextId = 0;

export class PlayerSession {
  readonly id: string;
  address = '';
  roomId: string | null = null;
  position: Vec3 = { x: 0, y: 0, z: 0 };
  lastPositionTime = 0;
  currentAction: 'idle' | 'harvesting' | 'digging' = 'idle';
  actionTimer: ReturnType<typeof setTimeout> | null = null;
  wagered = false;

  inventory: Inventory = { wood: 0, stone: 0, berry: 0 };
  upgrades: PlayerUpgrades = {
    speedMultiplier: 1.0,
    digMultiplier: 1.0,
    hasMap: false,
    digUpgradesTaken: 0,
  };

  constructor(readonly ws: WebSocket) {
    this.id = `p_${++nextId}_${Date.now().toString(36)}`;
  }

  send(msg: ServerMsg) {
    if (this.ws.readyState === this.ws.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }
}
