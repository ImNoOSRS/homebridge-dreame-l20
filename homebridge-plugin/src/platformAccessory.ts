import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { DreameL20Platform } from './platform.js';
import { Vacuum } from 'node-dreame';

export class DreameL20Accessory {
  private mainService: Service;
  private keukenService: Service;        // New: Keuken button
  private lastCommandTime: number = 0;
  private readonly COMMAND_COOLDOWN_MS = 4000;

  constructor(
    private readonly platform: DreameL20Platform,
    private readonly accessory: PlatformAccessory,
    private readonly vacuum: Vacuum,
    private readonly log: any,
  ) {
    const config = this.platform.config as any;

    // === Main Power / Full Clean Switch ===
    this.mainService = this.accessory.getService(this.platform.api.hap.Service.Switch)
      || this.accessory.addService(this.platform.api.hap.Service.Switch, 'Dreame L20 Ultra', 'main');

    this.mainService.updateCharacteristic(this.platform.api.hap.Characteristic.On, false);

    this.mainService.getCharacteristic(this.platform.api.hap.Characteristic.On)
      .onSet((value: CharacteristicValue) => this.handleMainSwitch(!!value));

    // === Keuken Cleaning Button (new) ===
    this.keukenService = this.accessory.getService('Keuken Cleaning')
      || this.accessory.addService(this.platform.api.hap.Service.Switch, 'Keuken Cleaning', 'keuken');

    this.keukenService.updateCharacteristic(this.platform.api.hap.Characteristic.On, false);

    this.keukenService.getCharacteristic(this.platform.api.hap.Characteristic.On)
      .onSet((value: CharacteristicValue) => this.handleKeukenCleaning(!!value));

    // === MQTT Live Updates ===
    this.vacuum.watch().then(() => {
      this.log.info('✅ MQTT watch started for L20 Ultra');

      this.vacuum.on('change', (state: any) => {
        const now = Date.now();
        if (now - this.lastCommandTime < this.COMMAND_COOLDOWN_MS) return;

        const isCleaning = this.isCurrentlyCleaning(state);
        this.mainService.updateCharacteristic(this.platform.api.hap.Characteristic.On, isCleaning);
      });
    }).catch((e: any) => {
      this.log.error('Failed to start MQTT watch:', e.message);
    });
  }

  private isCurrentlyCleaning(state: any): boolean {
    return state.miotState === 1 || state.miotStateRaw === 1 || state.taskStatusRaw === 1 || false;
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
      this.log.info('Keuken button turned off → ignoring (segment cleaning has no stop)');
      return;
    }

    try {
      this.log.info(`🧹 Starting Keuken cleaning (Segment ${segmentId})...`);
      
      // node-dreame typically supports cleanSegments([id])
      if (typeof (this.vacuum as any).cleanSegments === 'function') {
        await (this.vacuum as any).cleanSegments([segmentId]);
      } else if (typeof (this.vacuum as any).cleanSegment === 'function') {
        await (this.vacuum as any).cleanSegment(segmentId);
      } else {
        this.log.warn('cleanSegments / cleanSegment not found in node-dreame. Falling back to start()');
        await this.vacuum.start();
      }

      // Turn switch back off after a short delay (since segment cleaning is a one-shot action)
      setTimeout(() => {
        this.keukenService.updateCharacteristic(this.platform.api.hap.Characteristic.On, false);
      }, 2000);

    } catch (e: any) {
      this.log.error('Keuken cleaning failed:', e.message);
      this.keukenService.updateCharacteristic(this.platform.api.hap.Characteristic.On, false);
    }
  }
}