/**
 * Live supervisor dashboard (active calls, directory-driven Agents/Queues, recordings).
 * Last modified: 2026-03-24 — fuzzy resolveDirectoryEntry + manage checklist assignment match.
 */

import { resolveAgentSipTargets } from './agent-sip-targets.js';
import { CONFIG } from './config.js';

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

    /** Resolve directory row by exact key, extension, or fuzzy match (for Hero Portal string formats). */
    resolveDirectoryEntry(raw) {
        if (raw == null || raw === '') return null;
        const s = String(raw).trim();
        const dir = this.directory;
        if (dir[s]) return { key: s, ...dir[s] };

        // Exact Match
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

        // Fuzzy Match (Catches Hero Portal formatting like "MariaO (7677)")
        const sLower = s.toLowerCase();
        for (const [key, d] of Object.entries(dir)) {
            if (!d || typeof d !== 'object' || d.type !== 'agent') continue;
            const name = d.name ? String(d.name).toLowerCase() : '';
            const short = d.shortNumber ? String(d.shortNumber).toLowerCase() : '';
            if (name && name.length > 2 && sLower.includes(name)) return { key, ...d };
            if (short && short.length > 2 && sLower.includes(short)) return { key, ...d };
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

        this.initQueueManageListeners();
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

        const availableAgentsCount = agents.filter(([num, d]) => isAgentOnlineInHeroMap(onlineDict, num, d)).length;
        const todayStr = new Date().toDateString();
        const recordings = Array.isArray(this.allRecordings) ? this.allRecordings : [];
        const answeredTodayCount = recordings.filter((r) => {
            if (r == null || r.ended_at == null) return false;
            const d = new Date(r.ended_at);
            return !Number.isNaN(d.getTime()) && d.toDateString() === todayStr;
        }).length;

        this.renderStatsRow(availableAgentsCount, active.length, queuedCalls.length, answeredTodayCount);

        this.renderCallsList(active);
        this.renderAgentsList(agents, data.subscriberStatus);
        this.renderQueuesList(queuesDir, queuedCalls, active, data.queueAssignments || {}, data.subscriberStatus);
    }

    /** Dynamically replaces the old stats HTML with a modern 4-card grid (use case: supervisor overview). */
    renderStatsRow(available, active, queued, answered) {
        let statsContainer = document.getElementById('dynamicStatsRow');
        if (!statsContainer) {
            const oldContainer = this.ui.stats.active?.parentElement?.parentElement;
            if (oldContainer) {
                statsContainer = document.createElement('div');
                statsContainer.id = 'dynamicStatsRow';
                statsContainer.style.display = 'grid';
                statsContainer.style.gridTemplateColumns = 'repeat(auto-fit, minmax(200px, 1fr))';
                statsContainer.style.gap = '16px';
                statsContainer.style.marginBottom = '24px';
                oldContainer.parentNode.insertBefore(statsContainer, oldContainer);
                oldContainer.style.display = 'none';
            } else {
                return;
            }
        }

        statsContainer.innerHTML = `
            <div style="background: #1e2129; border: 1px solid #2a2e39; border-radius: 8px; padding: 20px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                <div style="color: #8b949e; font-size: 0.85rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;">Available Agents</div>
                <div style="color: #2ecc71; font-size: 2.5rem; font-weight: 700; line-height: 1;">${available}</div>
            </div>
            <div style="background: #1e2129; border: 1px solid #2a2e39; border-radius: 8px; padding: 20px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                <div style="color: #8b949e; font-size: 0.85rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;">Active Calls</div>
                <div style="color: #3498db; font-size: 2.5rem; font-weight: 700; line-height: 1;">${active}</div>
            </div>
            <div style="background: #1e2129; border: 1px solid #2a2e39; border-radius: 8px; padding: 20px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                <div style="color: #8b949e; font-size: 0.85rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;">Calls Queued</div>
                <div style="color: #f39c12; font-size: 2.5rem; font-weight: 700; line-height: 1;">${queued}</div>
            </div>
            <div style="background: #1e2129; border: 1px solid #2a2e39; border-radius: 8px; padding: 20px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                <div style="color: #8b949e; font-size: 0.85rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;">Answered Today</div>
                <div style="color: #ffffff; font-size: 2.5rem; font-weight: 700; line-height: 1;">${answered}</div>
            </div>
        `;
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

            const stateLabel = !heroEnabled ? '…' : isOnline ? 'Online' : 'Offline';
            const dotColor = !heroEnabled ? '#f1c40f' : isOnline ? '#2ecc71' : '#e74c3c';
            const rowOpacity = isOnline ? '1' : '0.6';

            return `
            <div data-sip-login="${escapeAttr(presenceUser)}" style="background: #1e2129; border-radius: 8px; margin-bottom: 8px; border: 1px solid #2a2e39; padding: 12px 16px; display: flex; justify-content: space-between; align-items: center; transition: all 0.2s ease; opacity: ${rowOpacity};">
                <div style="display: flex; align-items: center; gap: 16px;">
                    <span style="display:inline-flex; align-items:center; font-size:0.75rem; background:rgba(255,255,255,0.05); padding:6px 12px; border-radius:12px; color: white; border: 1px solid rgba(255,255,255,0.1); width: 80px; justify-content: flex-start;">
                        <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:${dotColor}; margin-right:8px;"></span>
                        ${stateLabel}
                    </span>
                    
                    <div>
                        <div style="font-size: 1rem; font-weight: 600; color: #ffffff; margin-bottom: 2px;">${displayName}</div>
                        <div style="font-size: 0.8rem; color: #8b949e; font-family: monospace;">
                            Ext: ${escapeHtml(dialUser)} ${presenceUser !== dialUser ? `<span style="opacity:0.5; margin:0 4px;">|</span> Login: ${escapeHtml(presenceUser)}` : ''}
                        </div>
                    </div>
                </div>
                
                <button type="button" class="agent-dash-call-btn" data-dial="${escapeAttr(dialUser)}" title="Call this agent" style="background: rgba(52, 152, 219, 0.1); color: #3498db; border: 1px solid rgba(52, 152, 219, 0.2); border-radius: 6px; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: background 0.2s;">
                    <i class="fa-solid fa-phone"></i>
                </button>
            </div>`;
        }).join('');
    }

    /**
     * @param {Array<[string, object]>} queues
     * @param {unknown[]} queuedCalls
     * @param {unknown[]} activeCalls
     * @param {Record<string, string[]>} queueAssignments
     * @param {unknown} subscriberStatus
     */
    renderQueuesList(queues, queuedCalls, activeCalls, queueAssignments = {}, subscriberStatus = null) {
        const container = this.ui.lists.queues;
        if (!container) return;

        const onlineDict = parseSubscriberOnlineDict(subscriberStatus);

        if (!queues.length) {
            container.innerHTML = '<div class="empty-state">No queues configured.</div>';
            return;
        }

        const isSameNum = (numA, numB) => {
            if (!numA || !numB) return false;
            const a = String(numA).replace(/\D/g, '');
            const b = String(numB).replace(/\D/g, '');
            return a.slice(-8) === b.slice(-8);
        };

        container.innerHTML = queues.map(([number, data]) => {
            const ext = data.extension != null ? String(data.extension) : number;

            const waitingCount = queuedCalls.filter(
                (c) => isSameNum(c.callee_number, number) || isSameNum(c.callee_number, ext)
            ).length;
            const activeCount = activeCalls.filter(
                (c) => isSameNum(c.callee_number, number) || isSameNum(c.callee_number, ext)
            ).length;

            const assignedRaw = queueAssignments[number] || queueAssignments[ext] || [];
            const assignedAgents = Array.isArray(assignedRaw) ? assignedRaw : [];

            const agentTags = assignedAgents
                .map((agentLogin) => {
                    const id = String(agentLogin).trim();
                    const isOnline = this._isQueueMemberOnline(onlineDict, id);
                    const dirEntry = this.resolveDirectoryEntry(id);
                    const agentName = dirEntry?.name || id;

                    const dotColor = isOnline ? '#2ecc71' : '#e74c3c';
                    const opacity = isOnline ? '1' : '0.5';

                    return `<span style="display:inline-flex; align-items:center; font-size:0.75rem; background:rgba(255,255,255,0.05); padding:6px 10px; border-radius:12px; margin-right:8px; margin-top:8px; opacity:${opacity}; color: white; border: 1px solid rgba(255,255,255,0.1);">
                            <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:${dotColor}; margin-right:6px;"></span>
                            ${escapeHtml(agentName)}
                        </span>`;
                })
                .join('');

            return `
            <div class="supervisor-queue-card" style="background: #1e2129; border-radius: 8px; margin-bottom: 24px; overflow: hidden; border: 1px solid #2a2e39; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                <div style="padding: 16px 20px; background: #252933; border-bottom: 1px solid #2a2e39; display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 12px;">
                    <div style="flex: 1;">
                        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 4px; flex-wrap: wrap;">
                            <h3 style="margin: 0; font-size: 1.25rem; font-weight: 600; color: #ffffff;">${escapeHtml(data.name || 'Queue')}</h3>
                            <button type="button" class="btn-manage-queue" data-qname="${escapeAttr(data.name || 'Queue')}" data-qnum="${escapeAttr(ext)}" style="background: transparent; border: 1px solid rgba(52, 152, 219, 0.3); color: #3498db; padding: 4px 8px; border-radius: 4px; font-size: 0.75rem; cursor: pointer; transition: all 0.2s;">
                                <i class="fa-solid fa-gear"></i> Manage
                            </button>
                        </div>
                        <span style="font-size: 0.85rem; color: #8b949e; font-family: monospace;">Ext: ${escapeHtml(ext)}</span>
                    </div>
                    <div style="display: flex; gap: 12px;">
                        <div style="background: rgba(46, 204, 113, 0.1); border: 1px solid rgba(46, 204, 113, 0.2); color: #2ecc71; padding: 6px 16px; border-radius: 6px; font-weight: 600; font-size: 0.9rem;">
                            ${activeCount} Active
                        </div>
                        <div style="background: rgba(231, 76, 60, 0.1); border: 1px solid rgba(231, 76, 60, 0.2); color: #e74c3c; padding: 6px 16px; border-radius: 6px; font-weight: 600; font-size: 0.9rem;">
                            ${waitingCount} Waiting
                        </div>
                    </div>
                </div>
                <div style="padding: 16px 20px;">
                    ${assignedAgents.length > 0 ? agentTags : '<span style="color:#8b949e; font-size:0.9rem;">No agents assigned to this queue.</span>'}
                </div>
            </div>`;
        }).join('');
    }

    /**
     * Manage queue members: open modal, checklist, POST /api/queues/manage on checkbox change.
     */
    initQueueManageListeners() {
        const queuesList = this.ui.lists.queues;
        const modal = document.getElementById('queueManageModal');
        const closeBtn = document.getElementById('btnCloseQueueManage');
        const searchInput = document.getElementById('queueAgentSearch');
        const checklist = document.getElementById('queueAgentChecklist');
        const loadingBox = document.getElementById('queueManageLoading');

        if (!queuesList || !modal) return;

        const closeModal = () => {
            modal.classList.add('hidden');
            modal.style.display = 'none';
        };
        if (closeBtn) {
            closeBtn.onclick = closeModal;
        }
        modal.onclick = (e) => {
            if (e.target === modal) closeModal();
        };

        if (searchInput) {
            searchInput.oninput = (e) => {
                const term = /** @type {HTMLInputElement} */ (e.target).value.toLowerCase();
                const rows = checklist ? checklist.querySelectorAll('.agent-checkbox-row') : [];
                rows.forEach((row) => {
                    const el = /** @type {HTMLElement} */ (row);
                    el.style.display = el.innerText.toLowerCase().includes(term) ? 'flex' : 'none';
                });
            };
        }

        if (!queuesList.dataset.manageDelegated) {
            queuesList.dataset.manageDelegated = 'true';
            queuesList.addEventListener('click', (e) => {
                const btn = e.target.closest('.btn-manage-queue');
                if (!btn) return;
                const qName = btn.getAttribute('data-qname') || 'Queue';
                const qNum = btn.getAttribute('data-qnum') || '';
                const titleEl = document.getElementById('manageQueueTitle');
                const extEl = document.getElementById('manageQueueExt');
                if (titleEl) titleEl.textContent = `Manage: ${qName}`;
                if (extEl) extEl.textContent = `Ext: ${qNum}`;
                if (searchInput) searchInput.value = '';
                this._renderManageChecklist(qNum, checklist, loadingBox);
                modal.classList.remove('hidden');
                modal.style.display = 'flex';
            });
        }
    }

    /**
     * @param {string} queueNumber
     * @param {HTMLElement | null} container
     * @param {HTMLElement | null} loadingBox
     */
    _renderManageChecklist(queueNumber, container, loadingBox) {
        if (!container) return;
        container.innerHTML =
            '<div style="text-align:center; color:#8b949e; padding:20px;"><i class="fa-solid fa-spinner fa-spin"></i> Loading agents...</div>';

        const agents = Object.entries(this.directory).filter(([, d]) => d && d.type === 'agent');

        fetch(this.apiUrl)
            .then((r) => r.json())
            .then((data) => {
                const assignments = data.queueAssignments || {};
                const assignedRaw = assignments[queueNumber] || [];
                const assignedList = Array.isArray(assignedRaw) ? assignedRaw : [];

                container.innerHTML = agents
                    .sort((a, b) => (a[1].name || '').localeCompare(b[1].name || '', undefined, { sensitivity: 'base' }))
                    .map(([dirKey, d]) => {
                        const { presenceUser } = resolveAgentSipTargets(dirKey, d);
                        const agentLoginId = presenceUser;
                        // Fuzzy matching for the UI Checkboxes
                        const isAssigned = assignedList.some((assignedVal) => {
                            if (!assignedVal) return false;
                            const v = String(assignedVal).toLowerCase();
                            const aId = String(agentLoginId).toLowerCase();
                            if (v === aId || v.includes(aId)) return true;

                            const name = String(d.name || '').toLowerCase();
                            const short = String(d.shortNumber || '').toLowerCase();
                            const ext = String(d.extension || '').toLowerCase();

                            if (name && name.length > 2 && v.includes(name)) return true;
                            if (short && short.length > 2 && v.includes(short)) return true;
                            if (ext && ext.length > 2 && v.includes(ext)) return true;

                            return false;
                        });

                        return `
                <label class="agent-checkbox-row">
                    <div class="agent-checkbox-info">
                        <span class="agent-checkbox-name">${escapeHtml(d.name || 'Unknown')}</span>
                        <span class="agent-checkbox-ext">Ext: ${escapeHtml(d.extension || dirKey)} | ID: ${escapeHtml(agentLoginId)}</span>
                    </div>
                    <input type="checkbox" class="queue-agent-cb" data-qnum="${escapeAttr(queueNumber)}" data-login="${escapeAttr(agentLoginId)}" ${isAssigned ? 'checked' : ''}>
                </label>
                `;
                    })
                    .join('');

                container.querySelectorAll('.queue-agent-cb').forEach((cb) => {
                    cb.addEventListener('change', async (e) => {
                        const box = /** @type {HTMLInputElement} */ (e.target);
                        const action = box.checked ? 'add' : 'remove';
                        const qNum = box.getAttribute('data-qnum');
                        const loginId = box.getAttribute('data-login');
                        if (!qNum || !loginId) return;

                        box.disabled = true;
                        if (loadingBox) loadingBox.classList.remove('hidden');

                        try {
                            const res = await fetch(`${CONFIG.API_BASE_URL}/queues/manage`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ queueNumber: qNum, agentLogin: loginId, action }),
                            });
                            const result = await res.json().catch(() => ({}));

                            if (!result.success) {
                                window.alert(`Failed to ${action} agent: ${result.error || res.statusText || 'Unknown error'}`);
                                box.checked = !box.checked;
                            } else {
                                await this.fetchData();
                            }
                        } catch (err) {
                            console.error(err);
                            window.alert('Network error occurred.');
                            box.checked = !box.checked;
                        } finally {
                            box.disabled = false;
                            if (loadingBox) loadingBox.classList.add('hidden');
                        }
                    });
                });
            })
            .catch((err) => {
                console.error(err);
                container.innerHTML =
                    '<div style="color:#e74c3c; padding:10px;">Failed to load assignments.</div>';
            });
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
                r.caller_number, r.callee_number, cr?.name, ce?.name, cr?.extension, ce?.extension
            ].filter(Boolean).join(' ').toLowerCase();
            return hay.includes(filter);
        });

        if (filtered.length === 0) {
            container.innerHTML = `<div style="padding: 24px; text-align: center; color: #8b949e; font-size: 0.9rem;">${filter ? 'No matching names or numbers' : 'No recordings found'}</div>`;
            return;
        }

        container.innerHTML = filtered.slice(0, 50).map((r) => {
            const dateStr = new Date(r.ended_at).toLocaleString();
            const cr = this.resolveDirectoryEntry(r.caller_number);
            const ce = this.resolveDirectoryEntry(r.callee_number);
            const callerPlain = cr ? `${cr.name} (${r.caller_number})` : String(r.caller_number ?? '');
            const calleePlain = ce ? `${ce.name} (${r.callee_number})` : String(r.callee_number ?? '');
            const lineTitle = `${callerPlain} → ${calleePlain}`;
            let url;
            try {
                url = decodeURIComponent(r.recording_url);
            } catch {
                url = r.recording_url;
            }

            return `
            <div style="background: #1e2129; border-radius: 8px; margin-bottom: 8px; border: 1px solid #2a2e39; padding: 12px 16px; display: flex; justify-content: space-between; align-items: center; transition: all 0.2s ease;">
                <div>
                    <div style="font-size: 1rem; font-weight: 600; color: #ffffff; margin-bottom: 4px;">
                        <i class="fa-solid fa-phone-volume" style="font-size:0.8rem; color:#3498db; margin-right:8px;"></i>${escapeHtml(lineTitle)}
                    </div>
                    <div style="font-size: 0.8rem; color: #8b949e; display: flex; gap: 16px; align-items: center;">
                        <span><i class="fa-regular fa-calendar" style="margin-right: 4px;"></i> ${escapeHtml(dateStr)}</span>
                        <span><i class="fa-solid fa-stopwatch" style="margin-right: 4px;"></i> ${escapeHtml(String(r.duration))}s</span>
                    </div>
                </div>
                
                <button type="button" class="rec-play-btn" data-rec-url="${encodeURIComponent(url)}" data-rec-title="${escapeAttr(lineTitle)}" data-rec-date="${escapeAttr(dateStr)}" style="background: rgba(46, 204, 113, 0.1); color: #2ecc71; border: 1px solid rgba(46, 204, 113, 0.2); border-radius: 6px; padding: 8px 16px; cursor: pointer; font-weight: 600; font-size: 0.85rem; display: flex; align-items: center; gap: 8px; transition: background 0.2s;">
                    <i class="fa-solid fa-play"></i> Listen
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