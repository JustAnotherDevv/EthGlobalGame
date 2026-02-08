import { createContext, useContext, useState, useRef, useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { useAccount } from 'wagmi';
import { useYellow } from './YellowContext';
import type {
  Vec3, PlayerState, Resource, Inventory, PlayerUpgrades,
  ServerMsg, ClientMsg,
} from '@/types/game';
import {
  RoomPhase, ClientMsgType, ServerMsgType,
} from '@/types/game';
import { pushDigSpot, resetDigSpots } from '@/lib/digSpotsStore';

const WS_URL = 'ws://localhost:3002';
const POSITION_INTERVAL = 50;
const PING_INTERVAL = 10000;

export type GamePhase = RoomPhase | 'disconnected' | 'connecting' | 'wager_pending';

interface GameContextType {
  phase: GamePhase;
  playerId: string | null;
  roomId: string | null;
  seed: number | null;
  players: PlayerState[];
  resources: Resource[];
  inventory: Inventory;
  upgrades: PlayerUpgrades;
  countdown: number;
  mapHint: { center: Vec3; radius: number } | null;
  digSpots: Vec3[];
  winner: string | null;
  winReason: string | null;
  payoutAmount: number | null;
  error: string | null;
  joinGame: () => void;
  sendPosition: (x: number, y: number, z: number) => void;
  startHarvest: (resourceId: string) => void;
  startDig: (x: number, y: number, z: number) => void;
  leaveGame: () => void;
}

const defaultInventory: Inventory = { wood: 0, stone: 0, berry: 0 };
const defaultUpgrades: PlayerUpgrades = { speedMultiplier: 1, digMultiplier: 1, hasMap: false, digUpgradesTaken: 0 };

const GameContext = createContext<GameContextType>({
  phase: 'disconnected',
  playerId: null,
  roomId: null,
  seed: null,
  players: [],
  resources: [],
  inventory: defaultInventory,
  upgrades: defaultUpgrades,
  countdown: 0,
  mapHint: null,
  digSpots: [],
  winner: null,
  winReason: null,
  payoutAmount: null,
  error: null,
  joinGame: () => {},
  sendPosition: () => {},
  startHarvest: () => {},
  startDig: () => {},
  leaveGame: () => {},
});

export const useGame = () => useContext(GameContext);

export const GameProvider = ({ children }: { children: ReactNode }) => {
  const { address } = useAccount();
  const yellow = useYellow();

  const wsRef = useRef<WebSocket | null>(null);
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPositionSend = useRef(0);
  const playerIdRef = useRef<string | null>(null);
  const yellowRef = useRef(yellow);
  yellowRef.current = yellow;

  const [phase, setPhase] = useState<GamePhase>('disconnected');
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [seed, setSeed] = useState<number | null>(null);
  const [players, setPlayers] = useState<PlayerState[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [inventory, setInventory] = useState<Inventory>(defaultInventory);
  const [upgrades, setUpgrades] = useState<PlayerUpgrades>(defaultUpgrades);
  const [countdown, setCountdown] = useState(0);
  const [mapHint, setMapHint] = useState<{ center: Vec3; radius: number } | null>(null);
  const [digSpots, setDigSpots] = useState<Vec3[]>([]);
  const [winner, setWinner] = useState<string | null>(null);
  const [winReason, setWinReason] = useState<string | null>(null);
  const [payoutAmount, setPayoutAmount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const send = useCallback((msg: ClientMsg) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const handleMessage = useCallback((msg: ServerMsg) => {
    switch (msg.type) {
      case ServerMsgType.RoomJoined:
        setRoomId(msg.roomId);
        setPlayerId(msg.playerId);
        playerIdRef.current = msg.playerId;
        setPlayers(msg.players);
        setPhase(msg.phase as RoomPhase);
        break;

      case ServerMsgType.WagerRequired:
        setPhase('wager_pending');
        yellowRef.current.transferTo(msg.serverAddress, msg.amount)
          .then(() => send({ type: ClientMsgType.WagerConfirmed }))
          .catch((e: Error) => setError(`Wager failed: ${e.message}`));
        break;

      case ServerMsgType.WagerAccepted:
        setPhase(RoomPhase.Lobby);
        break;

      case ServerMsgType.GameStarting:
        setCountdown(msg.countdown);
        break;

      case ServerMsgType.GameStarted:
        setSeed(msg.seed);
        setResources(msg.resources);
        setPhase(RoomPhase.Playing);
        setInventory(defaultInventory);
        setUpgrades(defaultUpgrades);
        setCountdown(0);
        break;

      case ServerMsgType.PlayerMoved:
        setPlayers(prev =>
          prev.map(p => p.id === msg.playerId ? { ...p, position: msg.position } : p)
        );
        break;

      case ServerMsgType.PlayersSync:
        setPlayers(msg.players);
        break;

      case ServerMsgType.HarvestStarted:
        setPlayers(prev =>
          prev.map(p => p.id === msg.playerId ? { ...p, currentAction: 'harvesting' as const } : p)
        );
        break;

      case ServerMsgType.HarvestComplete:
        setResources(prev =>
          prev.map(r => r.id === msg.resourceId ? { ...r, harvested: true } : r)
        );
        if (msg.playerId === playerIdRef.current) {
          setInventory(msg.inventory);
          setUpgrades(msg.upgrades);
        }
        setPlayers(prev =>
          prev.map(p => p.id === msg.playerId ? { ...p, currentAction: 'idle' as const } : p)
        );
        break;

      case ServerMsgType.DigStarted:
        setPlayers(prev =>
          prev.map(p => p.id === msg.playerId ? { ...p, currentAction: 'digging' as const } : p)
        );
        setDigSpots(prev => [...prev, msg.position]);
        pushDigSpot(msg.position.x, msg.position.z);
        break;

      case ServerMsgType.DigComplete:
        setPlayers(prev =>
          prev.map(p => p.id === msg.playerId ? { ...p, currentAction: 'idle' as const } : p)
        );
        break;

      case ServerMsgType.ChestFound:
        break;

      case ServerMsgType.GameEnded:
        setWinner(msg.winnerId);
        setWinReason(msg.reason);
        setPhase(RoomPhase.Ended);
        break;

      case ServerMsgType.PayoutComplete:
        setPayoutAmount(msg.amount);
        break;

      case ServerMsgType.PlayerLeft:
        setPlayers(prev => prev.filter(p => p.id !== msg.playerId));
        break;

      case ServerMsgType.UpgradeUnlocked:
        if (msg.playerId === playerIdRef.current) {
          setUpgrades(prev => {
            switch (msg.upgrade) {
              case 'speed': return { ...prev, speedMultiplier: prev.speedMultiplier + 0.2 };
              case 'dig_speed': return { ...prev, digMultiplier: prev.digMultiplier + 0.2, digUpgradesTaken: prev.digUpgradesTaken + 1 };
              case 'map': return { ...prev, hasMap: true };
              default: return prev;
            }
          });
        }
        break;

      case ServerMsgType.MapRevealed:
        setMapHint({ center: msg.center, radius: msg.radius });
        break;

      case ServerMsgType.Error:
        setError(msg.message);
        break;

      case ServerMsgType.Pong:
        break;
    }
  }, [send]);

  const cleanup = useCallback(() => {
    if (pingRef.current) clearInterval(pingRef.current);
    wsRef.current?.close();
    wsRef.current = null;
    pingRef.current = null;
  }, []);

  const joinGame = useCallback(() => {
    if (!address || wsRef.current) return;

    setPhase('connecting');
    setError(null);
    setWinner(null);
    setWinReason(null);
    setPayoutAmount(null);

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      send({ type: ClientMsgType.JoinRoom, address });
      pingRef.current = setInterval(() => {
        send({ type: ClientMsgType.Ping, t: Date.now() });
      }, PING_INTERVAL);
    };

    ws.onmessage = (event) => {
      try {
        const msg: ServerMsg = JSON.parse(event.data);
        handleMessage(msg);
      } catch {}
    };

    ws.onclose = () => {
      cleanup();
      setPhase('disconnected');
    };

    ws.onerror = () => {
      cleanup();
      setPhase('disconnected');
      setError('Connection to game server failed');
    };
  }, [address, send, handleMessage, cleanup]);

  const sendPosition = useCallback((x: number, y: number, z: number) => {
    const now = Date.now();
    if (now - lastPositionSend.current < POSITION_INTERVAL) return;
    lastPositionSend.current = now;
    send({ type: ClientMsgType.PositionUpdate, position: { x, y, z } });
  }, [send]);

  const startHarvest = useCallback((resourceId: string) => {
    send({ type: ClientMsgType.StartHarvest, resourceId });
  }, [send]);

  const startDig = useCallback((x: number, y: number, z: number) => {
    send({ type: ClientMsgType.StartDig, position: { x, y, z } });
  }, [send]);

  const leaveGame = useCallback(() => {
    send({ type: ClientMsgType.LeaveRoom });
    cleanup();
    setPhase('disconnected');
    setPlayerId(null);
    playerIdRef.current = null;
    setRoomId(null);
    setSeed(null);
    setPlayers([]);
    setResources([]);
    setInventory(defaultInventory);
    setUpgrades(defaultUpgrades);
    setCountdown(0);
    setMapHint(null);
    setDigSpots([]);
    resetDigSpots();
    setWinner(null);
    setWinReason(null);
    setPayoutAmount(null);
  }, [send, cleanup]);

  useEffect(() => {
    return () => cleanup();
  }, [cleanup]);

  const value = useMemo(() => ({
    phase, playerId, roomId, seed,
    players, resources, inventory, upgrades,
    countdown, mapHint, digSpots, winner, winReason, payoutAmount, error,
    joinGame, sendPosition, startHarvest, startDig, leaveGame,
  }), [
    phase, playerId, roomId, seed,
    players, resources, inventory, upgrades,
    countdown, mapHint, digSpots, winner, winReason, payoutAmount, error,
    joinGame, sendPosition, startHarvest, startDig, leaveGame,
  ]);

  return (
    <GameContext.Provider value={value}>
      {children}
    </GameContext.Provider>
  );
};
