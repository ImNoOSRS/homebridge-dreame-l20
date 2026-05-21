import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig } from 'homebridge';
export declare class DreameL20Platform implements DynamicPlatformPlugin {
    private readonly log;
    private readonly config;
    readonly accessories: PlatformAccessory[];
    readonly api: API;
    private client;
    constructor(log: Logger, config: PlatformConfig, api: API);
    configureAccessory(accessory: PlatformAccessory): void;
    discoverDevices(): Promise<void>;
}
