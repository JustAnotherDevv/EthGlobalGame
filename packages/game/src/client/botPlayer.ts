import 'dotenv/config';
import WebSocket from 'ws';
import { ClientMsgType, ServerMsgType } from '../shared/protocol.js';
import type { ServerMsg, ClientMsg } from '../shared/protocol.js';
import type { Resource, Vec3 } from '../shared/types.js';
import { isOnIsland } from '../shared/island.js';

const SERVER_URL = process.env.GAME_SERVER_URL || 'ws://localhost:3002';
const BOT_ADDRESS = '0xB07B07B07B07B07B07B07B07B07B07B07B07B07B0';
const MOVE_SPEED = 4;
const HARVEST_RANGE = 3;
const TICK_MS = 50;

const ws = new WebSocket(SERVER_URL);
let botId: string | null = null;
let seed = 0;
let resources: Resource[] = [];
let pos: Vec3 = { x: 0, y: 0.5, z: 0 };
let target: Vec3 | null = null;
let busy = false;
let moveInterval: ReturnType<typeof setInterval> | null = null;
let actionInterval: ReturnType<typeof setInterval> | null = null;

function send(msg: ClientMsg) {
  ws.send(JSON.stringify(msg));
}

function dist2D(a: Vec3, b: Vec3) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.z - b.z) ** 2);
}

function pickRandomIslandPoint(): Vec3 {
  const maxR = 200 / 2.5;
  for (let i = 0; i < 100; i++) {
    const angle = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * maxR;
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;
    if (isOnIsland(x, z, seed)) {
      return { x, y: 0.5, z };
    }
  }
  return { x: 0, y: 0.5, z: 0 };
}

function findNearestResource(): Resource | null {
  let nearest: Resource | null = null;
  let minDist = Infinity;
  for (const r of resources) {
    if (r.harvested) continue;
    const d = dist2D(pos, r.position);
    if (d < minDist) {
      minDist = d;
      nearest = r;
    }
  }
  return nearest;
}

function startBotLoop() {
  // Movement tick
  moveInterval = setInterval(() => {
    if (!target || busy) {
      send({ type: ClientMsgType.PositionUpdate, position: pos });
      return;
    }

    const d = dist2D(pos, target);
    if (d < 0.5) {
      target = null;
      return;
    }

    const step = Math.min(MOVE_SPEED * (TICK_MS / 1000), d);
    const dx = (target.x - pos.x) / d;
    const dz = (target.z - pos.z) / d;
    pos.x += dx * step;
    pos.z += dz * step;

    send({ type: ClientMsgType.PositionUpdate, position: pos });
  }, TICK_MS);

  // Decision tick
  actionInterval = setInterval(() => {
    if (busy) return;

    // Try to harvest a nearby resource
    const nearest = findNearestResource();
    if (nearest && dist2D(pos, nearest.position) < HARVEST_RANGE) {
      console.log(`[Bot] Harvesting ${nearest.type} (${nearest.id})`);
      send({ type: ClientMsgType.StartHarvest, resourceId: nearest.id });
      busy = true;
      return;
    }

    // If we have a target, keep going
    if (target) return;

    // 40% chance: go to a resource, 60% chance: dig at random spot
    if (nearest && Math.random() < 0.4) {
      target = { ...nearest.position };
      console.log(`[Bot] Moving to resource at (${target.x.toFixed(1)}, ${target.z.toFixed(1)})`);
    } else {
      const digSpot = pickRandomIslandPoint();
      target = digSpot;
      console.log(`[Bot] Moving to dig at (${target.x.toFixed(1)}, ${target.z.toFixed(1)})`);

      // When we arrive, dig
      const checkArrival = setInterval(() => {
        if (dist2D(pos, digSpot) < 1) {
          clearInterval(checkArrival);
          if (!busy) {
            console.log(`[Bot] Digging at (${pos.x.toFixed(1)}, ${pos.z.toFixed(1)})`);
            send({ type: ClientMsgType.StartDig, position: pos });
            busy = true;
          }
        }
      }, 200);
    }
  }, 2000);
}

function cleanup() {
  if (moveInterval) clearInterval(moveInterval);
  if (actionInterval) clearInterval(actionInterval);
}

ws.on('open', () => {
  console.log('[Bot] Connected, joining...');
  send({ type: ClientMsgType.JoinRoom, address: BOT_ADDRESS });
});

ws.on('message', (raw) => {
  let msg: ServerMsg;
  try { msg = JSON.parse(raw.toString()); } catch { return; }

  switch (msg.type) {
    case ServerMsgType.RoomJoined:
      botId = msg.playerId;
      console.log(`[Bot] Joined room ${msg.roomId} as ${msg.playerId}`);
      break;

    case ServerMsgType.WagerRequired:
      console.log(`[Bot] Wager required: ${msg.amount}, confirming...`);
      send({ type: ClientMsgType.WagerConfirmed });
      break;

    case ServerMsgType.WagerAccepted:
      console.log('[Bot] Wager accepted');
      break;

    case ServerMsgType.GameStarting:
      console.log(`[Bot] Game starting in ${msg.countdown}ms`);
      break;

    case ServerMsgType.GameStarted:
      seed = msg.seed;
      resources = msg.resources;
      console.log(`[Bot] Game started! Seed: ${seed}, ${resources.length} resources`);
      startBotLoop();
      break;

    case ServerMsgType.HarvestComplete:
      if (msg.playerId === botId) {
        busy = false;
        // Mark resource as harvested locally
        const r = resources.find(res => res.id === msg.resourceId);
        if (r) r.harvested = true;
        console.log(`[Bot] Harvested ${msg.resourceType} | inventory: wood=${msg.inventory.wood} stone=${msg.inventory.stone} berry=${msg.inventory.berry}`);
      }
      break;

    case ServerMsgType.DigComplete:
      if (msg.playerId === botId) {
        busy = false;
        console.log(`[Bot] Dig complete, found: ${msg.found}`);
      }
      break;

    case ServerMsgType.ChestFound:
      console.log(`[Bot] Chest found by ${msg.playerId}!`);
      break;

    case ServerMsgType.GameEnded:
      console.log(`[Bot] Game ended: ${msg.reason}, winner: ${msg.winnerId}`);
      cleanup();
      break;

    case ServerMsgType.PayoutComplete:
      console.log(`[Bot] Payout: ${msg.amount}`);
      setTimeout(() => process.exit(0), 2000);
      break;

    case ServerMsgType.Error:
      busy = false;
      break;

    default:
      break;
  }
});

ws.on('close', () => {
  console.log('[Bot] Disconnected');
  cleanup();
  process.exit(0);
});

setInterval(() => {
  if (ws.readyState === WebSocket.OPEN) {
    send({ type: ClientMsgType.Ping, t: Date.now() });
  }
}, 10000);
