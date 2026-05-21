// src/platform.ts
import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig } from 'homebridge';
import { DreameClient } from 'node-dreame';
import { DreameL20Accessory } from './platformAccessory.js';

export class DreameL20Platform implements DynamicPlatformPlugin {
  public readonly accessories: PlatformAccessory[] = [];
  public readonly api: API;                    // ← Changed to public
  private client!: DreameClient;

  constructor(
    private readonly log: Logger,
    private readonly config: PlatformConfig,
    api: API,                                   // ← Keep parameter name
  ) {
    this.api = api;                             // ← Assign to public property

    this.api.on('didFinishLaunching', () => {
      this.discoverDevices();
    });
  }

  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);
    this.accessories.push(accessory);
  }

async discoverDevices() {
  try {
    this.client = new DreameClient({
      email: this.config.email as string,
      password: this.config.password as string,
      region: (this.config.region as any) || 'eu',
    });

    await this.client.login();
    this.log.info('✅ Logged into Dreame Home');

    const devices = await this.client.getDevices();
    this.log.info(`Found ${devices.length} device(s) in your Dreame account`);

    // === FULL DEVICE LIST LOG (very useful for debugging) ===
    this.log.info('=== ALL DEVICES ===');
    devices.forEach((d: any, index: number) => {
      this.log.info(`Device ${index + 1}:`);
      this.log.info(`  Name: ${d.name || 'N/A'}`);
      this.log.info(`  DID: ${d.did || 'N/A'}`);
      this.log.info(`  Model: ${d.model || d.productId || 'N/A'}`);
      this.log.info(`  Online: ${d.online !== undefined ? d.online : 'N/A'}`);
      //this.log.info(`  Full object: ${JSON.stringify(d, null, 2)}`);
      this.log.info('-------------------');
    });
    this.log.info('=== END OF DEVICE LIST ===');

    // Try to find your L20 Ultra
    const vacuumDevice = devices.find((d: any) =>
      d.name?.toLowerCase().includes('l20') ||
      (this.config.deviceId && d.did === this.config.deviceId)
    );

    if (!vacuumDevice) {
      this.log.error('❌ Could not find your L20 Ultra. Check the device list above and use the exact DID in config.');
      return;
    }

    this.log.info(`✅ Found device: ${vacuumDevice.name} (DID: ${vacuumDevice.did})`);

    const vacuum = this.client.getVacuum(vacuumDevice);

    const uuid = this.api.hap.uuid.generate(vacuumDevice.did);
    let accessory = this.accessories.find(acc => acc.UUID === uuid);

    if (!accessory) {
      accessory = new this.api.platformAccessory(vacuumDevice.name || 'Dreame L20 Ultra', uuid);
      this.api.registerPlatformAccessories('homebridge-dreame-l20', 'DreameL20', [accessory]);
    }

    new DreameL20Accessory(this, accessory, vacuum, this.log);

  } catch (error: any) {
    this.log.error('Discovery failed:', error.message || error);
  }
}
}