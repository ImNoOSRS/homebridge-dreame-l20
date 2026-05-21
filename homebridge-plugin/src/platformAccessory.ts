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
    this.service = this.accessory.getService(this.platform.api.hap.Service.Fanv2) 
      || this.accessory.addService(this.platform.api.hap.Service.Fanv2, 'Dreame L20 Ultra');

    // Power / Start ↔ Pause
    this.service.getCharacteristic(this.platform.api.hap.Characteristic.On)
      .onSet(async (value: CharacteristicValue) => {
        try {
          if (value) {
            const result = await this.vacuum.start();
            this.log.info(`Start command: ${result.kind}`);
          } else {
            const result = await this.vacuum.pause();   // or .dock() / .stop()
            this.log.info(`Pause command: ${result.kind}`);
          }
        } catch (e: any) {
          this.log.error('Command failed:', e.message);
        }
      });

    // Suction level (0-100% in HomeKit → Dreame 0-3 or 0-5)
    this.service.getCharacteristic(this.platform.api.hap.Characteristic.RotationSpeed)
      .onSet(async (value: CharacteristicValue) => {
        const level = Math.round(((value as number) / 100) * 3); // adjust multiplier if needed
        const result = await this.vacuum.setSuction(level);
        this.log.info(`Suction set to ${level}: ${result.kind}`);
      });

    // === LIVE STATUS UPDATES ===
    this.vacuum.watch().then(() => {
      this.log.info('✅ MQTT watch started for live updates');

      this.vacuum.on('change', (state: any) => {
        this.log.debug('State update received:', state);

        // Most reliable ways to detect "cleaning" in node-dreame:
        const isCleaning = 
          state.taskStatus === 1 ||                    // common running value
          state.status === 'cleaning' || 
          state.miotState?.taskStatus === 1 ||
          (state.status && typeof state.status === 'string' && 
           ['cleaning', 'running', 'working'].includes(state.status.toLowerCase()));

        this.service.updateCharacteristic(
          this.platform.api.hap.Characteristic.On, 
          isCleaning
        );

        // Optional: Add more later (battery, error, etc.)
      });
    }).catch((e: any) => {
      this.log.error('Failed to start MQTT watch:', e.message);
    });
  }
}