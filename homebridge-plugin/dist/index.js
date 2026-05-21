import { DreameL20Platform } from './platform.js';
import { PLATFORM_NAME } from './settings.js';
/**
 * This method registers the platform with Homebridge
 */
export default (api) => {
    api.registerPlatform(PLATFORM_NAME, DreameL20Platform);
};
//# sourceMappingURL=index.js.map