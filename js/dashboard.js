// js/dashboard.js

/**
 * DashboardManager
 * Responsible for polling the Hero Internet / PostgreSQL API
 * and updating the Supervisor Dashboard UI.
 */
export class DashboardManager {
    constructor(settings) {
        this.settings = settings;
        this.apiUrl = 'https://bdl-pbx.itnetworld.co.nz/api/live-status';
        this.pollInterval = null;
        this.isPolling = false;
        
        // DOM Elements cache
        this.ui = {
            stats: {
                active: document.getElementById('statActiveCalls'),
                agents: document.getElementById('statAgents'),
                queues: document.getElementById('statQueues')
            },
            lists: {
                calls: document.getElementById('activeCallsList'),
                agents: document.getElementById('agentsList'),
                queues: document.getElementById('queuesList')
            }
        };
    }

    /**
     * Start the polling loop (runs every 2 seconds)
     */
    start() {
        if (this.isPolling) return;
        console.log("Dashboard: Starting API polling...");
        this.isPolling = true;
        
        // Fetch immediately, then on interval
        this.fetchData();
        this.pollInterval = setInterval(() => this.fetchData(), 2000);
    }

    /**
     * Stop the polling loop
     */
    stop() {
        console.log("Dashboard: Stopping API polling.");
        this.isPolling = false;
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
    }

    /**
     * Fetch data from your custom Node.js/Postgres API
     */
    async fetchData() {
        if (!this.isPolling) return;

        try {
            const response = await fetch(this.apiUrl);
            if (!response.ok) throw new Error(`API Error: ${response.status}`);
            
            const data = await response.json();
            this.render(data);
        } catch (error) {
            console.error("Dashboard: Fetch failed", error);
            // Optional: Show error state in UI if needed
        }
    }

    /**
     * Render the fetched data to the UI
     * @param {Object} data - The JSON response { calls: [], stats: {} }
     */
    render(data) {
        if (!data || !data.calls) return;

        // 1. Separate calls into "Active" (Answered) vs "Queued" (Ringing)
        const activeCalls = data.calls.filter(c => c.status === 'answered');
        const queuedCalls = data.calls.filter(c => c.status === 'ringing');

        // 2. Update Top Stats Counters
        if (this.ui.stats.active) this.ui.stats.active.innerText = activeCalls.length;
        if (this.ui.stats.queues) this.ui.stats.queues.innerText = queuedCalls.length;
        // Note: API doesn't give total agent count yet, so we count agents currently on calls
        const uniqueAgents = new Set(activeCalls.map(c => c.callee_number)).size;
        if (this.ui.stats.agents) this.ui.stats.agents.innerText = uniqueAgents;

        // 3. Render the Lists
        this.renderCallsList(activeCalls);
        this.renderQueuesList(queuedCalls);
        this.renderAgentsList(activeCalls); // Show agents who are currently talking
    }

    /**
     * Render the "Active Calls" tab
     */
    renderCallsList(calls) {
        const container = this.ui.lists.calls;
        if (!container) return;

        if (calls.length === 0) {
            container.innerHTML = '<div class="empty-state">No active calls</div>';
            return;
        }

        container.innerHTML = calls.map(call => {
            // Calculate duration based on start_time from DB
            const startTime = new Date(call.connect_time || call.start_time).getTime();
            const durationSec = Math.floor((Date.now() - startTime) / 1000);
            
            return `
            <div class="supervisor-call-item">
                <div class="call-info">
                    <div class="call-header">
                        <span class="call-agent"><i class="fa-solid fa-user"></i> ${call.callee_number || 'Unknown'}</span>
                        <span class="call-status answered">Active</span>
                    </div>
                    <div class="call-parties">${call.caller_number} &rarr; ${call.callee_number}</div>
                    <div class="call-meta">
                        <i class="fa-regular fa-clock"></i> ${this.formatDuration(durationSec)} 
                        &bull; ${call.direction}
                    </div>
                </div>
            </div>`;
        }).join('');
    }

    /**
     * Render the "Queues" tab (Calls that are ringing)
     */
    renderQueuesList(calls) {
        const container = this.ui.lists.queues;
        if (!container) return;

        if (calls.length === 0) {
            container.innerHTML = '<div class="empty-state">No queued calls</div>';
            return;
        }

        container.innerHTML = calls.map(call => {
            const startTime = new Date(call.start_time).getTime();
            const waitTime = Math.floor((Date.now() - startTime) / 1000);

            return `
            <div class="supervisor-queue-item" style="border-left: 3px solid var(--warning);">
                <div class="queue-info">
                    <div class="queue-header">
                        <span class="queue-name"><i class="fa-solid fa-phone-volume"></i> ${call.callee_number}</span> </div>
                    <div class="queue-stats">
                        <span class="stat" style="color: var(--danger);">
                            <i class="fa-solid fa-stopwatch"></i> Waiting: ${this.formatDuration(waitTime)}
                        </span>
                        <span class="stat">Caller: ${call.caller_number}</span>
                    </div>
                </div>
            </div>`;
        }).join('');
    }

    /**
     * Render the "Agents" tab (Agents currently on active calls)
     */
    renderAgentsList(calls) {
        const container = this.ui.lists.agents;
        if (!container) return;

        if (calls.length === 0) {
            container.innerHTML = '<div class="empty-state">No agents on calls</div>';
            return;
        }

        // Deduplicate agents (in case of weird data)
        const uniqueAgents = {};
        calls.forEach(c => { uniqueAgents[c.callee_number] = c; });

        container.innerHTML = Object.values(uniqueAgents).map(call => `
            <div class="supervisor-agent-item status-busy">
                <div class="agent-info">
                    <div class="agent-header">
                        <span class="agent-extension"><i class="fa-solid fa-headset"></i> ${call.callee_number}</span>
                        <span class="agent-status-badge status-busy">On Call</span>
                    </div>
                    <div class="agent-meta">
                        Speaking with ${call.caller_number}
                    </div>
                </div>
            </div>
        `).join('');
    }

    /**
     * Helper: Format seconds into MM:SS
     */
    formatDuration(seconds) {
        if (isNaN(seconds) || seconds < 0) return "00:00";
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
}