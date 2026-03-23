/**
 * dashboard-agent-presence.js
 * SIP SUBSCRIBE (presence) for supervisor Agents tab — BLF-style online/busy indicators.
 *
 * Use case: Show green “online” / busy / ringing per agent login (full SIP user), matching main BLF.
 * Last modified: 2026-03-25
 */
import * as SIP from 'https://cdn.jsdelivr.net/npm/sip.js@0.21.2/+esm';

function parsePidfPresence(xmlBody) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlBody, 'text/xml');
    const basicNode = xmlDoc.getElementsByTagName('basic')[0];
    if (!basicNode) return { state: 'offline', label: 'Offline' };

    const basicStatus = basicNode.textContent;
    let uiState = 'offline';
    let label = 'Offline';

    if (basicStatus === 'open') {
        uiState = 'available';
        label = 'Available';
        const noteNode = xmlDoc.getElementsByTagName('note')[0];
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

    return { state: uiState, label };
}

export class DashboardAgentPresence {
    constructor(phoneEngine, settings) {
        this.phone = phoneEngine;
        this.settings = settings;
        this.subscriptions = new Map();
        this.stateByLogin = new Map();
        this._boundUa = null;
    }

    /**
     * @param {Array<[string, object]>} agents - directory entries with type === 'agent'
     */
    syncSubscriptions(agents) {
        const ua = this.phone?.userAgent || null;
        if (ua !== this._boundUa) {
            this.unsubscribeAll();
            this._boundUa = ua;
        }

        const wanted = new Set();
        for (const [, d] of agents) {
            if (!d || d.type !== 'agent') continue;
            const login = String(d.extension != null ? d.extension : '').trim();
            if (login) wanted.add(login);
        }

        for (const login of [...this.subscriptions.keys()]) {
            if (!wanted.has(login)) this._unsubscribeOne(login);
        }

        if (!ua) {
            this.stateByLogin.clear();
            return;
        }

        for (const login of wanted) {
            if (!this.subscriptions.has(login)) {
                this._subscribe(login, ua);
            }
        }
    }

    /** Re-apply cached states after DOM list refresh (poll re-render). */
    paintAllRows() {
        for (const [login, { state, label }] of this.stateByLogin) {
            this._paintRow(login, state, label);
        }
        this._paintDisconnectedRows();
    }

    _paintDisconnectedRows() {
        const container = document.getElementById('agentsList');
        if (!container) return;
        container.querySelectorAll('.supervisor-agent-item[data-sip-login]').forEach((row) => {
            const login = row.getAttribute('data-sip-login');
            if (!login || this.stateByLogin.has(login)) return;
            if (!this.phone?.userAgent) {
                this._paintRow(login, 'unknown', 'No line');
            } else {
                this._paintRow(login, 'unknown', '…');
            }
        });
    }

    _subscribe(login, userAgent) {
        const domain = this.settings.get('domain') || 'wss.hero.co.nz';
        const target = SIP.UserAgent.makeURI(`sip:${login}@${domain}`);
        if (!target) return;

        const subscriber = new SIP.Subscriber(userAgent, target, 'presence', {
            expires: 3600,
            extraHeaders: [`Accept: application/pidf+xml`, `Supported: pidf+xml`]
        });

        subscriber.delegate = {
            onNotify: (notification) => {
                const body = notification.request.body;
                if (body) {
                    const { state, label } = parsePidfPresence(body);
                    this.stateByLogin.set(login, { state, label });
                    this._paintRow(login, state, label);
                }
                notification.accept();
            }
        };

        try {
            subscriber.subscribe();
            this.subscriptions.set(login, subscriber);
        } catch (e) {
            console.warn('Dashboard presence subscribe failed', login, e);
        }
    }

    _unsubscribeOne(login) {
        const sub = this.subscriptions.get(login);
        if (sub) {
            try {
                sub.unsubscribe();
            } catch (_) {}
            this.subscriptions.delete(login);
        }
        this.stateByLogin.delete(login);
    }

    unsubscribeAll() {
        for (const login of [...this.subscriptions.keys()]) {
            this._unsubscribeOne(login);
        }
        this.stateByLogin.clear();
    }

    _paintRow(login, state, label) {
        const container = document.getElementById('agentsList');
        if (!container) return;
        const row = container.querySelector(`.supervisor-agent-item[data-sip-login="${CSS.escape(login)}"]`);
        if (!row) return;

        const block = row.querySelector('.dashboard-agent-status');
        const dot = row.querySelector('.dashboard-agent-status-dot');
        const lab = row.querySelector('.dashboard-agent-status-label');
        if (!block || !dot || !lab) return;

        block.classList.remove('state-unknown', 'state-offline', 'state-available', 'state-ringing', 'state-talking');
        block.classList.add(`state-${state}`);
        lab.textContent = label;
    }
}
