import { CONFIG } from './config.js';

export class SettingsManager {
    constructor() {
        this.STORAGE_KEY = 'cc_phone_config_v1';
        this.settings = this.load();
    }

    // Load from LocalStorage or return defaults
    load() {
        const stored = localStorage.getItem(this.STORAGE_KEY);
        const defaults = {
            username: '',
            password: '',
            domain: CONFIG.DEFAULT_DOMAIN,
            wssUrl: CONFIG.DEFAULT_WSS,
            micId: 'default',
            speakerId: 'default',
            ringerId: 'default',
            ringtoneFile: 'ringing.mp3'
        };

        if (!stored) return defaults;
        
        try {
            const loaded = { ...defaults, ...JSON.parse(stored) };
            
            // Migration: Update old server values to new Hero Internet server
            const oldDomain = 'bdl-pbx.itnetworld.co.nz';
            const oldWss = 'wss://bdl-pbx.itnetworld.co.nz:8089/ws';
            
            if (loaded.domain === oldDomain || loaded.wssUrl === oldWss || 
                loaded.wssUrl?.includes('bdl-pbx.itnetworld.co.nz')) {
                console.log('Migrating from old server to Hero Internet...');
                loaded.domain = CONFIG.DEFAULT_DOMAIN;
                loaded.wssUrl = CONFIG.DEFAULT_WSS;
                // Save the migrated values
                localStorage.setItem(this.STORAGE_KEY, JSON.stringify(loaded));
            }
            
            return loaded;
        } catch (e) {
            console.error("Settings parse error", e);
            return defaults;
        }
    }

    // Save current state to LocalStorage
    save(newSettings) {
        this.settings = { ...this.settings, ...newSettings };
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.settings));
        console.log("Settings saved:", this.settings);
    }

    get(key) {
        return this.settings[key];
    }
}