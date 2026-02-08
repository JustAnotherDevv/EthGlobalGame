import { RoomPhase, ResourceType } from '../shared/types.js';
import type { PlayerState, Resource, Vec3 } from '../shared/types.js';
import { ServerMsgType, ClientMsgType } from '../shared/protocol.js';
import type { ClientMsg, ServerMsg } from '../shared/protocol.js';
import {
  MIN_PLAYERS, MAX_PLAYERS, GAME_TIMEOUT_MS, HARVEST_DURATION_MS,
  DIG_DURATION_MS, CHEST_FIND_RADIUS, MAX_SPEED, SPEED_TOLERANCE,
  HARVEST_PROXIMITY, COUNTDOWN_MS, SYNC_BROADCAST_RATE_MS,
  BERRY_SPEED_BONUS, DIG_UPGRADE_STONE_COST, DIG_UPGRADE_WOOD_COST,
  DIG_UPGRADE_MULTIPLIER, MAP_WOOD_COST, MAP_REVEAL_RADIUS,
} from '../shared/constants.js';
import { generateChestPosition, generateResources, isOnIsland } from '../shared/island.js';
import type { PlayerSession } from './PlayerSession.js';
import { ActionQueue } from './ActionQueue.js';
import type { WagerManager } from './WagerManager.js';
import { config } from '../config.js';

let roomCounter = 0;

export class GameRoom {
  readonly id: string;
  phase: RoomPhase = RoomPhase.Lobby;
  private seed: number;
  private players = new Map<string, PlayerSession>();
  private resources: Resource[] = [];
  private chestPosition: Vec3;
  createdAt = Date.now();
  private countdownTimer: ReturnType<typeof setTimeout> | null = null;
  private actionQueue = new ActionQueue();
  private syncInterval: ReturnType<typeof setInterval> | null = null;
  onEmpty?: () => void;

  constructor(
    private wagerManager: WagerManager,
    private serverAddress: string,
  ) {
    this.id = `room_${++roomCounter}_${Date.now().toString(36)}`;
    this.seed = Math.floor(Math.random() * 1_000_000);
    this.chestPosition = generateChestPosition(this.seed);
  }

  get playerCount() { return this.players.size; }
  get isFull() { return this.players.size >= MAX_PLAYERS; }

  addPlayer(session: PlayerSession) {
    if (this.phase !== RoomPhase.Lobby) {
      session.send({ type: ServerMsgType.Error, message: 'Game already in progress' });
      return;
    }
    if (this.isFull) {
      session.send({ type: ServerMsgType.Error, message: 'Room is full' });
      return;
    }

    session.roomId = this.id;
    this.players.set(session.id, session);

    session.send({
      type: ServerMsgType.RoomJoined,
      roomId: this.id,
      playerId: session.id,
      phase: this.phase,
      players: this.getPlayerStates(),
    });

    session.send({
      type: ServerMsgType.WagerRequired,
      amount: config.wagerAmount,
      serverAddress: this.serverAddress,
      asset: 'ytest.usd',
    });
  }

  removePlayer(session: PlayerSession) {
    this.actionQueue.cancelAction(session);
    this.players.delete(session.id);
    session.roomId = null;

    this.broadcast({ type: ServerMsgType.PlayerLeft, playerId: session.id });

    if (this.phase === RoomPhase.Lobby && !this.wagerManager.isPlayerWagered(this.id, session.id)) {
      // no refund needed
    } else if (this.phase === RoomPhase.Lobby) {
      this.wagerManager.refundAll(this.id).catch(() => {});
    }

    if (this.players.size === 0) {
      this.cleanup();
      this.onEmpty?.();
    } else if (this.phase === RoomPhase.Playing && this.players.size < 1) {
      this.endGame(null, 'abandoned');
    }
  }

  async handleMessage(session: PlayerSession, msg: ClientMsg) {
    switch (msg.type) {
      case ClientMsgType.WagerConfirmed:
        await this.handleWagerConfirmed(session);
        break;
      case ClientMsgType.PositionUpdate:
        this.handlePositionUpdate(session, msg.position);
        break;
      case ClientMsgType.StartHarvest:
        this.handleStartHarvest(session, msg.resourceId);
        break;
      case ClientMsgType.StartDig:
        this.handleStartDig(session, msg.position);
        break;
      case ClientMsgType.CancelHarvest:
      case ClientMsgType.CancelDig:
        this.actionQueue.cancelAction(session);
        break;
      case ClientMsgType.Ping:
        session.send({ type: ServerMsgType.Pong, t: msg.t });
        break;
      case ClientMsgType.LeaveRoom:
        this.removePlayer(session);
        break;
      default:
        break;
    }
  }

  private async handleWagerConfirmed(session: PlayerSession) {
    if (this.phase !== RoomPhase.Lobby) return;
    if (session.wagered) return;

    session.wagered = true;
    this.wagerManager.recordWager(this.id, session.id, session.address, config.wagerAmount);

    this.broadcast({ type: ServerMsgType.WagerAccepted, playerId: session.id });
    this.checkStartConditions();
  }

  private checkStartConditions() {
    const ids = Array.from(this.players.keys());
    if (ids.length >= MIN_PLAYERS && this.wagerManager.allPlayersWagered(this.id, ids)) {
      if (this.countdownTimer) return;
      this.broadcast({ type: ServerMsgType.GameStarting, countdown: COUNTDOWN_MS });
      this.countdownTimer = setTimeout(() => this.startGame(), COUNTDOWN_MS);
    }
  }

  private startGame() {
    this.phase = RoomPhase.Playing;
    this.resources = generateResources(this.seed);

    console.log(`[Game ${this.id}] Started | seed=${this.seed} | chest=(${this.chestPosition.x.toFixed(1)}, ${this.chestPosition.z.toFixed(1)})`);

    this.broadcast({
      type: ServerMsgType.GameStarted,
      seed: this.seed,
      resources: this.resources,
    });

    this.syncInterval = setInterval(() => this.broadcastSync(), SYNC_BROADCAST_RATE_MS);

    setTimeout(() => {
      if (this.phase === RoomPhase.Playing) {
        this.endGame(null, 'timeout');
      }
    }, GAME_TIMEOUT_MS);
  }

  private handlePositionUpdate(session: PlayerSession, position: Vec3) {
    if (this.phase !== RoomPhase.Playing) return;
    if (session.currentAction !== 'idle') return;

    const now = Date.now();
    const dt = (now - session.lastPositionTime) / 1000;
    if (session.lastPositionTime > 0 && dt > 0) {
      const dx = position.x - session.position.x;
      const dz = position.z - session.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      const speed = dist / dt;
      const playerMaxSpeed = MAX_SPEED * session.upgrades.speedMultiplier;
      if (speed > playerMaxSpeed * SPEED_TOLERANCE) {
        session.send({ type: ServerMsgType.Error, message: 'Moving too fast' });
        return;
      }
    }

    session.position = position;
    session.lastPositionTime = now;

    this.broadcast({
      type: ServerMsgType.PlayerMoved,
      playerId: session.id,
      position,
    });
  }

  private handleStartHarvest(session: PlayerSession, resourceId: string) {
    if (this.phase !== RoomPhase.Playing) return;
    if (session.currentAction !== 'idle') {
      session.send({ type: ServerMsgType.Error, message: 'Already performing action' });
      return;
    }

    const resource = this.resources.find(r => r.id === resourceId);
    if (!resource || resource.harvested) {
      session.send({ type: ServerMsgType.Error, message: 'Invalid resource' });
      return;
    }

    const dx = session.position.x - resource.position.x;
    const dz = session.position.z - resource.position.z;
    if (Math.sqrt(dx * dx + dz * dz) > HARVEST_PROXIMITY) {
      session.send({ type: ServerMsgType.Error, message: 'Too far from resource' });
      return;
    }

    this.broadcast({ type: ServerMsgType.HarvestStarted, playerId: session.id, resourceId });

    this.actionQueue.startAction(session, 'harvesting', HARVEST_DURATION_MS, () => {
      resource.harvested = true;
      this.applyHarvest(session, resource);
    });
  }

  private applyHarvest(session: PlayerSession, resource: Resource) {
    switch (resource.type) {
      case ResourceType.Berry:
        session.inventory.berry++;
        session.upgrades.speedMultiplier = 1.0 + session.inventory.berry * BERRY_SPEED_BONUS;
        session.send({ type: ServerMsgType.UpgradeUnlocked, playerId: session.id, upgrade: 'speed' });
        break;
      case ResourceType.Wood:
        session.inventory.wood++;
        break;
      case ResourceType.Stone:
        session.inventory.stone++;
        break;
    }

    // Check dig speed upgrade threshold
    const possibleDigUpgrades = Math.min(
      Math.floor(session.inventory.stone / DIG_UPGRADE_STONE_COST),
      Math.floor(session.inventory.wood / DIG_UPGRADE_WOOD_COST),
    );
    if (possibleDigUpgrades > session.upgrades.digUpgradesTaken) {
      session.upgrades.digUpgradesTaken = possibleDigUpgrades;
      session.upgrades.digMultiplier = Math.pow(DIG_UPGRADE_MULTIPLIER, possibleDigUpgrades);
      session.send({ type: ServerMsgType.UpgradeUnlocked, playerId: session.id, upgrade: 'dig_speed' });
    }

    // Check map unlock
    if (!session.upgrades.hasMap && session.inventory.wood >= MAP_WOOD_COST) {
      session.upgrades.hasMap = true;
      session.send({ type: ServerMsgType.UpgradeUnlocked, playerId: session.id, upgrade: 'map' });
      // Reveal approximate chest area (offset by random amount within MAP_REVEAL_RADIUS)
      const angle = Math.random() * Math.PI * 2;
      const offset = Math.random() * MAP_REVEAL_RADIUS * 0.5;
      session.send({
        type: ServerMsgType.MapRevealed,
        center: {
          x: this.chestPosition.x + Math.cos(angle) * offset,
          y: 0,
          z: this.chestPosition.z + Math.sin(angle) * offset,
        },
        radius: MAP_REVEAL_RADIUS,
      });
    }

    this.broadcast({
      type: ServerMsgType.HarvestComplete,
      playerId: session.id,
      resourceId: resource.id,
      resourceType: resource.type,
      inventory: { ...session.inventory },
      upgrades: { ...session.upgrades },
    });
  }

  private handleStartDig(session: PlayerSession, position: Vec3) {
    if (this.phase !== RoomPhase.Playing) return;
    if (session.currentAction !== 'idle') {
      session.send({ type: ServerMsgType.Error, message: 'Already performing action' });
      return;
    }

    if (!isOnIsland(position.x, position.z, this.seed)) {
      session.send({ type: ServerMsgType.Error, message: 'Cannot dig here' });
      return;
    }

    this.broadcast({ type: ServerMsgType.DigStarted, playerId: session.id, position });

    const digTime = Math.max(10, Math.floor(DIG_DURATION_MS * session.upgrades.digMultiplier));

    this.actionQueue.startAction(session, 'digging', digTime, () => {
      const dx = position.x - this.chestPosition.x;
      const dz = position.z - this.chestPosition.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist < CHEST_FIND_RADIUS) {
        this.broadcast({ type: ServerMsgType.ChestFound, playerId: session.id, position: this.chestPosition });
        this.endGame(session.id, 'chest_found');
      } else {
        this.broadcast({ type: ServerMsgType.DigComplete, playerId: session.id, found: false });
      }
    });
  }

  private async endGame(winnerId: string | null, reason: 'chest_found' | 'timeout' | 'abandoned') {
    if (this.phase === RoomPhase.Ended) return;
    this.phase = RoomPhase.Ended;

    if (this.syncInterval) clearInterval(this.syncInterval);
    if (this.countdownTimer) clearTimeout(this.countdownTimer);

    this.broadcast({ type: ServerMsgType.GameEnded, winnerId, reason });

    try {
      if (winnerId && reason === 'chest_found') {
        const winner = this.players.get(winnerId);
        if (winner) {
          const pot = this.wagerManager.getPot(this.id);
          await this.wagerManager.payoutWinner(this.id, winner.address);
          this.broadcast({ type: ServerMsgType.PayoutComplete, winnerId, amount: pot });
        }
      } else {
        await this.wagerManager.refundAll(this.id);
        this.broadcast({ type: ServerMsgType.PayoutComplete, winnerId: null, amount: 0 });
      }
    } catch (e) {
      console.error(`[Room ${this.id}] Payout error:`, e);
    }

    setTimeout(() => this.cleanup(), 10_000);
  }

  private broadcast(msg: ServerMsg) {
    for (const session of this.players.values()) {
      session.send(msg);
    }
  }

  private broadcastSync() {
    this.broadcast({
      type: ServerMsgType.PlayersSync,
      players: this.getPlayerStates(),
    });
  }

  private getPlayerStates(): PlayerState[] {
    return Array.from(this.players.values()).map(s => ({
      id: s.id,
      address: s.address,
      position: s.position,
      score: 0,
      currentAction: s.currentAction,
      connected: s.ws.readyState === s.ws.OPEN,
      inventory: { ...s.inventory },
      upgrades: { ...s.upgrades },
    }));
  }

  private cleanup() {
    if (this.syncInterval) clearInterval(this.syncInterval);
    if (this.countdownTimer) clearTimeout(this.countdownTimer);
    for (const session of this.players.values()) {
      this.actionQueue.cancelAction(session);
    }
  }
}
