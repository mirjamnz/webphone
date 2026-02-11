import * as SIP from 'https://cdn.jsdelivr.net/npm/sip.js@0.21.2/+esm';

export class BlfManager {
    constructor(phoneEngine, settings) {
        this.phone = phoneEngine;
        this.settings = settings;
        this.subscriptions = new Map();
        
        // Extensions to monitor
        this.monitoredExtensions = ['3001', '3002', '3003', '3004']; 
    }

    init() {
        if (!this.phone.userAgent) return;
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
        if (this.subscriptions.has(extension)) return;

        const domain = this.settings.get('domain');
        const target = SIP.UserAgent.makeURI(`sip:${extension}@${domain}`);
        if (!target) return;

        // FIXED: Use 'presence' (PIDF) instead of 'dialog' to detect Offline status
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

    // FIXED: Parser for PIDF+XML (RFC 3863)
    parsePidf(extension, xmlBody) {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlBody, "text/xml");
        
        // 1. Check <basic> status (open = Online, closed = Offline)
        const basicNode = xmlDoc.getElementsByTagName("basic")[0];
        if (!basicNode) return;

        const basicStatus = basicNode.textContent;
        let uiState = 'offline';
        let label = 'Offline';

        if (basicStatus === 'open') {
            uiState = 'available';
            label = 'Available';

            // 2. Check <note> or <show> for Busy/Ringing details
            // Asterisk sends notes like "Ready", "On the phone", "Ringing"
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
        // If 'closed', we leave it as 'offline' (Gray)

        this.updateUI(extension, uiState, label);
    }

    updateUI(ext, state, label) {
        const el = document.getElementById(`blf-${ext}`);
        if (!el) return;

        // Clear all state classes
        el.classList.remove('state-offline', 'state-available', 'state-ringing', 'state-talking', 'state-unknown');
        
        // Add new state
        el.classList.add(`state-${state}`);
        el.querySelector('.blf-label').innerText = label;
    }
}