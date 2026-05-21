// src/platformAccessory.ts
import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { DreameL20Platform } from './platform.js';
import { Vacuum } from 'node-dreame';

export class DreameL20Accessory {
  private service: Service;
  private lastCommandTime: number = 0;
  private readonly COMMAND_COOLDOWN_MS = 4000; // 4 seconds ignore live updates after command

  constructor(
    private readonly platform: DreameL20Platform,
    private readonly accessory: PlatformAccessory,
    private readonly vacuum: Vacuum,
    private readonly log: any,
  ) {
    this.service = this.accessory.getService(this.platform.api.hap.Service.Switch)
      || this.accessory.addService(this.platform.api.hap.Service.Switch, 'Dreame L20 Ultra');

    this.service.updateCharacteristic(this.platform.api.hap.Characteristic.On, false);

    // === INSTANT On/Off ===
    this.service.getCharacteristic(this.platform.api.hap.Characteristic.On)
      .onSet((value: CharacteristicValue) => {
        const targetState = !!value;
        const now = Date.now();

        this.lastCommandTime = now;

        // Immediate feedback to HomeKit
        this.service.updateCharacteristic(this.platform.api.hap.Characteristic.On, targetState);

        // Run real command in background
        this.executeCommand(targetState).catch((e: any) => {
          this.log.error('Command failed:', e.message);
          this.service.updateCharacteristic(this.platform.api.hap.Characteristic.On, !!targetState);
        });
      });

    // === LIVE STATUS UPDATES ===
    this.vacuum.watch().then(() => {
      this.log.info('✅ MQTT watch started for L20 Ultra');

      this.vacuum.on('change', (state: any) => {
        this.log.debug('Raw state:', JSON.stringify(state, null, 2));

        const now = Date.now();
        // Ignore device updates for 4 seconds after user command
        if (now - this.lastCommandTime < this.COMMAND_COOLDOWN_MS) {
          this.log.debug('Ignoring MQTT update during command cooldown');
          return;
        }

        let isCleaning = false;
        if (state.miotState !== undefined) {
          isCleaning = (state.miotState === 1);
        } else if (state.miotStateRaw !== undefined) {
          isCleaning = (state.miotStateRaw === 1);
        } else if (state.taskStatusRaw !== undefined) {
          isCleaning = (state.taskStatusRaw === 1);
        }

        this.service.updateCharacteristic(this.platform.api.hap.Characteristic.On, isCleaning);
        this.log.info(`Device reported → Cleaning: ${isCleaning} (miotState: ${state.miotState})`);
      });
    }).catch((e: any) => {
      this.log.error('Failed to start MQTT watch:', e.message);
    });
  }

  private async executeCommand(start: boolean) {
    try {
      if (start) {
        this.log.info('🚀 Starting cleaning...');
        const result = await this.vacuum.start();
        this.log.info(`✅ Start completed: ${result.kind}`);
      } else {
        this.log.info('🏠 Returning to dock...');
        const result = await this.vacuum.dock();
        this.log.info(`✅ Return to dock completed: ${result.kind}`);
      }
    } catch (e: any) {
      this.log.error('Command execution error:', e.message);
    }
  }
}