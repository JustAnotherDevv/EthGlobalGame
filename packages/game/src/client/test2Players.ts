import 'dotenv/config';
import WebSocket from 'ws';
import { ClientMsgType, ServerMsgType } from '../shared/protocol.js';
import type { ServerMsg, HarvestCompleteMsg, MapRevealedMsg } from '../shared/protocol.js';
import type { ClientMsg } from '../shared/protocol.js';
import type { Resource, Vec3, Inventory, PlayerUpgrades } from '../shared/types.js';
import { ResourceType } from '../shared/types.js';
import { isOnIsland } from '../shared/island.js';
import { DIG_DURATION_MS } from '../shared/constants.js';

const SERVER_URL = process.env.GAME_SERVER_URL || 'ws://localhost:3002';

const WALK_SPEED = 150;
const STEP_INTERVAL = 5;
const STEP_DIST = WALK_SPEED * (STEP_INTERVAL / 1000);

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

function dist2D(a: Vec3, b: Vec3) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

type MsgFilter = (msg: ServerMsg) => boolean;

class TestPlayer {
  private ws!: WebSocket;
  pos: Vec3 = { x: 0, y: 0, z: 0 };
  id: string | null = null;
  roomId: string | null = null;
  seed: number | null = null;
  resources: Resource[] = [];
  harvestedIds = new Set<string>();
  inventory: Inventory = { wood: 0, stone: 0, berry: 0 };
  upgrades: PlayerUpgrades = { speedMultiplier: 1, digMultiplier: 1, hasMap: false, digUpgradesTaken: 0 };
  mapCenter: Vec3 | null = null;
  mapRadius = 0;
  gameStarted = false;
  gameEnded = false;
  private msgQueue: ServerMsg[] = [];
  private waiters: Array<{ filter: MsgFilter; resolve: (msg: ServerMsg) => void }> = [];

  constructor(readonly name: string, private address: string) {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(SERVER_URL);
      this.ws.on('open', () => { this.log('Connected'); resolve(); });
      this.ws.on('error', reject);
      this.ws.on('message', (raw) => {
        let msg: ServerMsg;
        try { msg = JSON.parse(raw.toString()); } catch { return; }
        this.dispatch(msg);
      });
      this.ws.on('close', () => this.log('Disconnected'));
    });
  }

  private dispatch(msg: ServerMsg) {
    if (msg.type === ServerMsgType.RoomJoined) {
      this.id = msg.playerId;
      this.roomId = msg.roomId;
    }
    if (msg.type === ServerMsgType.GameStarted) {
      this.seed = msg.seed;
      this.resources = msg.resources;
      this.gameStarted = true;
    }
    if (msg.type === ServerMsgType.GameEnded) {
      this.gameEnded = true;
      this.log(`Game ended: ${msg.reason}, winner=${msg.winnerId}`);
    }
    if (msg.type === ServerMsgType.HarvestComplete && 'inventory' in msg) {
      const hc = msg as HarvestCompleteMsg;
      this.harvestedIds.add(hc.resourceId);
      if (hc.playerId === this.id) {
        this.inventory = hc.inventory;
        this.upgrades = hc.upgrades;
      }
    }
    if (msg.type === ServerMsgType.MapRevealed) {
      const mr = msg as MapRevealedMsg;
      this.mapCenter = mr.center;
      this.mapRadius = mr.radius;
      this.log(`MAP REVEALED: area around (${mr.center.x.toFixed(0)}, ${mr.center.z.toFixed(0)}) r=${mr.radius}`);
    }
    if (msg.type === ServerMsgType.UpgradeUnlocked && (msg as any).playerId === this.id) {
      this.log(`Upgrade: ${(msg as any).upgrade} | speed=${this.upgrades.speedMultiplier.toFixed(2)}x dig=${this.upgrades.digMultiplier.toFixed(2)}x map=${this.upgrades.hasMap}`);
    }
    if (msg.type === ServerMsgType.ChestFound) this.log(`CHEST FOUND by ${msg.playerId}!`);
    if (msg.type === ServerMsgType.PayoutComplete) this.log(`Payout: ${msg.amount} -> ${msg.winnerId}`);

    for (let i = this.waiters.length - 1; i >= 0; i--) {
      if (this.waiters[i].filter(msg)) {
        this.waiters[i].resolve(msg);
        this.waiters.splice(i, 1);
        return;
      }
    }
    this.msgQueue.push(msg);
  }

  waitFor(filter: MsgFilter, timeout = 120_000): Promise<ServerMsg> {
    const queued = this.msgQueue.findIndex(filter);
    if (queued >= 0) {
      const msg = this.msgQueue[queued];
      this.msgQueue.splice(queued, 1);
      return Promise.resolve(msg);
    }
    return new Promise((resolve, reject) => {
      const entry = { filter, resolve };
      this.waiters.push(entry);
      setTimeout(() => {
        const idx = this.waiters.indexOf(entry);
        if (idx >= 0) { this.waiters.splice(idx, 1); reject(new Error(`${this.name}: Timeout`)); }
      }, timeout);
    });
  }

  waitType(type: string, timeout = 120_000) { return this.waitFor(m => m.type === type, timeout); }
  waitMyAction(type: string, timeout = 120_000) {
    return this.waitFor(m => m.type === type && 'playerId' in m && (m as any).playerId === this.id, timeout);
  }

  send(msg: ClientMsg) { this.ws.send(JSON.stringify(msg)); }
  join() { this.send({ type: ClientMsgType.JoinRoom, address: this.address }); }
  confirmWager() { this.send({ type: ClientMsgType.WagerConfirmed }); }

  async walkTo(target: Vec3): Promise<void> {
    while (dist2D(this.pos, target) > STEP_DIST * 1.5) {
      if (this.gameEnded) return;
      const dx = target.x - this.pos.x;
      const dz = target.z - this.pos.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      this.pos = {
        x: this.pos.x + (dx / d) * STEP_DIST,
        y: target.y,
        z: this.pos.z + (dz / d) * STEP_DIST,
      };
      this.send({ type: ClientMsgType.PositionUpdate, position: this.pos });
      await sleep(STEP_INTERVAL);
    }
    this.pos = { ...target };
    this.send({ type: ClientMsgType.PositionUpdate, position: this.pos });
  }

  harvest(resourceId: string) { this.send({ type: ClientMsgType.StartHarvest, resourceId }); }
  dig(position: Vec3) { this.send({ type: ClientMsgType.StartDig, position }); }
  available(type?: ResourceType): Resource[] {
    return this.resources.filter(r => !this.harvestedIds.has(r.id) && (!type || r.type === type));
  }
  log(msg: string) { console.log(`[${this.name}] ${msg}`); }
}

function sortByDistance(pos: Vec3, items: Resource[]): Resource[] {
  return [...items].sort((a, b) => dist2D(pos, a.position) - dist2D(pos, b.position));
}

function generateZigzag(seed: number, xMin: number, xMax: number, zMin: number, zMax: number, spacing: number): Vec3[] {
  const points: Vec3[] = [];
  let leftToRight = true;
  for (let x = xMin; x <= xMax; x += spacing) {
    if (leftToRight) {
      for (let z = zMin; z <= zMax; z += spacing) {
        if (isOnIsland(x, z, seed)) points.push({ x, y: 0, z });
      }
    } else {
      for (let z = zMax; z >= zMin; z -= spacing) {
        if (isOnIsland(x, z, seed)) points.push({ x, y: 0, z });
      }
    }
    leftToRight = !leftToRight;
  }
  return points;
}

async function harvestResources(player: TestPlayer, targets: Resource[]): Promise<void> {
  for (const res of targets) {
    if (player.gameEnded) return;
    await player.walkTo(res.position);
    if (player.gameEnded) return;
    player.harvest(res.id);
    const result = await Promise.race([
      player.waitMyAction(ServerMsgType.HarvestComplete, 10_000).then(() => 'ok' as const),
      player.waitFor(m => m.type === ServerMsgType.Error, 10_000).then(() => 'error' as const),
    ]).catch(() => 'timeout' as const);
    if (result !== 'ok') continue;
  }
}

async function searchAndDig(player: TestPlayer, searchPoints: Vec3[]): Promise<boolean> {
  let digCount = 0;
  const total = searchPoints.length;
  for (const spot of searchPoints) {
    if (player.gameEnded) return false;
    await player.walkTo(spot);
    if (player.gameEnded) return false;

    digCount++;
    if (digCount % 50 === 0 || digCount === 1) {
      player.log(`Dig #${digCount}/${total} | inv: W=${player.inventory.wood} S=${player.inventory.stone} B=${player.inventory.berry}`);
    }
    player.dig(spot);

    const result = await Promise.race([
      player.waitFor(m => m.type === ServerMsgType.ChestFound, DIG_DURATION_MS + 10_000).then(() => 'found' as const),
      player.waitMyAction(ServerMsgType.DigComplete, DIG_DURATION_MS + 10_000).then(() => 'miss' as const),
    ]);
    if (result === 'found') {
      player.log(`Found chest on dig #${digCount}!`);
      return true;
    }
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════
// STRATEGY 1: "Scout" -- Collect berries for speed, gather 50
// wood for treasure map, then search the revealed area
// ═══════════════════════════════════════════════════════════════
async function scoutStrategy(player: TestPlayer): Promise<void> {
  // Phase A: Grab berries for speed boost
  const nearBerries = sortByDistance(player.pos, player.available(ResourceType.Berry)).slice(0, 10);
  player.log(`Gathering ${nearBerries.length} berries for speed...`);
  await harvestResources(player, nearBerries);
  if (player.gameEnded) return;
  player.log(`Speed now: ${player.upgrades.speedMultiplier.toFixed(2)}x`);

  // Phase B: Gather wood until we hit 50 for the map
  while (player.inventory.wood < 50 && !player.gameEnded) {
    const batch = sortByDistance(player.pos, player.available(ResourceType.Wood)).slice(0, 15);
    if (batch.length === 0) break;
    player.log(`Gathering wood for map (have ${player.inventory.wood}/50)...`);
    await harvestResources(player, batch);
  }
  if (player.gameEnded) return;

  // Phase C: Use map if unlocked, otherwise brute-force
  const seed = player.seed!;
  let searchPoints: Vec3[];

  if (player.mapCenter) {
    player.log(`Searching map area around (${player.mapCenter.x.toFixed(0)}, ${player.mapCenter.z.toFixed(0)})`);
    searchPoints = generateZigzag(
      seed,
      player.mapCenter.x - player.mapRadius,
      player.mapCenter.x + player.mapRadius,
      player.mapCenter.z - player.mapRadius,
      player.mapCenter.z + player.mapRadius,
      3
    );
  } else {
    player.log(`No map, searching west half`);
    searchPoints = generateZigzag(seed, -140, -1, -140, 140, 3);
  }

  player.log(`${searchPoints.length} dig spots`);
  await searchAndDig(player, searchPoints);
}

// ═══════════════════════════════════════════════════════════════
// STRATEGY 2: "Miner" -- Collect stone + wood equally for dig
// speed upgrades, then brute-force search with fast digging
// ═══════════════════════════════════════════════════════════════
async function minerStrategy(player: TestPlayer): Promise<void> {
  // Phase A: Collect stone and wood in pairs for dig upgrades (target 4 upgrades = 20 each)
  while (player.upgrades.digUpgradesTaken < 4 && !player.gameEnded) {
    const nearStone = sortByDistance(player.pos, player.available(ResourceType.Stone)).slice(0, 5);
    const nearWood = sortByDistance(player.pos, player.available(ResourceType.Wood)).slice(0, 5);
    if (nearStone.length === 0 && nearWood.length === 0) break;
    const batch: Resource[] = [];
    for (let i = 0; i < 5; i++) {
      if (i < nearStone.length) batch.push(nearStone[i]);
      if (i < nearWood.length) batch.push(nearWood[i]);
    }
    player.log(`Gathering for dig upgrades (${player.upgrades.digUpgradesTaken} upgrades so far)...`);
    await harvestResources(player, batch);
  }
  if (player.gameEnded) return;
  player.log(`Dig speed now: ${player.upgrades.digMultiplier.toFixed(2)}x (${player.upgrades.digUpgradesTaken} upgrades)`);

  // Phase B: Grab some berries for speed
  const berries = sortByDistance(player.pos, player.available(ResourceType.Berry)).slice(0, 5);
  await harvestResources(player, berries);
  if (player.gameEnded) return;

  // Phase C: Brute-force search east half of island with fast digging
  player.log(`Searching east half with fast digging`);
  const searchPoints = generateZigzag(player.seed!, 0, 140, -140, 140, 3);
  player.log(`${searchPoints.length} dig spots`);
  await searchAndDig(player, searchPoints);
}

async function run() {
  console.log('=== 2-Player Strategy Test ===');
  console.log('Player1 = Scout (berries + map)');
  console.log('Player2 = Miner (dig speed upgrades)\n');

  const p1 = new TestPlayer('Scout ', '0x1111111111111111111111111111111111111111');
  const p2 = new TestPlayer('Miner ', '0x2222222222222222222222222222222222222222');

  console.log('--- Connect ---');
  await Promise.all([p1.connect(), p2.connect()]);

  console.log('--- Join & Wager ---');
  p1.join();
  await p1.waitType(ServerMsgType.RoomJoined);
  await p1.waitType(ServerMsgType.WagerRequired);
  p2.join();
  await p2.waitType(ServerMsgType.RoomJoined);
  await p2.waitType(ServerMsgType.WagerRequired);

  p1.confirmWager();
  await p1.waitType(ServerMsgType.WagerAccepted);
  p2.confirmWager();
  await p2.waitType(ServerMsgType.WagerAccepted);

  console.log('--- Countdown ---');
  await p1.waitType(ServerMsgType.GameStarting, 15_000);
  await p1.waitType(ServerMsgType.GameStarted, 15_000);
  await p2.waitType(ServerMsgType.GameStarted, 15_000);

  const resources = p1.resources;
  const byType = {
    wood: resources.filter(r => r.type === ResourceType.Wood).length,
    stone: resources.filter(r => r.type === ResourceType.Stone).length,
    berry: resources.filter(r => r.type === ResourceType.Berry).length,
  };
  console.log(`\nIsland: ${resources.length} resources (${byType.wood}W ${byType.stone}S ${byType.berry}B)\n`);

  console.log('--- Strategies begin ---\n');
  const race = Promise.race([
    scoutStrategy(p1),
    minerStrategy(p2),
  ]);

  await race;

  if (!p1.gameEnded) await p1.waitType(ServerMsgType.GameEnded, 15_000);
  await p1.waitType(ServerMsgType.PayoutComplete, 15_000);

  console.log('\n=== Test Complete ===');
  await sleep(1000);
  process.exit(0);
}

run().catch((e) => {
  console.error('Test failed:', e);
  process.exit(1);
});
