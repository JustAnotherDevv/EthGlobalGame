import { WebSocketServer } from 'ws';
import type { ClientMsg } from '../shared/protocol.js';
import { PlayerSession } from './PlayerSession.js';
import { GameRoom } from './GameRoom.js';
import type { YellowService } from './YellowService.js';
import type { WagerManager } from './WagerManager.js';
import { config } from '../config.js';

export class GameServer {
  private wss!: WebSocketServer;
  private rooms = new Map<string, GameRoom>();
  private sessions = new Map<string, PlayerSession>();

  constructor(
    private yellowService: YellowService,
    private wagerManager: WagerManager,
  ) {}

  start() {
    this.wss = new WebSocketServer({ port: config.port });
    console.log(`[GameServer] Listening on port ${config.port}`);

    this.wss.on('connection', (ws) => {
      const session = new PlayerSession(ws);
      this.sessions.set(session.id, session);

      ws.on('message', (raw) => {
        let msg: ClientMsg;
        try { msg = JSON.parse(raw.toString()); }
        catch { return; }
        this.handleMessage(session, msg);
      });

      ws.on('close', () => {
        if (session.roomId) {
          const room = this.rooms.get(session.roomId);
          room?.removePlayer(session);
        }
        this.sessions.delete(session.id);
      });
    });
  }

  private handleMessage(session: PlayerSession, msg: ClientMsg) {
    if (msg.type === 'JoinRoom') {
      session.address = msg.address;
      const room = this.findOrCreateRoom();
      room.addPlayer(session);
      return;
    }

    if (!session.roomId) return;
    const room = this.rooms.get(session.roomId);
    if (!room) return;

    room.handleMessage(session, msg);
  }

  private findOrCreateRoom(): GameRoom {
    for (const room of this.rooms.values()) {
      if (!room.isFull && room.phase === 'lobby') {
        return room;
      }
    }

    const room = new GameRoom(this.wagerManager, this.yellowService.address);
    room.onEmpty = () => this.rooms.delete(room.id);
    this.rooms.set(room.id, room);
    console.log(`[GameServer] Created room ${room.id}`);
    return room;
  }

  stop() {
    this.wss?.close();
  }
}
