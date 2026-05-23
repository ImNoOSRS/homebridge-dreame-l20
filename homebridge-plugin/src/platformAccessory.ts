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
       this.log.info('Raw state:', JSON.stringify(state, null, 2));
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

    this.addRoomService(`${base} Clean`,   `${base.toLowerCase()}_full`,   room, 'vacuum_mop');
    this.addRoomService(`${base} Zuigen`,  `${base.toLowerCase()}_vacuum`, room, 'vacuum');
    this.addRoomService(`${base} Dweilen`, `${base.toLowerCase()}_mop`,    room, 'mop');

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
        this.log.info('🚀 Starting full cleaning (Vacuum + Mop)...');
        // Ensure vacuum then mop mode for main clean
        await this.setCleaningParameters('vacuum_mop');
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

      // Set the correct cleaning mode
      await this.setCleaningParameters(mode);

      const segmentIds = [room.segmentId];

      if (typeof (this.vacuum as any).cleanSegments === 'function') {
        await (this.vacuum as any).cleanSegments(segmentIds);
      } 
      else if (typeof (this.vacuum as any).cleanSegment === 'function') {
        this.log.warn('cleanSegments not available, falling back to cleanSegment');
        await (this.vacuum as any).cleanSegment(room.segmentId);
      } 
      else {
        this.log.warn('No segment cleaning method found, falling back to start()');
        await this.vacuum.start();
      }

      // Reset switch (fire-and-forget)
      setTimeout(() => {
        service.updateCharacteristic(this.platform.api.hap.Characteristic.On, false);
      }, 2500);

    } catch (e: any) {
      this.log.error(`Failed to clean ${room.name}:`, e.message);
      service.updateCharacteristic(this.platform.api.hap.Characteristic.On, false);
    }
  }

  /**
   * Sets the cleaning mode for the Dreame L20 (0 = vacuum, 1 = mop, 2 = vacuum then mop)
   */
  private async setCleaningParameters(mode: 'vacuum' | 'mop' | 'vacuum_mop') {
    if (typeof (this.vacuum as any).setCleaningMode !== 'function') {
      this.log.warn('setCleaningMode is not available on this vacuum instance');
      return;
    }

    let cleaningMode: number;

    switch (mode) {
      case 'vacuum':
        cleaningMode = 0;   // Vacuum only
        break;
      case 'mop':
        cleaningMode = 1;   // Mop only
        break;
      //2 = Clean and Mop
      case 'vacuum_mop':
        cleaningMode = 3;   // Vacuum then Mop
        break;
      default:
        cleaningMode = 3;
    }

    await (this.vacuum as any).setCleaningMode(cleaningMode);
    this.log.debug(`Set cleaning mode to ${mode} (${cleaningMode})`);
  }

  private isCurrentlyCleaning(state: any): boolean {
    return state.miotState === 1 || 
           state.miotStateRaw === 1 || 
           state.taskStatusRaw === 1 || 
           false;
  }
}