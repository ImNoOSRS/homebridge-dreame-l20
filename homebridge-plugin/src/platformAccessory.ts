import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { DreameL20Platform } from './platform.js';
import { Vacuum } from 'node-dreame';

export interface RoomConfig {
  name: string;
  segmentId: number;
  mode?: 'vacuum' | 'mop' | 'vacuum_mop';
  suction?: number;
  water?: number;
}

export class DreameL20Accessory {
  private mainService: Service;
  private roomServices: Map<string, Service> = new Map(); // name -> Service
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

    // === Dynamic Room Services ===
    const rooms: RoomConfig[] = config.rooms || [];
    
    rooms.forEach(room => {
      const serviceName = `${room.name} Cleaning`;
      const service = this.accessory.getService(serviceName)
        || this.accessory.addService(this.platform.api.hap.Service.Switch, serviceName, room.name.toLowerCase());

      service.updateCharacteristic(this.platform.api.hap.Characteristic.On, false);
      service.getCharacteristic(this.platform.api.hap.Characteristic.On)
        .onSet((value: CharacteristicValue) => this.handleRoomCleaning(room, !!value));

      this.roomServices.set(room.name, service);
      this.log.info(`✅ Added room switch: ${room.name} (ID: ${room.segmentId})`);
    });

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

  private async handleRoomCleaning(room: RoomConfig, start: boolean) {
    if (!start) {
      this.log.info(`Room button "${room.name}" turned off → ignoring (segment cleaning is one-shot)`);
      return;
    }

    this.lastCommandTime = Date.now();
    const service = this.roomServices.get(room.name)!;
    service.updateCharacteristic(this.platform.api.hap.Characteristic.On, true);

    try {
      this.log.info(`🧹 Starting cleaning: ${room.name} | Mode: ${room.mode || 'vacuum_mop'}`);

      // Set cleaning parameters
      if (room.suction) {
        await this.vacuum.setSuction(room.suction);
      }
      if (room.water !== undefined && this.vacuum.capabilities?.canMop) {
        await this.vacuum.setWaterVolume(room.water);
      }

      // Clean the segment
      const segmentIds = [room.segmentId];

      if (typeof (this.vacuum as any).cleanSegments === 'function') {
        await (this.vacuum as any).cleanSegments(segmentIds);
      } else if (typeof (this.vacuum as any).cleanSegment === 'function') {
        await (this.vacuum as any).cleanSegment(room.segmentId);
      } else {
        this.log.warn('cleanSegments not found, falling back to start()');
        await this.vacuum.start();
      }

      // Reset switch after short delay
      setTimeout(() => {
        service.updateCharacteristic(this.platform.api.hap.Characteristic.On, false);
      }, 2500);

    } catch (e: any) {
      this.log.error(`Cleaning "${room.name}" failed:`, e.message);
      service.updateCharacteristic(this.platform.api.hap.Characteristic.On, false);
    }
  }
}