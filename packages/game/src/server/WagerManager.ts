import type { WagerRecord } from '../shared/types.js';
import type { YellowService } from './YellowService.js';

export class WagerManager {
  private wagers = new Map<string, WagerRecord[]>();

  constructor(private yellowService: YellowService) {}

  recordWager(roomId: string, playerId: string, address: string, amount: number) {
    if (!this.wagers.has(roomId)) {
      this.wagers.set(roomId, []);
    }
    this.wagers.get(roomId)!.push({
      playerId,
      address,
      amount,
      timestamp: Date.now(),
    });
  }

  isPlayerWagered(roomId: string, playerId: string): boolean {
    const records = this.wagers.get(roomId) ?? [];
    return records.some(w => w.playerId === playerId);
  }

  allPlayersWagered(roomId: string, playerIds: string[]): boolean {
    return playerIds.every(id => this.isPlayerWagered(roomId, id));
  }

  getPot(roomId: string): number {
    const records = this.wagers.get(roomId) ?? [];
    return records.reduce((sum, w) => sum + w.amount, 0);
  }

  async payoutWinner(roomId: string, winnerAddress: string): Promise<void> {
    const pot = this.getPot(roomId);
    if (pot > 0) {
      await this.yellowService.transferTo(winnerAddress, pot);
    }
    this.wagers.delete(roomId);
  }

  async refundAll(roomId: string): Promise<void> {
    const records = this.wagers.get(roomId) ?? [];
    for (const w of records) {
      try {
        await this.yellowService.transferTo(w.address, w.amount);
      } catch (e) {
        console.error(`[Wager] Refund failed for ${w.playerId}:`, e);
      }
    }
    this.wagers.delete(roomId);
  }

  cleanup(roomId: string) {
    this.wagers.delete(roomId);
  }
}
