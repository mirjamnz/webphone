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
        const agents = Object.entries(this.directory).filter(([num, d]) => d.type === 'agent');
        const queuesDir = Object.entries(this.directory).filter(([num, d]) => d.type === 'queue');

        if (this.ui.stats.active) this.ui.stats.active.innerText = active.length;
        if (this.ui.stats.queues) this.ui.stats.queues.innerText = queuedCalls.length;
        if (this.ui.stats.agents) this.ui.stats.agents.innerText = agents.length;

        this.renderCallsList(active);
        this.renderAgentsList(agents);
        this.renderQueuesList(queuesDir, queuedCalls);
    }

    renderCallsList(calls) {
        const container = this.ui.lists.calls;
        if (!container) return;
        container.innerHTML = calls.length ? calls.map(c => `
            <div class="supervisor-call-item">
                <div class="call-info">
                    <div class="call-header"><span class="call-agent">Ext: ${c.callee_number}</span><span class="call-status answered">Active</span></div>
                    <div class="call-parties">${c.caller_number} → ${c.callee_number}</div>
                </div>
            </div>`).join('') : '<div class="empty-state">No active calls</div>';
    }

    renderAgentsList(agents) {
        const container = this.ui.lists.agents;
        if (!container) return;
        container.innerHTML = agents.map(([number, data]) => `
            <div class="supervisor-agent-item">
                <div class="agent-info"><span class="agent-extension">${data.name || 'Agent'}</span><div class="agent-meta">Ext: ${number}</div></div>
            </div>`).join('');
    }

    renderQueuesList(queues, queuedCalls) {
        const container = this.ui.lists.queues;
        if (!container) return;
        container.innerHTML = queues.map(([number, data]) => {
            const waitingCount = queuedCalls.filter(c => c.callee_number === number).length;
            return `<div class="supervisor-queue-item"><div class="queue-info"><span class="queue-name">${data.name || 'Queue'}</span><span class="call-status ${waitingCount > 0 ? 'ringing' : 'answered'}">${waitingCount} Waiting</span></div></div>`;
        }).join('');
    }

    renderRecordings(recs) {
        const container = this.ui.lists.recordings;
        const searchInput = document.getElementById('recSearch');
        if (!container) return;

        const filter = searchInput ? searchInput.value.toLowerCase() : "";
        const filtered = recs.filter(r => (r.caller_number.includes(filter) || r.callee_number.includes(filter)) && r.recording_url);

        if (filtered.length === 0) { 
            container.innerHTML = `<div class="empty-state">${filter ? 'No matching numbers' : 'No recordings found'}</div>`; 
            return; 
        }
        
        container.innerHTML = filtered.slice(0, 50).map(r => {
            const dateStr = new Date(r.ended_at).toLocaleString();
            const title = `${r.caller_number} → ${r.callee_number}`;
            const url = decodeURIComponent(r.recording_url);
            
            return `
            <div class="recording-item" style="display:flex; justify-content:space-between; align-items:center; padding:12px; border-bottom:1px solid rgba(255,255,255,0.05);">
                <div class="recording-info">
                    <div style="font-weight:600; color:white;">${title}</div>
                    <div style="font-size:0.75rem; color:var(--text-muted);">${dateStr} | ${r.duration}s</div>
                </div>
                <button class="btn-play-circle" onclick="window.openDashboardAudio('${url}', '${title}', '${dateStr}')">
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