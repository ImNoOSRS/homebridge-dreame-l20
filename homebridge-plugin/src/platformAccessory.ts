import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { DreameL20Platform } from './platform.js';
import { Vacuum } from 'node-dreame';

export interface RoomConfig {
  name: string;
  segmentId: number;
}

export class DreameL20Accessory {
  private mainService: Service;
  private roomServices: Map<string, Service> = new Map(); // subtype -> Service
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

    // Force correct accessory name
    if (this.accessory.displayName !== deviceName) {
      this.accessory.displayName = deviceName;
      this.accessory.updateDisplayName(deviceName);
    }

    // === Main Switch (Full Clean / Dock) ===
    this.mainService = this.accessory.getService('Dreame L20 Ultra')
      || this.accessory.addService(this.platform.api.hap.Service.Switch, deviceName, 'main');

    this.mainService.setCharacteristic(this.platform.api.hap.Characteristic.Name, deviceName);
    this.mainService.updateCharacteristic(this.platform.api.hap.Characteristic.On, false);

    this.mainService.getCharacteristic(this.platform.api.hap.Characteristic.On)
      .onSet((value: CharacteristicValue) => this.handleMainSwitch(!!value));

    // === Dynamic Room Services ===
    const rooms: RoomConfig[] = config.rooms || [];
    const enableZuigen = config.enableZuigen !== false;   // default true
    const enableDweilen = config.enableDweilen !== false; // default true

    rooms.forEach(room => {
      this.createRoomServices(room, enableZuigen, enableDweilen);
    });

    // === MQTT Live Updates ===
    this.startMqttWatch();
  }

  private createRoomServices(room: RoomConfig, enableZuigen: boolean, enableDweilen: boolean) {
    const base = room.name;

    // Always add full Vacuum + Mop
    this.addRoomService(`${base} Clean`, `${base.toLowerCase()}_full`, room, 'vacuum_mop');

    // Conditional services
    if (enableZuigen) {
      this.addRoomService(`${base} Zuigen`, `${base.toLowerCase()}_vacuum`, room, 'vacuum');
    }
    if (enableDweilen) {
      this.addRoomService(`${base} Dweilen`, `${base.toLowerCase()}_mop`, room, 'mop');
    }

    this.log.info(`✅ Added services for ${base} (Zuigen: ${enableZuigen}, Dweilen: ${enableDweilen})`);
  }

  private addRoomService(displayName: string, subtype: string, room: RoomConfig, mode: 'vacuum' | 'mop' | 'vacuum_mop') {
    const service = this.accessory.getServiceById(displayName, subtype)
      || this.accessory.addService(this.platform.api.hap.Service.Switch, displayName, subtype);

    service.setCharacteristic(this.platform.api.hap.Characteristic.Name, displayName);
    service.updateCharacteristic(this.platform.api.hap.Characteristic.On, false);

    service.getCharacteristic(this.platform.api.hap.Characteristic.On)
      .onSet((value: CharacteristicValue) => this.handleRoomAction(room, mode, !!value));

    this.roomServices.set(subtype, service);
  }

  private async startMqttWatch() {
    try {
      await this.vacuum.watch();
      this.log.info('✅ MQTT watch started for L20 Ultra');

      this.vacuum.on('change', (state: any) => {
        const now = Date.now();
        if (now - this.lastCommandTime < this.COMMAND_COOLDOWN_MS) return;

        const isCleaning = this.isCurrentlyCleaning(state);
        this.mainService.updateCharacteristic(this.platform.api.hap.Characteristic.On, isCleaning);
      });
    } catch (e: any) {
      this.log.error('Failed to start MQTT watch:', e.message);
    }
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

  private async handleRoomAction(
    room: RoomConfig,
    mode: 'vacuum' | 'mop' | 'vacuum_mop',
    start: boolean
  ) {
    if (!start) return;

    this.lastCommandTime = Date.now();
    const subtype = `${room.name.toLowerCase()}_${mode === 'vacuum_mop' ? 'full' : mode}`;
    const service = this.roomServices.get(subtype)!;

    try {
      this.log.info(`🧹 Starting ${room.name} → ${mode.toUpperCase()}`);

      const vacuumAny = this.vacuum as any;
      const segmentIds = [room.segmentId];

      if (typeof vacuumAny.cleanSegments === 'function') {
        const opts = this.getCleanOptions(mode);
        await vacuumAny.cleanSegments(segmentIds, opts);
      } else if (typeof vacuumAny.cleanSegment === 'function') {
        await vacuumAny.cleanSegment(room.segmentId);
      } else {
        await this.vacuum.start();
      }

      // Auto-reset switch
      setTimeout(() => {
        service.updateCharacteristic(this.platform.api.hap.Characteristic.On, false);
      }, 2500);

    } catch (e: any) {
      this.log.error(`Failed to clean ${room.name}:`, e.message);
      service.updateCharacteristic(this.platform.api.hap.Characteristic.On, false);
    }
  }

  private getCleanOptions(mode: 'vacuum' | 'mop' | 'vacuum_mop') {
    switch (mode) {
      case 'vacuum':
        return { fan: 2, water: 0 };
      case 'mop':
        return { fan: 0, water: 2 };
      case 'vacuum_mop':
        return { fan: 2, water: 2 };
      default:
        return { fan: 2, water: 2 };
    }
  }

  private isCurrentlyCleaning(state: any): boolean {
    return state.miotState === 1 ||
           state.miotStateRaw === 1 ||
           state.taskStatusRaw === 1 ||
           false;
  }
}