import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { DreameL20Platform } from './platform.js';
import { Vacuum } from 'node-dreame';

export class DreameL20Accessory {
  private mainService: Service;
  private keukenService: Service;
  private lastCommandTime: number = 0;
  private readonly COMMAND_COOLDOWN_MS = 4000;

  constructor(
    private readonly platform: DreameL20Platform,
    private readonly accessory: PlatformAccessory,
    private readonly vacuum: Vacuum,
    private readonly log: any,
  ) {
    const config = this.platform.config as any;
    const deviceName = config.name || 'Dreame L20 Ultra';

    // === Force correct accessory name ===
    if (this.accessory.displayName !== deviceName) {
      this.accessory.displayName = deviceName;
      this.accessory.updateDisplayName(deviceName);
    }

    // === Main Switch - Full Clean ===
    this.mainService = this.accessory.getService('Main')
      || this.accessory.addService(this.platform.api.hap.Service.Switch, deviceName, 'main');

    this.mainService.setCharacteristic(this.platform.api.hap.Characteristic.Name, deviceName);
    this.mainService.updateCharacteristic(this.platform.api.hap.Characteristic.On, false);

    this.mainService.getCharacteristic(this.platform.api.hap.Characteristic.On)
      .onSet((value: CharacteristicValue) => this.handleMainSwitch(!!value));

    // === Keuken Cleaning Switch ===
    const keukenName = `${deviceName} - Keuken`;

    this.keukenService = this.accessory.getService('Keuken')
      || this.accessory.addService(this.platform.api.hap.Service.Switch, keukenName, 'keuken');

    this.keukenService.setCharacteristic(this.platform.api.hap.Characteristic.Name, keukenName);
    this.keukenService.updateCharacteristic(this.platform.api.hap.Characteristic.On, false);

    this.keukenService.getCharacteristic(this.platform.api.hap.Characteristic.On)
      .onSet((value: CharacteristicValue) => this.handleKeukenCleaning(!!value));

    // === Start MQTT Live Updates ===
    this.startMqttWatch();
  }

  private async startMqttWatch() {
    try {
      await this.vacuum.watch();
      this.log.info('✅ MQTT watch started for L20 Ultra');

      this.vacuum.on('change', (state: any) => {
        const now = Date.now();
        if (now - this.lastCommandTime < this.COMMAND_COOLDOWN_MS) {
          this.log.debug('Ignoring MQTT update during command cooldown');
          return;
        }

        const isCleaning = this.isCurrentlyCleaning(state);
        this.mainService.updateCharacteristic(this.platform.api.hap.Characteristic.On, isCleaning);

        this.log.debug(`Status update → Cleaning: ${isCleaning}`);
      });
    } catch (e: any) {
      this.log.error('Failed to start MQTT watch:', e.message);
    }
  }

  private isCurrentlyCleaning(state: any): boolean {
    if (state.miotState !== undefined) return state.miotState === 1;
    if (state.miotStateRaw !== undefined) return state.miotStateRaw === 1;
    if (state.taskStatusRaw !== undefined) return state.taskStatusRaw === 1;
    return false;
  }

  private async handleMainSwitch(start: boolean) {
    this.lastCommandTime = Date.now();
    this.mainService.updateCharacteristic(this.platform.api.hap.Characteristic.On, start);

    try {
      if (start) {
        this.log.info('🚀 Starting full cleaning...');
        await this.vacuum.start();
      } else {
        this.log.info('🏠 Returning to dock...');
        await this.vacuum.dock();
      }
    } catch (e: any) {
      this.log.error('Main command failed:', e.message);
    }
  }

  private async handleKeukenCleaning(start: boolean) {
    const config = this.platform.config as any;
    const segmentId = config.keukenSegmentId || 1;

    this.lastCommandTime = Date.now();
    this.keukenService.updateCharacteristic(this.platform.api.hap.Characteristic.On, start);

    if (!start) {
      this.log.info('Keuken button turned off → no action needed');
      return;
    }

    try {
      this.log.info(`🧹 Starting Keuken cleaning (Segment ${segmentId})...`);

      const vacuumAny = this.vacuum as any;

      if (typeof vacuumAny.cleanSegments === 'function') {
        await vacuumAny.cleanSegments([segmentId]);
      } else if (typeof vacuumAny.cleanSegment === 'function') {
        await vacuumAny.cleanSegment(segmentId);
      } else {
        this.log.warn('cleanSegment(s) not available, falling back to start()');
        await this.vacuum.start();
      }

      // Auto turn off the switch after triggering (segment cleaning is one-shot)
      setTimeout(() => {
        this.keukenService.updateCharacteristic(this.platform.api.hap.Characteristic.On, false);
      }, 2500);

    } catch (e: any) {
      this.log.error('Keuken cleaning failed:', e.message);
      this.keukenService.updateCharacteristic(this.platform.api.hap.Characteristic.On, false);
    }
  }
}