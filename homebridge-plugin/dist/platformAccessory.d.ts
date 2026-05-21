import { PlatformAccessory } from 'homebridge';
import { DreameL20Platform } from './platform.js';
import { Vacuum } from 'node-dreame';
export declare class DreameL20Accessory {
    private readonly platform;
    private readonly accessory;
    private readonly vacuum;
    private readonly log;
    private service;
    private lastCommandTime;
    private readonly COMMAND_COOLDOWN_MS;
    constructor(platform: DreameL20Platform, accessory: PlatformAccessory, vacuum: Vacuum, log: any);
    private executeCommand;
}
