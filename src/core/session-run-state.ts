import type { SessionID } from '../types/ids.js';
import { Runner } from './runner.js';

/** `Map<SessionID, Runner>`：保证单会话单飞，`ensureRunning` 是唯一入口。 */
export class SessionRunState {
  private readonly runners = new Map<SessionID, Runner>();

  getRunner(sessionID: SessionID): Runner {
    let runner = this.runners.get(sessionID);
    if (!runner) {
      runner = new Runner();
      this.runners.set(sessionID, runner);
    }
    return runner;
  }

  has(sessionID: SessionID): boolean {
    return this.runners.has(sessionID);
  }
}
