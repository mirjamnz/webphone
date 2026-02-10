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
            domain: '',
            wssUrl: '',
            micId: 'default',
            speakerId: 'default',
            ringerId: 'default'
        };

        if (!stored) return defaults;
        
        try {
            return { ...defaults, ...JSON.parse(stored) };
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