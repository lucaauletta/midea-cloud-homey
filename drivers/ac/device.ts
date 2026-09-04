import Homey from 'homey';
import type { LogLevel, NetHomePlusCloud } from '../../lib/NetHomePlusCloud';
import {
  ACState, FanSpeed, OperationalMode, SwingMode, applyState, queryState,
} from '../../lib/MideaAC';

interface MideaCloudApp extends Homey.App {
  getCloud(account: string, password: string): NetHomePlusCloud;
}

const MODE_TO_CAP: Record<number, string> = {
  [OperationalMode.AUTO]: 'auto',
  [OperationalMode.COOL]: 'cool',
  [OperationalMode.HEAT]: 'heat',
  [OperationalMode.DRY]: 'dry',
  [OperationalMode.FAN]: 'fan',
};
const CAP_TO_MODE: Record<string, OperationalMode> = {
  auto: OperationalMode.AUTO,
  cool: OperationalMode.COOL,
  heat: OperationalMode.HEAT,
  dry: OperationalMode.DRY,
  fan: OperationalMode.FAN,
};
const FAN_TO_CAP: Record<number, string> = {
  [FanSpeed.AUTO]: 'auto',
  [FanSpeed.FIXED]: 'auto',
  [FanSpeed.SILENT]: 'silent',
  [FanSpeed.LOW]: 'low',
  [FanSpeed.MEDIUM]: 'medium',
  [FanSpeed.HIGH]: 'high',
  [FanSpeed.FULL]: 'full',
};
const CAP_TO_FAN: Record<string, FanSpeed> = {
  auto: FanSpeed.AUTO,
  silent: FanSpeed.SILENT,
  low: FanSpeed.LOW,
  medium: FanSpeed.MEDIUM,
  high: FanSpeed.HIGH,
  full: FanSpeed.FULL,
};
const SWING_TO_CAP: Record<number, string> = {
  [SwingMode.OFF]: 'off',
  [SwingMode.VERTICAL]: 'vertical',
  [SwingMode.HORIZONTAL]: 'horizontal',
  [SwingMode.BOTH]: 'both',
};
const CAP_TO_SWING: Record<string, SwingMode> = {
  off: SwingMode.OFF,
  vertical: SwingMode.VERTICAL,
  horizontal: SwingMode.HORIZONTAL,
  both: SwingMode.BOTH,
};

const ENUM_CAPABILITIES = ['midea_mode', 'midea_fan_speed', 'midea_swing_mode'];
const BOOL_CAPABILITIES = ['midea_turbo', 'midea_eco', 'midea_freeze_protection'];

class MideaCloudACDevice extends Homey.Device {
  private cloud!: NetHomePlusCloud;
  private applianceId = '';
  private pollTimer: NodeJS.Timeout | null = null;
  private failures = 0;
  private maxFailures = 5;
  private lastState: ACState | null = null;
  private busy: Promise<unknown> = Promise.resolve();

  async onInit() {
    this.applianceId = String(this.getData().id);
    this.log(`Initialising Midea cloud AC ${this.getName()} (${this.applianceId})`);

    this.registerCapabilityListener('onoff', (v) => this.change((s) => { s.powerOn = !!v; }));
    this.registerCapabilityListener('target_temperature', (v) => this.change((s) => { s.targetTemperature = Number(v); }));
    this.registerCapabilityListener('midea_mode', (v) => this.change((s) => {
      if (v === 'off') { s.powerOn = false; return; }
      s.powerOn = true;
      s.mode = CAP_TO_MODE[String(v)] ?? s.mode;
    }));
    this.registerCapabilityListener('midea_fan_speed', (v) => this.change((s) => {
      if (v === 'auto') s.fanSpeed = s.mode === OperationalMode.AUTO ? FanSpeed.FIXED : FanSpeed.AUTO;
      else s.fanSpeed = CAP_TO_FAN[String(v)] ?? s.fanSpeed;
    }));
    this.registerCapabilityListener('midea_swing_mode', (v) => this.change((s) => { s.swingMode = CAP_TO_SWING[String(v)] ?? s.swingMode; }));
    this.registerCapabilityListener('midea_turbo', (v) => this.change((s) => {
      s.turbo = !!v;
      if (v) { s.eco = false; s.freezeProtection = false; }
    }));
    this.registerCapabilityListener('midea_eco', (v) => this.change((s) => {
      s.eco = !!v;
      // ECO is only available while cooling
      if (v) { s.mode = OperationalMode.COOL; s.turbo = false; s.freezeProtection = false; }
    }));
    this.registerCapabilityListener('midea_freeze_protection', (v) => this.change((s) => {
      s.freezeProtection = !!v;
      if (v) { s.mode = OperationalMode.HEAT; s.turbo = false; s.eco = false; }
    }));

    await this.reconnect();
  }

  /** (Re)create the cloud client from the stored credentials and start polling. */
  async reconnect() {
    this.stopPolling();
    const { account, password } = this.getStore();
    if (!account || !password) {
      await this.setUnavailable(this.homey.__('errors.no_credentials'));
      return;
    }
    this.cloud = (this.homey.app as MideaCloudApp).getCloud(account, password);
    const settings = this.getSettings();
    this.cloud.setLogLevel(settings.debug_level ?? 'info');
    this.maxFailures = Number(settings.max_failures) || 5;
    this.failures = 0;

    try {
      await this.refresh();
      await this.setAvailable();
    } catch (err) {
      this.error('Initial refresh failed:', err);
      await this.setUnavailable(this.describe(err));
    }
    this.startPolling(Number(settings.polling_interval) || 30);
  }

  // ---------------------------------------------------------------------------
  // Polling
  // ---------------------------------------------------------------------------

  private startPolling(seconds: number) {
    this.stopPolling();
    const interval = Math.max(10, seconds) * 1000;
    this.pollTimer = this.homey.setInterval(() => {
      this.enqueue(async () => {
        try {
          await this.refresh();
          if (this.failures > 0) this.log('Polling recovered');
          this.failures = 0;
          if (!this.getAvailable()) await this.setAvailable();
        } catch (err) {
          this.failures++;
          this.error(`Polling failed (${this.failures}/${this.maxFailures}):`, this.describe(err));
          if (this.failures >= this.maxFailures) await this.setUnavailable(this.describe(err));
        }
      }).catch(() => { /* handled above */ });
    }, interval);
  }

  private stopPolling() {
    if (this.pollTimer) {
      this.homey.clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /** Serialise all cloud traffic for this device. */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.busy.then(fn, fn);
    this.busy = run.catch(() => undefined);
    return run;
  }

  private async refresh() {
    const state = await queryState(this.cloud, this.applianceId);
    await this.applyToCapabilities(state);
  }

  // ---------------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------------

  private change(mutate: (state: ACState) => void): Promise<void> {
    return this.enqueue(async () => {
      try {
        const current = this.lastState ?? await queryState(this.cloud, this.applianceId);
        const next: ACState = { ...current };
        mutate(next);
        const confirmed = await applyState(this.cloud, this.applianceId, next);
        await this.applyToCapabilities(confirmed);
        this.failures = 0;
        if (!this.getAvailable()) await this.setAvailable();
      } catch (err) {
        this.error('Command failed:', this.describe(err));
        // Put the UI back in sync with the real state
        this.refresh().catch(() => undefined);
        throw new Error(this.describe(err));
      }
    });
  }

  private async applyToCapabilities(state: ACState) {
    this.lastState = state;
    const set = async (cap: string, value: unknown) => {
      if (!this.hasCapability(cap)) return;
      const previous = this.getCapabilityValue(cap);
      if (previous === value) return;
      await this.setCapabilityValue(cap, value).catch((e: unknown) => this.error(`setCapabilityValue(${cap})`, e));
      // Only fire flow triggers on real changes, not on the first value after start-up
      if (previous !== null && previous !== undefined) await this.fireTrigger(cap, value);
    };
    await set('onoff', state.powerOn);
    await set('midea_mode', state.powerOn ? (MODE_TO_CAP[state.mode] ?? 'auto') : 'off');
    await set('target_temperature', state.targetTemperature);
    if (state.indoorTemperature !== null) await set('measure_temperature', state.indoorTemperature);
    if (state.outdoorTemperature !== null && state.outdoorTemperature > -40 && state.outdoorTemperature < 60) {
      await set('measure_temperature.outdoor', state.outdoorTemperature);
    }
    await set('midea_fan_speed', FAN_TO_CAP[state.fanSpeed] ?? 'auto');
    await set('midea_swing_mode', SWING_TO_CAP[state.swingMode] ?? 'off');
    await set('midea_turbo', state.turbo);
    await set('midea_eco', state.eco);
    await set('midea_freeze_protection', state.freezeProtection);
  }

  /** Fire the flow trigger cards that belong to a capability change. */
  private async fireTrigger(cap: string, value: unknown) {
    let cardId: string | null = null;
    let state: Record<string, unknown> = {};
    if (ENUM_CAPABILITIES.includes(cap)) {
      cardId = `${cap}_changed`;
      state = { [cap]: value };
    } else if (BOOL_CAPABILITIES.includes(cap)) {
      cardId = `${cap}_${value ? 'true' : 'false'}`;
    }
    if (!cardId) return;
    try {
      await this.homey.flow.getDeviceTriggerCard(cardId).trigger(this, {}, state);
    } catch (err) {
      this.error(`Trigger ${cardId} failed:`, this.describe(err));
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async onSettings({ newSettings, changedKeys }: {
    oldSettings: Record<string, unknown>;
    newSettings: Record<string, unknown>;
    changedKeys: string[];
  }): Promise<string | void> {
    if (changedKeys.includes('polling_interval')) this.startPolling(Number(newSettings.polling_interval) || 30);
    if (changedKeys.includes('max_failures')) this.maxFailures = Number(newSettings.max_failures) || 5;
    if (changedKeys.includes('debug_level')) this.cloud?.setLogLevel((newSettings.debug_level as LogLevel) ?? 'info');
  }

  async onDeleted() {
    this.stopPolling();
  }

  async onUninit() {
    this.stopPolling();
  }

  private describe(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}

module.exports = MideaCloudACDevice;
