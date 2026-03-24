/**
 * Live supervisor dashboard (active calls, directory-driven Agents/Queues, recordings).
 * Last modified: 2026-03-24 — queue rows show assigned agents as online/offline tags (queueAssignments + subscriberStatus).
 */

import { resolveAgentSipTargets } from './agent-sip-targets.js';

/** @param {unknown} subscriberStatus */
function parseSubscriberOnlineDict(subscriberStatus) {
    let onlineDict = {};
    if (subscriberStatus != null && typeof subscriberStatus === 'object') {
        const o = /** @type {{ onlineByNumber?: Record<string, string>, ok?: boolean }} */ (subscriberStatus);
        if (o.onlineByNumber != null && typeof o.onlineByNumber === 'object') {
            onlineDict = o.onlineByNumber;
        } else if (!('ok' in o)) {
            onlineDict = /** @type {Record<string, string>} */ (subscriberStatus);
        }
    }
    return onlineDict;
}

function heroOnlineValue(map, key) {
    if (map == null || key == null || key === '') return false;
    const v = map[key];
    return v === '1' || v === 1;
}

/**
 * @param {Record<string, string>} onlineDict
 * @param {string} number - directory map key
 * @param {{ type?: string, extension?: unknown, shortNumber?: unknown, authLogin?: unknown, callerId?: unknown }} data
 */
function isAgentOnlineInHeroMap(onlineDict, number, data) {
    if (!data || data.type !== 'agent') return false;
    const { presenceUser } = resolveAgentSipTargets(number, data);
    const authLogin = data.authLogin != null ? String(data.authLogin).trim() : '';
    const callerId = data.callerId != null ? String(data.callerId).trim() : '';
    return (
        heroOnlineValue(onlineDict, number) ||
        heroOnlineValue(onlineDict, data.extension) ||
        heroOnlineValue(onlineDict, data.shortNumber) ||
        heroOnlineValue(onlineDict, authLogin) ||
        heroOnlineValue(onlineDict, callerId) ||
        heroOnlineValue(onlineDict, presenceUser)
    );
}

function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function escapeAttr(s) {
    if (s == null) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;');
}

export class DashboardManager {
    constructor(settings) {
        this.settings = settings;
        this.apiUrl = 'https://bdl-pbx.itnetworld.co.nz/api/live-status';
        this.recUrl = 'https://bdl-pbx.itnetworld.co.nz/api/recordings';
        
        this.pollInterval = null;
        this.directory = {};
        this.allRecordings = [];
        this.wavesurfer = null;

        this.ui = {
            stats: {
                active: document.getElementById('statActiveCalls'),
                agents: document.getElementById('statAgents'),
                queues: document.getElementById('statQueues')
            },
            lists: {
                calls: document.getElementById('activeCallsList'),
                agents: document.getElementById('agentsList'),
                queues: document.getElementById('queuesList'),
                recordings: document.getElementById('recordingsList')
            }
        };

        this.initWaveSurfer();
        this.initModalListeners();
    }

    /** Resolve directory row by exact key or by extension / shortNumber (for live call legs using short ids). */
    resolveDirectoryEntry(raw) {
        if (raw == null || raw === '') return null;
        const s = String(raw).trim();
        const dir = this.directory;
        if (dir[s]) return { key: s, ...dir[s] };
        for (const [key, d] of Object.entries(dir)) {
            if (!d || typeof d !== 'object') continue;
            const ext = d.extension != null ? String(d.extension) : '';
            const short = d.shortNumber != null ? String(d.shortNumber) : '';
            const authLogin = d.authLogin != null ? String(d.authLogin).trim() : '';
            if (ext === s || short === s || key === s || authLogin === s) return { key, ...d };
            if (d.type === 'agent') {
                const { presenceUser } = resolveAgentSipTargets(key, d);
                if (presenceUser === s) return { key, ...d };
            }
        }
        return null;
    }

    initWaveSurfer() {
        // We use setTimeout to ensure the #waveform element is ready in the DOM
        setTimeout(() => {
            const container = document.querySelector('#waveform');
            if (!container) return;

            this.wavesurfer = WaveSurfer.create({
                container: '#waveform',
                waveColor: '#3498db',
                progressColor: '#2980b9',
                cursorColor: '#fff',
                barWidth: 2,
                barRadius: 3,
                responsive: true,
                height: 80,
                normalize: true
            });

            const playBtn = document.getElementById('btnPlayPause');
            if (playBtn) {
                this.wavesurfer.on('play', () => { playBtn.innerHTML = '<i class="fa-solid fa-pause"></i>'; });
                this.wavesurfer.on('pause', () => { playBtn.innerHTML = '<i class="fa-solid fa-play"></i>'; });
                playBtn.onclick = () => this.wavesurfer.playPause();
            }
        }, 100);
    }

    initModalListeners() {
        const modal = document.getElementById('audioModal');
        document.addEventListener('click', (e) => {
            if (e.target.id === 'btnCloseAudioModal' || e.target === modal) {
                modal.classList.add('hidden');
                modal.style.display = 'none';
                if (this.wavesurfer) this.wavesurfer.stop();
            }
        });

        const agentsList = this.ui.lists.agents;
        if (agentsList && !agentsList.dataset.callDelegated) {
            agentsList.dataset.callDelegated = 'true';
            agentsList.addEventListener('click', (e) => {
                const btn = e.target.closest('.agent-dash-call-btn');
                const dial = btn?.getAttribute('data-dial');
                if (!dial || !window.app?.callSpecial) return;
                e.preventDefault();
                window.app.callSpecial(dial);
            });
        }

        const recList = this.ui.lists.recordings;
        if (recList && !recList.dataset.playDelegated) {
            recList.dataset.playDelegated = 'true';
            recList.addEventListener('click', (e) => {
                const btn = e.target.closest('.rec-play-btn');
                if (!btn?.dataset.recUrl) return;
                let url;
                try {
                    url = decodeURIComponent(btn.dataset.recUrl);
                } catch {
                    url = btn.dataset.recUrl;
                }
                window.openDashboardAudio(url, btn.dataset.recTitle || '', btn.dataset.recDate || '');
            });
        }
    }

    start() {
        this.fetchData();
        this.pollInterval = setInterval(() => this.fetchData(), 3000);
    }

    async fetchData() {
        try {
            const [statusRes, recRes] = await Promise.all([
                fetch(this.apiUrl).then(r => r.json()),
                fetch(this.recUrl).then(r => r.json())
            ]);

            this.directory = statusRes.directory || {};
            this.allRecordings = recRes || [];
            
            this.render(statusRes);
            this.renderRecordings(this.allRecordings);
        } catch (e) { console.error("Dashboard Sync Error:", e); }
    }

    /** @param {Record<string, unknown>} [data] live-status JSON (defaults if omitted between polls) */
    render(data = {}) {
        const calls = Array.isArray(data.calls) ? data.calls : [];
        const active = calls.filter((c) => c.status === 'answered');
        const queuedCalls = calls.filter((c) => c.status === 'ringing');
        const onlineDict = parseSubscriberOnlineDict(data.subscriberStatus);

        const agents = Object.entries(this.directory)
            .filter(([, d]) => d && d.type === 'agent')
            .sort((a, b) => {
                const aOn = isAgentOnlineInHeroMap(onlineDict, a[0], a[1]);
                const bOn = isAgentOnlineInHeroMap(onlineDict, b[0], b[1]);
                if (aOn !== bOn) return aOn ? -1 : 1;
                return (a[1].name || '').localeCompare(b[1].name || '', undefined, { sensitivity: 'base' });
            });

        const queuesDir = Object.entries(this.directory).filter(([num, d]) => d && d.type === 'queue');

        if (this.ui.stats.active) this.ui.stats.active.innerText = String(active.length);
        if (this.ui.stats.agents) this.ui.stats.agents.innerText = String(agents.length);
        // Label is "Queues" → count configured queue entries in directory (not waiting calls, not agents).
        if (this.ui.stats.queues) this.ui.stats.queues.innerText = String(queuesDir.length);

        this.renderCallsList(active);
        this.renderAgentsList(agents, data.subscriberStatus);
        this.renderQueuesList(queuesDir, queuedCalls, data.queueAssignments || {}, data.subscriberStatus);
    }

    renderCallsList(calls) {
        const container = this.ui.lists.calls;
        if (!container) return;
        container.innerHTML = calls.length ? calls.map((c) => {
            const calleeRaw = c.callee_number;
            const resolved = this.resolveDirectoryEntry(calleeRaw);
            const calleeLabel = resolved
                ? `${escapeHtml(resolved.name)} · Ext: ${escapeHtml(resolved.extension || resolved.key)}`
                : `Ext: ${escapeHtml(calleeRaw)}`;
            return `
            <div class="supervisor-call-item">
                <div class="call-info">
                    <div class="call-header"><span class="call-agent">${calleeLabel}</span><span class="call-status answered">Active</span></div>
                    <div class="call-parties">${escapeHtml(c.caller_number)} → ${escapeHtml(calleeRaw)}</div>
                </div>
            </div>`;
        }).join('') : '<div class="empty-state">No active calls</div>';
    }

    /**
     * @param {Array<[string, object]>} agents
     * @param {{ ok?: boolean, onlineByNumber?: Record<string, string> }|Record<string, string>|null|undefined} subscriberStatus
     */
    renderAgentsList(agents, subscriberStatus) {
        const container = this.ui.lists.agents;
        if (!container) return;

        const onlineDict = parseSubscriberOnlineDict(subscriberStatus);
        const heroEnabled = subscriberStatus != null && typeof subscriberStatus === 'object';

        container.innerHTML = agents.map(([number, data]) => {
            const displayName = escapeHtml(data.name || 'Agent');
            const { presenceUser, dialUser } = resolveAgentSipTargets(number, data);

            const isOnline = isAgentOnlineInHeroMap(onlineDict, number, data);

            const stateClass = !heroEnabled ? 'state-unknown' : isOnline ? 'state-available' : 'state-offline';
            const stateLabel = !heroEnabled ? '…' : isOnline ? 'Online' : 'Offline';

            const shortNum = data.shortNumber != null ? String(data.shortNumber).trim() : '';
            const extBlock =
                shortNum && presenceUser && shortNum !== presenceUser
                    ? `<div class="agent-meta"><span class="agent-label">Extension:</span> ${escapeHtml(dialUser)}</div>
                       <div class="agent-meta subtle"><span class="agent-label">Login:</span> ${escapeHtml(presenceUser)}</div>`
                    : `<div class="agent-meta"><span class="agent-label">Extension:</span> ${escapeHtml(dialUser || presenceUser)}</div>`;

            return `
            <div class="supervisor-agent-item" data-sip-login="${escapeAttr(presenceUser)}">
                <div class="dashboard-agent-status ${stateClass}" title="Presence">
                    <span class="dashboard-agent-status-dot" aria-hidden="true"></span>
                    <span class="dashboard-agent-status-label">${stateLabel}</span>
                </div>
                <div class="agent-info">
                    <span class="agent-extension" title="Display name">${displayName}</span>
                    ${extBlock}
                </div>
                <button type="button" class="btn-icon-only agent-dash-call-btn" data-dial="${escapeAttr(dialUser)}" title="Call this agent">
                    <i class="fa-solid fa-phone"></i>
                </button>
            </div>`;
        }).join('');
    }

    /**
     * @param {Array<[string, object]>} queues
     * @param {unknown[]} queuedCalls
     * @param {Record<string, string[]>} [queueAssignments] queue key / ext → SIP logins or extensions from server
     * @param {unknown} [subscriberStatus]
     */
    renderQueuesList(queues, queuedCalls, queueAssignments = {}, subscriberStatus = null) {
        const container = this.ui.lists.queues;
        if (!container) return;

        const onlineDict = parseSubscriberOnlineDict(subscriberStatus);

        if (!queues.length) {
            container.innerHTML =
                '<div class="empty-state">No queues in directory (check phonebook: name or type must identify queues).</div>';
            return;
        }

        container.innerHTML = queues.map(([number, data]) => {
            const ext = data.extension != null ? String(data.extension) : number;
            const waitingCount = queuedCalls.filter(
                (c) => String(c.callee_number) === String(number) || String(c.callee_number) === String(ext)
            ).length;

            const assignedRaw = queueAssignments[number] || queueAssignments[ext] || [];
            const assignedAgents = Array.isArray(assignedRaw) ? assignedRaw : [];

            const agentTags = assignedAgents.map((agentLogin) => {
                const id = String(agentLogin).trim();
                const isOnline = this._isQueueMemberOnline(onlineDict, id);
                const dirEntry = this.resolveDirectoryEntry(id);
                const agentName = dirEntry?.name || id;
                const dotColor = isOnline ? '#2ecc71' : '#e74c3c';
                const opacity = isOnline ? '1' : '0.5';
                return `<span style="display:inline-block; font-size:0.75rem; background:rgba(255,255,255,0.1); padding:4px 8px; border-radius:12px; margin-right:6px; margin-top:6px; opacity:${opacity};">
                            <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:${dotColor}; margin-right:4px; vertical-align:middle;"></span>
                            ${escapeHtml(agentName)}
                        </span>`;
            }).join('');

            return `
            <div class="supervisor-queue-item" style="padding-bottom:12px; height:auto;">
                <div class="queue-info" style="display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:8px; margin-bottom:8px;">
                    <span>
                        <span class="queue-name" style="font-size:1.1rem; font-weight:600;" title="Display name">${escapeHtml(data.name || 'Queue')}</span>
                        <span class="queue-ext agent-meta" style="margin-left:8px;">Ext: ${escapeHtml(ext)}</span>
                    </span>
                    <span class="call-status ${waitingCount > 0 ? 'ringing' : 'answered'}">${waitingCount} Waiting</span>
                </div>
                <div class="queue-agents">
                    ${assignedAgents.length > 0 ? agentTags : '<span class="subtle" style="font-size:0.8rem; opacity:0.7;">No agents assigned</span>'}
                </div>
            </div>`;
        }).join('');
    }

    /**
     * @param {Record<string, string>} onlineDict
     * @param {string} agentId - SIP login, extension, or directory key from queueAssignments
     */
    _isQueueMemberOnline(onlineDict, agentId) {
        if (heroOnlineValue(onlineDict, agentId)) return true;
        const d = this.resolveDirectoryEntry(agentId);
        if (!d || d.type !== 'agent') return false;
        return isAgentOnlineInHeroMap(onlineDict, d.key, d);
    }

    renderRecordings(recs) {
        const container = this.ui.lists.recordings;
        const searchInput = document.getElementById('recSearch');
        if (!container) return;

        const filter = searchInput ? searchInput.value.toLowerCase() : "";
        const filtered = recs.filter((r) => {
            if (!r.recording_url) return false;
            if (!filter) return true;
            const cr = this.resolveDirectoryEntry(r.caller_number);
            const ce = this.resolveDirectoryEntry(r.callee_number);
            const hay = [
                r.caller_number,
                r.callee_number,
                cr?.name,
                ce?.name,
                cr?.extension,
                ce?.extension
            ]
                .filter(Boolean)
                .join(' ')
                .toLowerCase();
            return hay.includes(filter);
        });

        if (filtered.length === 0) {
            container.innerHTML = `<div class="empty-state">${filter ? 'No matching names or numbers' : 'No recordings found'}</div>`;
            return;
        }

        container.innerHTML = filtered.slice(0, 50).map((r) => {
            const dateStr = new Date(r.ended_at).toLocaleString();
            const cr = this.resolveDirectoryEntry(r.caller_number);
            const ce = this.resolveDirectoryEntry(r.callee_number);
            const callerPlain = cr
                ? `${cr.name} (${r.caller_number})`
                : String(r.caller_number ?? '');
            const calleePlain = ce
                ? `${ce.name} (${r.callee_number})`
                : String(r.callee_number ?? '');
            const lineTitle = `${callerPlain} → ${calleePlain}`;
            const url = decodeURIComponent(r.recording_url);

            return `
            <div class="recording-item" style="display:flex; justify-content:space-between; align-items:center; padding:12px; border-bottom:1px solid rgba(255,255,255,0.05);">
                <div class="recording-info">
                    <div style="font-weight:600; color:white;">${escapeHtml(lineTitle)}</div>
                    <div style="font-size:0.75rem; color:var(--text-muted);">${escapeHtml(dateStr)} | ${escapeHtml(String(r.duration))}s</div>
                </div>
                <button type="button" class="btn-play-circle rec-play-btn" data-rec-url="${encodeURIComponent(url)}" data-rec-title="${escapeAttr(lineTitle)}" data-rec-date="${escapeAttr(dateStr)}">
                    <i class="fa-solid fa-play"></i>
                </button>
            </div>`;
        }).join('');

        if (searchInput && !searchInput.dataset.listener) {
            searchInput.dataset.listener = "true";
            searchInput.oninput = () => this.renderRecordings(this.allRecordings);
        }
    }
}

window.openDashboardAudio = function(url, title, date) {
    const modal = document.getElementById('audioModal');
    const download = document.getElementById('downloadBtn');
    
    // This sends the request to your server, which then gets it from Hero for you
    const proxiedUrl = `https://bdl-pbx.itnetworld.co.nz/api/proxy-audio?url=${encodeURIComponent(url)}`;
    
    document.getElementById('modalTitle').innerText = title;
    document.getElementById('modalSubtitle').innerText = date;
    
    if (download) download.href = proxiedUrl;
    
    // Show modal
    modal.classList.remove('hidden');
    modal.style.display = 'flex'; 

    if (window.app && window.app.dashboard && window.app.dashboard.wavesurfer) {
        // Load the proxied URL to bypass the CORS "Failed to fetch" error
        window.app.dashboard.wavesurfer.load(proxiedUrl);
        window.app.dashboard.wavesurfer.once('ready', () => {
            window.app.dashboard.wavesurfer.play();
        });
    }
};