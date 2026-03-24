/**
 * Live supervisor dashboard (active calls, directory-driven Agents/Queues, recordings).
 * Last modified: 2026-03-24 — agent presence from Hero subscriberStatus only (no SIP SUBSCRIBE on dashboard).
 */

import { resolveAgentSipTargets } from './agent-sip-targets.js';

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
            if (ext === s || short === s || key === s) return { key, ...d };
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

    render(data) {
        const calls = data.calls || [];
        const active = calls.filter(c => c.status === 'answered');
        const queuedCalls = calls.filter(c => c.status === 'ringing');
        const agents = Object.entries(this.directory)
            .filter(([, d]) => d.type === 'agent')
            .sort((a, b) => (a[1].name || '').localeCompare(b[1].name || '', undefined, { sensitivity: 'base' }));
        const queuesDir = Object.entries(this.directory).filter(([num, d]) => d.type === 'queue');

        if (this.ui.stats.active) this.ui.stats.active.innerText = active.length;
        if (this.ui.stats.queues) this.ui.stats.queues.innerText = queuedCalls.length;
        if (this.ui.stats.agents) this.ui.stats.agents.innerText = agents.length;

        this.renderCallsList(active);
        this.renderAgentsList(agents, data.subscriberStatus);
        this.renderQueuesList(queuesDir, queuedCalls);
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
     * @param {Record<string, string>|null|undefined} subscriberStatus - from Hero Get-Subscriber-Status Data
     */
    renderAgentsList(agents, subscriberStatus) {
        const container = this.ui.lists.agents;
        if (!container) return;

        const heroOn = (map, key) => {
            if (map == null || key == null || key === '') return false;
            const v = map[key];
            return v === '1' || v === 1;
        };

        container.innerHTML = agents.map(([number, data]) => {
            const displayName = escapeHtml(data.name || 'Agent');
            const { presenceUser, dialUser } = resolveAgentSipTargets(number, data);

            let isOnline = false;
            if (subscriberStatus && typeof subscriberStatus === 'object') {
                const authLogin = data.authLogin != null ? String(data.authLogin).trim() : '';
                const callerId = data.callerId != null ? String(data.callerId).trim() : '';
                isOnline =
                    heroOn(subscriberStatus, number) ||
                    heroOn(subscriberStatus, data.extension) ||
                    heroOn(subscriberStatus, data.shortNumber) ||
                    heroOn(subscriberStatus, authLogin) ||
                    heroOn(subscriberStatus, callerId) ||
                    heroOn(subscriberStatus, presenceUser);
            }

            const heroEnabled = subscriberStatus != null && typeof subscriberStatus === 'object';
            const stateClass = !heroEnabled ? 'state-unknown' : isOnline ? 'state-available' : 'state-offline';
            const stateLabel = !heroEnabled ? '…' : isOnline ? 'Online' : 'Offline';

            const shortNum = data.shortNumber != null ? String(data.shortNumber).trim() : '';
            const extBlock =
                shortNum && presenceUser && shortNum !== presenceUser
                    ? `<div class="agent-meta"><span class="agent-label">Extension:</span> ${escapeHtml(shortNum)}</div>
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

    renderQueuesList(queues, queuedCalls) {
        const container = this.ui.lists.queues;
        if (!container) return;
        container.innerHTML = queues.map(([number, data]) => {
            const ext = data.extension != null ? String(data.extension) : number;
            const waitingCount = queuedCalls.filter(
                (c) => String(c.callee_number) === String(number) || String(c.callee_number) === String(ext)
            ).length;
            return `<div class="supervisor-queue-item"><div class="queue-info"><span class="queue-name" title="Display name">${escapeHtml(
                data.name || 'Queue'
            )}</span><span class="queue-ext agent-meta">Ext: ${escapeHtml(ext)}</span><span class="call-status ${
                waitingCount > 0 ? 'ringing' : 'answered'
            }">${waitingCount} Waiting</span></div></div>`;
        }).join('');
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