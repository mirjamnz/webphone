import * as SIP from 'https://cdn.jsdelivr.net/npm/sip.js@0.21.2/+esm';

export class BlfManager {
    constructor(phoneEngine, settings) {
        this.phone = phoneEngine;
        this.settings = settings;
        this.subscriptions = new Map();
        this.monitoredExtensions = [];
    }

    init() {
        if (!this.phone.userAgent) return;
        
        // 1. Load extensions from settings
        const storedList = this.settings.get('blfList');
        if (storedList) {
            // Split string "3001, 3002" into array ['3001', '3002']
            this.monitoredExtensions = storedList.split(',')
                .map(s => s.trim())
                .filter(s => s.length > 0); // Remove empty entries
        } else {
            // Default Fallback if nothing configured
            this.monitoredExtensions = ['3001', '3002', '3003', '3004'];
        }

        console.log("Initializing BLF for:", this.monitoredExtensions);
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
            btn.className = 'blf-chip state-offline'; // Default to Gray
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
        // Clear existing if re-subscribing
        if (this.subscriptions.has(extension)) {
            const oldSub = this.subscriptions.get(extension);
            oldSub.unsubscribe();
            this.subscriptions.delete(extension);
        }

        const domain = this.settings.get('domain');
        const target = SIP.UserAgent.makeURI(`sip:${extension}@${domain}`);
        if (!target) return;

        const subscriber = new SIP.Subscriber(this.phone.userAgent, target, 'presence', {
            expires: 3600,
            extraHeaders: [
                `Accept: application/pidf+xml`,
                `Supported: pidf+xml`
            ]
        });

        subscriber.delegate = {
            onNotify: (notification) => {
                const body = notification.request.body;
                if (body) {
                    this.parsePidf(extension, body);
                }
                notification.accept();
            }
        };

        subscriber.subscribe();
        this.subscriptions.set(extension, subscriber);
    }

    // Parser for PIDF+XML (RFC 3863)
    parsePidf(extension, xmlBody) {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlBody, "text/xml");
        
        const basicNode = xmlDoc.getElementsByTagName("basic")[0];
        if (!basicNode) return;

        const basicStatus = basicNode.textContent;
        let uiState = 'offline';
        let label = 'Offline';

        if (basicStatus === 'open') {
            uiState = 'available';
            label = 'Available';

            const noteNode = xmlDoc.getElementsByTagName("note")[0];
            if (noteNode) {
                const note = noteNode.textContent.toLowerCase();
                if (note.includes('ringing')) {
                    uiState = 'ringing';
                    label = 'Ringing';
                } else if (note.includes('phone') || note.includes('busy') || note.includes('in use')) {
                    uiState = 'talking';
                    label = 'Busy';
                }
            }
        } 

        this.updateUI(extension, uiState, label);
    }

    updateUI(ext, state, label) {
        const el = document.getElementById(`blf-${ext}`);
        if (!el) return;

        el.classList.remove('state-offline', 'state-available', 'state-ringing', 'state-talking', 'state-unknown');
        el.classList.add(`state-${state}`);
        el.querySelector('.blf-label').innerText = label;
    }
}