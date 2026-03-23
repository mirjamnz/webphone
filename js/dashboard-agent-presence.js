/**
 * dashboard-agent-presence.js
 * SIP SUBSCRIBE (presence) for supervisor Agents tab — BLF-style online/busy indicators.
 *
 * Use case: Show green “online” / busy / ringing per agent login (full SIP user), matching main BLF.
 * Staggers SUBSCRIBE so Kamailio is not hit with dozens of parallel dialogs (avoids 408 / poisoned WS).
 * Last modified: 2026-03-24
 */
import * as SIP from 'https://cdn.jsdelivr.net/npm/sip.js@0.21.2/+esm';

const SUBSCRIBE_STAGGER_MS = 110;
const SUBSCRIBE_INITIAL_DELAY_MS = 200;

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
        /** @type {Set<string>} */
        this._currentWanted = new Set();
        this._subscribeQueue = [];
        this._subscribePumpTimer = null;
        this._pumpRunning = false;
    }

    _clearSubscribePump() {
        if (this._subscribePumpTimer) {
            clearTimeout(this._subscribePumpTimer);
            this._subscribePumpTimer = null;
        }
        this._subscribeQueue = [];
        this._pumpRunning = false;
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
        for (const [numKey, d] of agents) {
            if (!d || d.type !== 'agent') continue;
            const login = String(numKey || d.extension || '').trim();
            if (login) wanted.add(login);
        }
        this._currentWanted = wanted;

        for (const login of [...this.subscriptions.keys()]) {
            if (!wanted.has(login)) this._unsubscribeOne(login);
        }

        const registered = this.phone?.lastKnownState === 'Registered';
        if (!ua || !registered) {
            this._clearSubscribePump();
            for (const login of [...this.subscriptions.keys()]) {
                this._unsubscribeOne(login);
            }
            this.stateByLogin.clear();
            const hint = !ua ? 'No line' : 'Not registered';
            for (const login of wanted) {
                this._paintRow(login, 'unknown', hint);
            }
            return;
        }

        for (const login of wanted) {
            if (!this.subscriptions.has(login)) {
                this._enqueueSubscribe(login);
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
            } else if (this.phone.lastKnownState !== 'Registered') {
                this._paintRow(login, 'unknown', 'Not registered');
            } else {
                this._paintRow(login, 'unknown', '…');
            }
        });
    }

    _enqueueSubscribe(login) {
        if (this.subscriptions.has(login)) return;
        if (this._subscribeQueue.includes(login)) return;
        this._subscribeQueue.push(login);
        this._startPumpIfNeeded();
    }

    _startPumpIfNeeded() {
        if (this._pumpRunning) return;
        this._pumpRunning = true;
        const kick = () => {
            this._subscribePumpTimer = null;
            this._pumpStep();
        };
        this._subscribePumpTimer = setTimeout(kick, SUBSCRIBE_INITIAL_DELAY_MS);
    }

    _pumpStep() {
        const ua = this.phone?.userAgent;
        const registered = this.phone?.lastKnownState === 'Registered';
        if (!ua || !registered || ua !== this._boundUa) {
            this._clearSubscribePump();
            return;
        }

        const login = this._subscribeQueue.shift();
        if (!login) {
            this._pumpRunning = false;
            return;
        }

        if (!this._currentWanted.has(login)) {
            if (this._subscribeQueue.length) {
                this._subscribePumpTimer = setTimeout(() => this._pumpStep(), SUBSCRIBE_STAGGER_MS);
            } else {
                this._pumpRunning = false;
            }
            return;
        }

        if (!this.subscriptions.has(login)) {
            this._subscribe(login, ua);
        }

        if (this._subscribeQueue.length) {
            this._subscribePumpTimer = setTimeout(() => this._pumpStep(), SUBSCRIBE_STAGGER_MS);
        } else {
            this._pumpRunning = false;
        }
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
        this._clearSubscribePump();
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
