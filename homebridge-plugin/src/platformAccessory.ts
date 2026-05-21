// src/platformAccessory.ts
import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { DreameL20Platform } from './platform.js';
import { Vacuum } from 'node-dreame';

export class DreameL20Accessory {
  private service: Service;

  constructor(
    private readonly platform: DreameL20Platform,
    private readonly accessory: PlatformAccessory,
    private readonly vacuum: Vacuum,
    private readonly log: any,
  ) {
    this.service = this.accessory.getService(this.platform.api.hap.Service.Switch)
      || this.accessory.addService(this.platform.api.hap.Service.Switch, 'Dreame L20 Ultra');

    // Initial state
    this.service.updateCharacteristic(this.platform.api.hap.Characteristic.On, false);

    // === Power On/Off ===
    this.service.getCharacteristic(this.platform.api.hap.Characteristic.On)
      .onSet(async (value: CharacteristicValue) => {
        try {
          if (value) {
            const result = await this.vacuum.start();
            this.log.info(`✅ Start command sent: ${result.kind}`);
          } else {
            const result = await this.vacuum.dock();
            this.log.info(`✅ Stop (dock) command sent: ${result.kind}`);
          }
        } catch (e: any) {
          this.log.error('Command failed:', e.message);
        }
      });

    // === LIVE STATUS UPDATES ===
    this.vacuum.watch().then(() => {
      this.log.info('✅ MQTT watch started for L20 Ultra');

      this.vacuum.on('change', (state: any) => {
        this.log.debug('Raw state:', JSON.stringify(state, null, 2));

        // === STRICT LOGIC FOR YOUR L20 ULTRA ===
        let isCleaning = false;

        if (state.miotState !== undefined) {
          isCleaning = (state.miotState === 1);           // 1 = Cleaning, 3 = Stopped
        }

        this.service.updateCharacteristic(
          this.platform.api.hap.Characteristic.On,
          isCleaning
        );

        this.log.info(`Vacuum status → Cleaning: ${isCleaning} (miotState: ${state.miotState}, taskStatusRaw: ${state.taskStatusRaw})`);
      });
    }).catch((e: any) => {
      this.log.error('Failed to start MQTT watch:', e.message);
    });
  }
}