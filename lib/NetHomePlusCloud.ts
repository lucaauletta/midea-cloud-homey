import crypto from 'node:crypto';

/**
 * Minimal client for the Midea "NetHome Plus" cloud (mapp.appsmb.com).
 *
 * Verified on 2026-09-04:
 *   - /v1/user/login/id/get, /v1/user/login, /v1/appliance/user/list/get  -> working
 *   - /v1/appliance/transparent/send                                      -> endpoint alive
 *   - /v1/iot/secure/getToken                                             -> closed by Midea (errorCode 9999)
 *
 * Protocol reference: nbogojevic/midea-beautiful-air (cloud.py, crypto.py) and
 * mill1000/midea-msmart (cloud.py).
 */

const APP_ID = '1017';
const APP_KEY = '3742e9e5842d4ad59c2db887e12449f9';
const BASE_URL = 'https://mapp.appsmb.com';
const CLIENT_TYPE = 1; // Android
const FORMAT = 2; // JSON
const LANGUAGE = 'en_US';
const REQUEST_TIMEOUT_MS = 15000;

export interface CloudLogger {
  log: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

export type LogLevel = 'error' | 'info' | 'debug';

export interface CloudAppliance {
  id: string;
  name: string;
  /** Appliance type as hex string, e.g. "0xAC" for air conditioners */
  type: string;
  modelNumber: string;
  serialNumber: string;
  online: boolean;
}

export class CloudApiError extends Error {
  constructor(public readonly code: number, message: string, public readonly endpoint: string) {
    super(`${endpoint}: ${message} (${code})`);
    this.name = 'CloudApiError';
  }
}

const sha256hex = (s: string) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const md5hex = (s: string) => crypto.createHash('md5').update(s, 'utf8').digest('hex');

function timestamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Midea encodes binary payloads as comma separated *signed* bytes before encrypting them. */
export function encodeAsCsv(data: Buffer): string {
  const out: string[] = [];
  for (const b of data) out.push(String(b >= 128 ? b - 256 : b));
  return out.join(',');
}

export function decodeFromCsv(data: string): Buffer {
  return Buffer.from(data.split(',').map((v) => {
    const n = parseInt(v, 10);
    return n < 0 ? n + 256 : n;
  }));
}

export class NetHomePlusCloud {
  private readonly deviceId: string;
  private loginId = '';
  private sessionId = '';
  /** 16 byte AES key derived from the accessToken; used for appliance payloads */
  private dataKey: Buffer | null = null;
  private loginPromise: Promise<void> | null = null;
  private applianceCache: CloudAppliance[] = [];
  private level: LogLevel = 'info';

  constructor(
    public readonly account: string,
    public readonly password: string,
    private readonly logger: CloudLogger = console,
  ) {
    // Stable pseudo device id per account, so we don't look like a new phone at every start
    this.deviceId = md5hex(`homey-midea-cloud:${account.toLowerCase()}`).slice(0, 16);
  }

  get isLoggedIn(): boolean {
    return !!this.sessionId && !!this.dataKey;
  }

  /** Raise the log level to 'debug' to trace every cloud request (never credentials). */
  setLogLevel(level: LogLevel) {
    this.level = level;
  }

  private debug(...args: unknown[]) {
    if (this.level === 'debug') this.logger.log(...args);
  }

  private info(...args: unknown[]) {
    if (this.level !== 'error') this.logger.log(...args);
  }

  // ---------------------------------------------------------------------------
  // Low level request helpers
  // ---------------------------------------------------------------------------

  private sign(path: string, body: Record<string, string | number>): string {
    const query = Object.keys(body)
      .sort()
      .map((k) => `${k}=${body[k]}`)
      .join('&');
    return sha256hex(path + query + APP_KEY);
  }

  private buildBody(extra: Record<string, string | number>, withSession: boolean): Record<string, string | number> {
    const body: Record<string, string | number> = {
      appId: APP_ID,
      src: APP_ID,
      format: FORMAT,
      clientType: CLIENT_TYPE,
      language: LANGUAGE,
      deviceId: this.deviceId,
      stamp: timestamp(),
      ...extra,
    };
    if (withSession) body.sessionId = this.sessionId;
    return body;
  }

  private async post(path: string, extra: Record<string, string | number>, withSession = true): Promise<any> {
    const body = this.buildBody(extra, withSession);
    body.sign = this.sign(path, body);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const started = Date.now();
    let text: string;
    this.debug(`-> POST ${path}`);
    try {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(body)) params.append(k, String(v));
      const res = await fetch(BASE_URL + path, {
        method: 'POST',
        body: params,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${path}`);
      text = await res.text();
    } finally {
      clearTimeout(timer);
    }

    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`Invalid JSON from ${path}: ${text.slice(0, 120)}`);
    }
    const code = Number(json.errorCode ?? 0);
    this.debug(`<- ${path} errorCode=${code} (${Date.now() - started} ms)`);
    if (code !== 0) throw new CloudApiError(code, String(json.msg ?? 'unknown error'), path);
    return json.result;
  }

  // ---------------------------------------------------------------------------
  // Authentication
  // ---------------------------------------------------------------------------

  /** Log in (idempotent, concurrent calls share the same request). */
  async login(force = false): Promise<void> {
    if (this.isLoggedIn && !force) return;
    if (this.loginPromise) return this.loginPromise;
    this.loginPromise = this.doLogin().finally(() => { this.loginPromise = null; });
    return this.loginPromise;
  }

  private async doLogin(): Promise<void> {
    this.sessionId = '';
    this.dataKey = null;

    const idRes = await this.post('/v1/user/login/id/get', { loginAccount: this.account }, false);
    this.loginId = String(idRes.loginId);

    const password = sha256hex(this.loginId + sha256hex(this.password) + APP_KEY);
    const loginRes = await this.post('/v1/user/login', { loginAccount: this.account, password }, false);
    if (!loginRes?.sessionId || !loginRes?.accessToken) {
      throw new Error('Login succeeded but no sessionId/accessToken were returned');
    }
    this.sessionId = String(loginRes.sessionId);

    // The accessToken is the AES-ECB encrypted "data key", encrypted with md5(appKey)[0:16]
    const keyKey = Buffer.from(md5hex(APP_KEY).slice(0, 16), 'utf8');
    const decipher = crypto.createDecipheriv('aes-128-ecb', keyKey, null);
    const dataKeyStr = Buffer.concat([
      decipher.update(Buffer.from(String(loginRes.accessToken), 'hex')),
      decipher.final(),
    ]).toString('utf8');
    this.dataKey = Buffer.from(dataKeyStr, 'utf8');
    if (this.dataKey.length !== 16) {
      throw new Error(`Unexpected data key length ${this.dataKey.length}`);
    }
    this.info(`Logged in to NetHome Plus as ${this.account}`);
  }

  /** Run a request with the session; on an expired session re-login once and retry. */
  private async withSession<T>(fn: () => Promise<T>): Promise<T> {
    await this.login();
    try {
      return await fn();
    } catch (err) {
      if (err instanceof CloudApiError && [3106, 3004, 3144, 3176].includes(err.code) && err.endpoint !== '/v1/user/login') {
        // 3106 invalid session, 3144 needs full restart. Re-login once.
        this.info(`Session error ${err.code}, re-authenticating`);
        await this.login(true);
        return fn();
      }
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // AES helpers with the per-session data key
  // ---------------------------------------------------------------------------

  private aesEncryptHex(plain: string): string {
    if (!this.dataKey) throw new Error('Not logged in (no data key)');
    const cipher = crypto.createCipheriv('aes-128-ecb', this.dataKey, null);
    return Buffer.concat([cipher.update(Buffer.from(plain, 'utf8')), cipher.final()]).toString('hex');
  }

  private aesDecryptHex(hex: string): string {
    if (!this.dataKey) throw new Error('Not logged in (no data key)');
    const decipher = crypto.createDecipheriv('aes-128-ecb', this.dataKey, null);
    return Buffer.concat([decipher.update(Buffer.from(hex, 'hex')), decipher.final()]).toString('utf8');
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  async listAppliances(force = false): Promise<CloudAppliance[]> {
    if (!force && this.applianceCache.length) return this.applianceCache;
    const res = await this.withSession(() => this.post('/v1/appliance/user/list/get', {}));
    const list: any[] = res?.list ?? [];
    this.applianceCache = list.map((item) => {
      let sn = '';
      try { sn = item.sn ? this.aesDecryptHex(String(item.sn)) : ''; } catch { sn = ''; }
      return {
        id: String(item.id),
        name: String(item.name ?? item.id),
        type: String(item.type ?? '').toUpperCase().replace('0XAC', '0xAC'),
        modelNumber: String(item.modelNumber ?? ''),
        serialNumber: sn,
        online: String(item.onlineStatus) === '1',
      };
    });
    return this.applianceCache;
  }

  /**
   * Sends a raw Midea packet (5A5A header + AA frame) to an appliance through
   * the cloud, exactly as the mobile app does when not on the local network.
   * Returns the reply with the 40 byte cloud header stripped, i.e. the AA frame.
   */
  async transparentSend(applianceId: string, packet: Buffer): Promise<Buffer> {
    return this.withSession(async () => {
      const order = this.aesEncryptHex(encodeAsCsv(packet));
      const res = await this.post('/v1/appliance/transparent/send', {
        order,
        funId: '0000',
        applianceId,
      });
      if (!res?.reply) throw new Error('Cloud returned no reply');
      const reply = decodeFromCsv(this.aesDecryptHex(String(res.reply)));
      if (reply.length < 50) throw new Error(`Reply too short (${reply.length} bytes)`);
      const frame = reply.subarray(40);
      this.debug(`appliance ${applianceId} sent ${packet.subarray(40).toString('hex')} got ${frame.toString('hex')}`);
      return frame;
    });
  }
}
