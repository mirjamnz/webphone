/**
 * dashboard-agent-presence.js
 * SIP SUBSCRIBE (presence) for supervisor Agents tab — BLF-style online/busy indicators.
 *
 * Use case: Show green “online” / busy / ringing per agent login (full SIP user), matching main BLF.
 * Staggers SUBSCRIBE so Kamailio is not hit with dozens of parallel dialogs (avoids 408 / poisoned WS).
 * Last modified: 2026-03-24 — Hero match via data-hero-probe; prefer Hero online when SIP idle/offline.
 */
import * as SIP from 'https://cdn.jsdelivr.net/npm/sip.js@0.21.2/+esm';
import { resolveAgentSipTargets } from './agent-sip-targets.js';

const SUBSCRIBE_STAGGER_MS = 200;
const SUBSCRIBE_INITIAL_DELAY_MS = 350;

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
        /** @type {Record<string, string>|null} Hero portal online map (login -> "1"); null = feature off */
        this._heroSubscriberStatus = null;
    }

    /**
     * @param {Record<string, string>|null|undefined} map - from /api/live-status subscriberStatus; undefined/null disables Hero overlay
     */
    setHeroSubscriberStatus(map) {
        if (map == null || typeof map !== 'object') {
            this._heroSubscriberStatus = null;
            return;
        }
        this._heroSubscriberStatus = { ...map };
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
            const { presenceUser } = resolveAgentSipTargets(numKey, d);
            if (presenceUser) wanted.add(presenceUser);
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
            this.paintAllRows();
            return;
        }

        for (const login of wanted) {
            if (!this.subscriptions.has(login)) {
                this._enqueueSubscribe(login);
            }
        }
    }

    /** Re-apply merged Hero + SIP state for every agent row in the DOM. */
    paintAllRows() {
        const container = document.getElementById('agentsList');
        if (!container) return;
        container.querySelectorAll('.supervisor-agent-item[data-sip-login]').forEach((row) => {
            this._paintRowFromMergedRow(row);
        });
    }

    /**
     * @param {Record<string, unknown>|null|undefined} hero
     * @param {string[]} probes - directory / API identifiers for this row
     */
    _heroAnyOnline(hero, probes) {
        if (!hero || !probes.length) return false;
        for (const k of probes) {
            const v = hero[k];
            if (v === '1' || v === 1 || String(v).toLowerCase() === 'true') return true;
        }
        return false;
    }

    /** @param {Element} row */
    _collectHeroProbes(row) {
        const login = row.getAttribute('data-sip-login') || '';
        const raw = row.getAttribute('data-hero-probe') || '';
        const parts = raw
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
        return [...new Set([...(login ? [login] : []), ...parts])];
    }

    _paintRowFromMergedState(login) {
        const container = document.getElementById('agentsList');
        if (!container || !login) return;
        const row = container.querySelector(`.supervisor-agent-item[data-sip-login="${CSS.escape(login)}"]`);
        if (row) this._paintRowFromMergedRow(row);
    }

    /** @param {Element} row */
    _paintRowFromMergedRow(row) {
        const login = row.getAttribute('data-sip-login');
        const probes = this._collectHeroProbes(row);
        const hero = this._heroSubscriberStatus;
        const heroOn = this._heroAnyOnline(hero, probes);
        const heroHasData = hero && Object.keys(hero).length > 0;
        const sip = login ? this.stateByLogin.get(login) : undefined;

        const busyLike = sip && (sip.state === 'talking' || sip.state === 'ringing');
        if (busyLike) {
            this._applyRowPresence(row, sip.state, sip.label);
            return;
        }
        if (heroOn) {
            this._applyRowPresence(row, 'available', 'Online');
            return;
        }
        if (sip) {
            this._applyRowPresence(row, sip.state, sip.label);
            return;
        }
        if (heroHasData && !heroOn) {
            this._applyRowPresence(row, 'offline', 'Offline');
            return;
        }
        if (!this.phone?.userAgent) {
            this._applyRowPresence(row, 'unknown', 'No line');
        } else if (this.phone.lastKnownState !== 'Registered') {
            this._applyRowPresence(row, 'unknown', 'Not registered');
        } else {
            this._applyRowPresence(row, 'unknown', '…');
        }
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
                    this._paintRowFromMergedState(login);
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
        if (row) this._applyRowPresence(row, state, label);
    }

    /** @param {Element} row */
    _applyRowPresence(row, state, label) {
        const block = row.querySelector('.dashboard-agent-status');
        const dot = row.querySelector('.dashboard-agent-status-dot');
        const lab = row.querySelector('.dashboard-agent-status-label');
        if (!block || !dot || !lab) return;

        block.classList.remove('state-unknown', 'state-offline', 'state-available', 'state-ringing', 'state-talking');
        block.classList.add(`state-${state}`);
        lab.textContent = label;
    }
}
