import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { DreameL20Platform } from './platform.js';
import { Vacuum } from 'node-dreame';

export interface RoomConfig {
  name: string;           // e.g. "Keuken"
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

    // === Main Switch (Full Clean / Dock) ===
    this.mainService = this.accessory.getService('Dreame L20 Ultra')
      || this.accessory.addService(this.platform.api.hap.Service.Switch, 'Dreame L20 Ultra', 'main');

    this.mainService.getCharacteristic(this.platform.api.hap.Characteristic.On)
      .onSet((value: CharacteristicValue) => this.handleMainSwitch(!!value));

    this.mainService.updateCharacteristic(this.platform.api.hap.Characteristic.On, false);

    // === Dynamic Room Services for Siri Voice Commands ===
    const rooms: RoomConfig[] = config.rooms || [];

    rooms.forEach(room => {
      this.createRoomServices(room);
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

  private createRoomServices(room: RoomConfig) {
    const base = room.name;

    // 1. Vacuum + Mop (Best for "clean Keuken")
    this.addRoomService(`${base} Clean`, `${base.toLowerCase()}_full`, room, 'vacuum_mop');

    // 2. Vacuum Only ("zuig Keuken")
    this.addRoomService(`${base} Zuigen`, `${base.toLowerCase()}_vacuum`, room, 'vacuum');

    // 3. Mop Only ("dweil Keuken")
    this.addRoomService(`${base} Dweilen`, `${base.toLowerCase()}_mop`, room, 'mop');

    this.log.info(`✅ Added Siri services for ${base} (Segment ${room.segmentId})`);
  }

  private addRoomService(displayName: string, subtype: string, room: RoomConfig, mode: 'vacuum' | 'mop' | 'vacuum_mop') {
    const service = this.accessory.getServiceById(displayName, subtype)
      || this.accessory.addService(this.platform.api.hap.Service.Switch, displayName, subtype);

    service.getCharacteristic(this.platform.api.hap.Characteristic.On)
      .onSet((value: CharacteristicValue) => this.handleRoomAction(room, mode, !!value));

    service.updateCharacteristic(this.platform.api.hap.Characteristic.On, false);

    this.roomServices.set(subtype, service);
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

    const subtype = `${room.name.toLowerCase()}_${mode === 'vacuum_mop' ? 'full' : mode === 'vacuum' ? 'vacuum' : 'mop'}`;
    const service = this.roomServices.get(subtype)!;

    try {
      this.log.info(`🧹 Starting ${room.name} → ${mode.toUpperCase()}`);

      // Set suction and water levels based on mode
      if (mode === 'vacuum' || mode === 'vacuum_mop') {
        await this.vacuum.setSuction(3);        // Adjust default as you like
      }
      if (mode === 'mop' || mode === 'vacuum_mop') {
        await this.vacuum.setWaterVolume(2);    // Adjust default as you like
      }

      // Execute segment cleaning
      const segmentIds = [room.segmentId];

      if (typeof (this.vacuum as any).cleanSegments === 'function') {
        await (this.vacuum as any).cleanSegments(segmentIds);
      } else if (typeof (this.vacuum as any).cleanSegment === 'function') {
        await (this.vacuum as any).cleanSegment(room.segmentId);
      } else {
        this.log.warn('cleanSegments not available, falling back to start()');
        await this.vacuum.start();
      }

      // Reset switch (since segment cleaning is fire-and-forget)
      setTimeout(() => {
        service.updateCharacteristic(this.platform.api.hap.Characteristic.On, false);
      }, 2500);

    } catch (e: any) {
      this.log.error(`Failed to clean ${room.name}:`, e.message);
      service.updateCharacteristic(this.platform.api.hap.Characteristic.On, false);
    }
  }

  private isCurrentlyCleaning(state: any): boolean {
    return state.miotState === 1 || 
           state.miotStateRaw === 1 || 
           state.taskStatusRaw === 1 || 
           false;
  }
}