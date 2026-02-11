import * as SIP from 'https://cdn.jsdelivr.net/npm/sip.js@0.21.2/+esm';

export class BlfManager {
    constructor(phoneEngine, settings) {
        this.phone = phoneEngine;
        this.settings = settings;
        this.subscriptions = new Map();
        
        // Configuration: List of extensions to monitor
        // In a real app, this would come from a database or settings
        this.monitoredExtensions = ['3001', '3002', '3003', '3004']; 
    }

    init() {
        if (!this.phone.userAgent) return;
        
        console.log("Initializing BLF Subscriptions...");
        this.renderPlaceholderUI();

        this.monitoredExtensions.forEach(ext => {
            this.subscribeTo(ext);
        });
    }

    renderPlaceholderUI() {
        const container = document.getElementById('blfGrid');
        if (!container) return;
        container.innerHTML = '';

        this.monitoredExtensions.forEach(ext => {
            const btn = document.createElement('div');
            btn.className = 'blf-chip state-unknown';
            btn.id = `blf-${ext}`;
            btn.innerHTML = `
                <div class="blf-status"></div>
                <div class="blf-info">
                    <span class="blf-ext">${ext}</span>
                    <span class="blf-label">Offline</span>
                </div>
                <button class="blf-call-btn" title="Call"><i class="fa-solid fa-phone"></i></button>
            `;
            
            // Click to Call
            btn.querySelector('.blf-call-btn').onclick = (e) => {
                e.stopPropagation();
                window.app.callSpecial(ext);
            };

            container.appendChild(btn);
        });
    }

    subscribeTo(extension) {
        if (this.subscriptions.has(extension)) return;

        const domain = this.settings.get('domain');
        const target = SIP.UserAgent.makeURI(`sip:${extension}@${domain}`);
        if (!target) return;

        const subscriber = new SIP.Subscriber(this.phone.userAgent, target, 'dialog', {
            expires: 3600,
            extraHeaders: [
                `Accept: application/dialog-info+xml`,
                `Supported: dialog-info+xml`
            ]
        });

        subscriber.delegate = {
            onNotify: (notification) => {
                const body = notification.request.body;
                if (body) {
                    this.parseNotify(extension, body);
                }
                notification.accept();
            }
        };

        subscriber.subscribe();
        this.subscriptions.set(extension, subscriber);
    }

    parseNotify(extension, xmlBody) {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlBody, "text/xml");
        
        // RFC 4235: Look for <state> inside <dialog>
        // state can be: 'trying', 'proceeding', 'early', 'confirmed', 'terminated'
        
        const stateNode = xmlDoc.getElementsByTagName("state")[0];
        let state = 'terminated'; // Default to Idle
        
        if (stateNode) {
            state = stateNode.textContent;
        }

        // Check specifically for "early" (Ringing) or "confirmed" (Talking)
        let uiState = 'available';
        let label = 'Available';

        if (state === 'early') {
            uiState = 'ringing';
            label = 'Ringing';
        } else if (state === 'confirmed') {
            uiState = 'talking';
            label = 'Busy';
        } else if (state === 'terminated') {
            uiState = 'available';
            label = 'Available';
        }

        // Note: SIP dialog-info doesn't easily detect explicit "DND" (Do Not Disturb) 
        // unless the server sends a specific note. 
        // Usually DND just looks like "Terminated" (Idle) or "Confirmed" (Busy) depending on PBX.
        
        this.updateUI(extension, uiState, label);
    }

    updateUI(ext, state, label) {
        const el = document.getElementById(`blf-${ext}`);
        if (!el) return;

        // Reset classes
        el.className = 'blf-chip';
        el.classList.add(`state-${state}`);
        
        el.querySelector('.blf-label').innerText = label;
    }
}