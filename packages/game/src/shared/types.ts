export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export enum ResourceType {
  Wood = 'wood',
  Stone = 'stone',
  Berry = 'berry',
}

export interface Resource {
  id: string;
  type: ResourceType;
  position: Vec3;
  harvested: boolean;
}

export interface Inventory {
  wood: number;
  stone: number;
  berry: number;
}

export interface PlayerUpgrades {
  speedMultiplier: number;
  digMultiplier: number;
  hasMap: boolean;
  digUpgradesTaken: number;
}

export interface PlayerState {
  id: string;
  address: string;
  position: Vec3;
  score: number;
  currentAction: 'idle' | 'harvesting' | 'digging';
  connected: boolean;
  inventory: Inventory;
  upgrades: PlayerUpgrades;
}

export enum RoomPhase {
  Lobby = 'lobby',
  Playing = 'playing',
  Ended = 'ended',
}

export interface RoomState {
  id: string;
  phase: RoomPhase;
  seed: number;
  players: Map<string, PlayerState>;
  resources: Resource[];
  chestPosition: Vec3;
  createdAt: number;
}

export interface WagerRecord {
  playerId: string;
  address: string;
  amount: number;
  timestamp: number;
}
