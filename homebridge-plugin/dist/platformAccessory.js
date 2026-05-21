export class DreameL20Accessory {
    platform;
    accessory;
    vacuum;
    log;
    service;
    lastCommandTime = 0;
    COMMAND_COOLDOWN_MS = 4000; // 4 seconds ignore live updates after command
    constructor(platform, accessory, vacuum, log) {
        this.platform = platform;
        this.accessory = accessory;
        this.vacuum = vacuum;
        this.log = log;
        this.service = this.accessory.getService(this.platform.api.hap.Service.Switch)
            || this.accessory.addService(this.platform.api.hap.Service.Switch, 'Dreame L20 Ultra');
        this.service.updateCharacteristic(this.platform.api.hap.Characteristic.On, false);
        // === INSTANT On/Off ===
        this.service.getCharacteristic(this.platform.api.hap.Characteristic.On)
            .onSet((value) => {
            const targetState = !!value;
            const now = Date.now();
            this.lastCommandTime = now;
            // Immediate feedback to HomeKit
            this.service.updateCharacteristic(this.platform.api.hap.Characteristic.On, targetState);
            // Run real command in background
            this.executeCommand(targetState).catch((e) => {
                this.log.error('Command failed:', e.message);
                this.service.updateCharacteristic(this.platform.api.hap.Characteristic.On, !!targetState);
            });
        });
        // === LIVE STATUS UPDATES ===
        this.vacuum.watch().then(() => {
            this.log.info('✅ MQTT watch started for L20 Ultra');
            this.vacuum.on('change', (state) => {
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
                }
                else if (state.miotStateRaw !== undefined) {
                    isCleaning = (state.miotStateRaw === 1);
                }
                else if (state.taskStatusRaw !== undefined) {
                    isCleaning = (state.taskStatusRaw === 1);
                }
                this.service.updateCharacteristic(this.platform.api.hap.Characteristic.On, isCleaning);
                this.log.info(`Device reported → Cleaning: ${isCleaning} (miotState: ${state.miotState})`);
            });
        }).catch((e) => {
            this.log.error('Failed to start MQTT watch:', e.message);
        });
    }
    async executeCommand(start) {
        try {
            if (start) {
                this.log.info('🚀 Starting cleaning...');
                const result = await this.vacuum.start();
                this.log.info(`✅ Start completed: ${result.kind}`);
            }
            else {
                this.log.info('🏠 Returning to dock...');
                const result = await this.vacuum.dock();
                this.log.info(`✅ Return to dock completed: ${result.kind}`);
            }
        }
        catch (e) {
            this.log.error('Command execution error:', e.message);
        }
    }
}
//# sourceMappingURL=platformAccessory.js.map