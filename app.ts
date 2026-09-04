import Homey from 'homey';
import { NetHomePlusCloud } from './lib/NetHomePlusCloud';

/**
 * Midea Cloud app.
 * Keeps one authenticated NetHome Plus cloud session per account so that
 * several devices paired with the same account share the session.
 */
class MideaCloudApp extends Homey.App {
  private clouds: Map<string, NetHomePlusCloud> = new Map();

  async onInit() {
    this.log('Midea Cloud app initialised');
  }

  /** Get (or create) the shared cloud client for an account. */
  getCloud(account: string, password: string): NetHomePlusCloud {
    const key = account.trim().toLowerCase();
    let cloud = this.clouds.get(key);
    if (!cloud || cloud.password !== password) {
      cloud = new NetHomePlusCloud(account.trim(), password, {
        log: (...args: unknown[]) => this.log('[cloud]', ...args),
        error: (...args: unknown[]) => this.error('[cloud]', ...args),
      });
      this.clouds.set(key, cloud);
    }
    return cloud;
  }
}

module.exports = MideaCloudApp;
