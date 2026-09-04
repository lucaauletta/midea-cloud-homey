import Homey from 'homey';
import type { NetHomePlusCloud } from '../../lib/NetHomePlusCloud';

interface MideaCloudApp extends Homey.App {
  getCloud(account: string, password: string): NetHomePlusCloud;
}

class MideaCloudACDriver extends Homey.Driver {
  async onInit() {
    this.log('Midea Cloud AC driver initialised');
    this.registerFlowCards();
  }

  private app(): MideaCloudApp {
    return this.homey.app as MideaCloudApp;
  }

  // ---------------------------------------------------------------------------
  // Pairing
  // ---------------------------------------------------------------------------

  async onPair(session: Homey.Driver.PairSession) {
    let account = '';
    let password = '';

    session.setHandler('login', async (data: { username: string; password: string }) => {
      account = data.username.trim();
      password = data.password;
      const cloud = this.app().getCloud(account, password);
      await cloud.login(true);
      return true;
    });

    session.setHandler('list_devices', async () => {
      const cloud = this.app().getCloud(account, password);
      const appliances = await cloud.listAppliances(true);
      const acs = appliances.filter((a) => a.type.toUpperCase() === '0XAC');
      this.log(`Found ${appliances.length} appliances, ${acs.length} air conditioners`);
      return acs.map((a) => ({
        name: a.name,
        data: { id: a.id },
        store: {
          account,
          password,
          serialNumber: a.serialNumber,
          modelNumber: a.modelNumber,
        },
        settings: {
          appliance_id: a.id,
          serial_number: a.serialNumber,
          model_number: a.modelNumber,
          account,
        },
      }));
    });
  }

  async onRepair(session: Homey.Driver.PairSession, device: Homey.Device) {
    session.setHandler('login', async (data: { username: string; password: string }) => {
      const account = data.username.trim();
      const cloud = this.app().getCloud(account, data.password);
      await cloud.login(true);
      await device.setStoreValue('account', account);
      await device.setStoreValue('password', data.password);
      await device.setSettings({ account });
      // Re-initialise the device with the new credentials
      await (device as any).reconnect?.();
      return true;
    });
  }

  // ---------------------------------------------------------------------------
  // Flow cards
  // ---------------------------------------------------------------------------

  private registerFlowCards() {
    const enumCapabilities = ['midea_mode', 'midea_fan_speed', 'midea_swing_mode'] as const;
    for (const cap of enumCapabilities) {
      this.homey.flow.getDeviceTriggerCard(`${cap}_changed`)
        .registerRunListener(async (args: any, state: any) => args[cap] === state[cap]);
      this.homey.flow.getConditionCard(`${cap}_is`)
        .registerRunListener(async (args: any) => args.device.getCapabilityValue(cap) === args[cap]);
      this.homey.flow.getActionCard(`${cap}_set`)
        .registerRunListener(async (args: any) => args.device.triggerCapabilityListener(cap, args[cap]));
    }

    const boolCapabilities = ['midea_turbo', 'midea_eco', 'midea_freeze_protection'] as const;
    for (const cap of boolCapabilities) {
      // `${cap}_true` / `${cap}_false` triggers have no arguments, so no run listener is needed
      this.homey.flow.getConditionCard(`${cap}_is_true`)
        .registerRunListener(async (args: any) => args.device.getCapabilityValue(cap) === true);
      this.homey.flow.getActionCard(`${cap}_set_true`)
        .registerRunListener(async (args: any) => args.device.triggerCapabilityListener(cap, true));
      this.homey.flow.getActionCard(`${cap}_set_false`)
        .registerRunListener(async (args: any) => args.device.triggerCapabilityListener(cap, false));
    }
  }
}

module.exports = MideaCloudACDriver;
