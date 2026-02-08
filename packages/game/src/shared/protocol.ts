import type { Vec3, PlayerState, Resource, RoomPhase, Inventory, PlayerUpgrades } from './types.js';

export enum ClientMsgType {
  JoinRoom = 'JoinRoom',
  LeaveRoom = 'LeaveRoom',
  WagerConfirmed = 'WagerConfirmed',
  Ready = 'Ready',
  PositionUpdate = 'PositionUpdate',
  StartHarvest = 'StartHarvest',
  StartDig = 'StartDig',
  CancelHarvest = 'CancelHarvest',
  CancelDig = 'CancelDig',
  Ping = 'Ping',
}

export enum ServerMsgType {
  RoomJoined = 'RoomJoined',
  WagerRequired = 'WagerRequired',
  WagerAccepted = 'WagerAccepted',
  GameStarting = 'GameStarting',
  GameStarted = 'GameStarted',
  PlayerMoved = 'PlayerMoved',
  PlayersSync = 'PlayersSync',
  HarvestStarted = 'HarvestStarted',
  HarvestComplete = 'HarvestComplete',
  DigStarted = 'DigStarted',
  DigComplete = 'DigComplete',
  ChestFound = 'ChestFound',
  GameEnded = 'GameEnded',
  PayoutComplete = 'PayoutComplete',
  PlayerLeft = 'PlayerLeft',
  UpgradeUnlocked = 'UpgradeUnlocked',
  MapRevealed = 'MapRevealed',
  Error = 'Error',
  Pong = 'Pong',
}

export interface JoinRoomMsg { type: ClientMsgType.JoinRoom; address: string }
export interface LeaveRoomMsg { type: ClientMsgType.LeaveRoom }
export interface WagerConfirmedMsg { type: ClientMsgType.WagerConfirmed }
export interface ReadyMsg { type: ClientMsgType.Ready }
export interface PositionUpdateMsg { type: ClientMsgType.PositionUpdate; position: Vec3 }
export interface StartHarvestMsg { type: ClientMsgType.StartHarvest; resourceId: string }
export interface StartDigMsg { type: ClientMsgType.StartDig; position: Vec3 }
export interface CancelHarvestMsg { type: ClientMsgType.CancelHarvest }
export interface CancelDigMsg { type: ClientMsgType.CancelDig }
export interface PingMsg { type: ClientMsgType.Ping; t: number }

export type ClientMsg =
  | JoinRoomMsg
  | LeaveRoomMsg
  | WagerConfirmedMsg
  | ReadyMsg
  | PositionUpdateMsg
  | StartHarvestMsg
  | StartDigMsg
  | CancelHarvestMsg
  | CancelDigMsg
  | PingMsg;

export interface RoomJoinedMsg { type: ServerMsgType.RoomJoined; roomId: string; playerId: string; phase: RoomPhase; players: PlayerState[] }
export interface WagerRequiredMsg { type: ServerMsgType.WagerRequired; amount: number; serverAddress: string; asset: string }
export interface WagerAcceptedMsg { type: ServerMsgType.WagerAccepted; playerId: string }
export interface GameStartingMsg { type: ServerMsgType.GameStarting; countdown: number }
export interface GameStartedMsg { type: ServerMsgType.GameStarted; seed: number; resources: Resource[] }
export interface PlayerMovedMsg { type: ServerMsgType.PlayerMoved; playerId: string; position: Vec3 }
export interface PlayersSyncMsg { type: ServerMsgType.PlayersSync; players: PlayerState[] }
export interface HarvestStartedMsg { type: ServerMsgType.HarvestStarted; playerId: string; resourceId: string }
export interface HarvestCompleteMsg { type: ServerMsgType.HarvestComplete; playerId: string; resourceId: string; resourceType: string; inventory: Inventory; upgrades: PlayerUpgrades }
export interface DigStartedMsg { type: ServerMsgType.DigStarted; playerId: string; position: Vec3 }
export interface DigCompleteMsg { type: ServerMsgType.DigComplete; playerId: string; found: boolean }
export interface ChestFoundMsg { type: ServerMsgType.ChestFound; playerId: string; position: Vec3 }
export interface GameEndedMsg { type: ServerMsgType.GameEnded; winnerId: string | null; reason: 'chest_found' | 'timeout' | 'abandoned' }
export interface PayoutCompleteMsg { type: ServerMsgType.PayoutComplete; winnerId: string | null; amount: number }
export interface PlayerLeftMsg { type: ServerMsgType.PlayerLeft; playerId: string }
export interface UpgradeUnlockedMsg { type: ServerMsgType.UpgradeUnlocked; playerId: string; upgrade: 'speed' | 'dig_speed' | 'map' }
export interface MapRevealedMsg { type: ServerMsgType.MapRevealed; center: Vec3; radius: number }
export interface ErrorMsg { type: ServerMsgType.Error; message: string }
export interface PongMsg { type: ServerMsgType.Pong; t: number }

export type ServerMsg =
  | RoomJoinedMsg
  | WagerRequiredMsg
  | WagerAcceptedMsg
  | GameStartingMsg
  | GameStartedMsg
  | PlayerMovedMsg
  | PlayersSyncMsg
  | HarvestStartedMsg
  | HarvestCompleteMsg
  | DigStartedMsg
  | DigCompleteMsg
  | ChestFoundMsg
  | GameEndedMsg
  | PayoutCompleteMsg
  | PlayerLeftMsg
  | UpgradeUnlockedMsg
  | MapRevealedMsg
  | ErrorMsg
  | PongMsg;
