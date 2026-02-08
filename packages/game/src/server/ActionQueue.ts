import type { PlayerSession } from './PlayerSession.js';

export class ActionQueue {
  startAction(
    session: PlayerSession,
    type: 'harvesting' | 'digging',
    duration: number,
    onComplete: () => void
  ) {
    this.cancelAction(session);
    session.currentAction = type;
    session.actionTimer = setTimeout(() => {
      session.currentAction = 'idle';
      session.actionTimer = null;
      onComplete();
    }, duration);
  }

  cancelAction(session: PlayerSession) {
    if (session.actionTimer) {
      clearTimeout(session.actionTimer);
      session.actionTimer = null;
    }
    session.currentAction = 'idle';
  }
}
