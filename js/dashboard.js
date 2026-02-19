/**
 * js/dashboard.js
 * Handles real-time polling from the API and renders the Supervisor Dashboard.
 */

export class DashboardManager {
    constructor(settings) {
        this.settings = settings;
        this.apiUrl = 'https://bdl-pbx.itnetworld.co.nz/api/live-status';
        this.pollInterval = null;
        this.isPolling = false;
        this.directory = {}; // Stores names synced from Hero XML via the backend
        
        // UI References
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

    start() {
        if (this.isPolling) return;
        console.log("Dashboard: Starting API polling...");
        this.isPolling = true;
        this.fetchData();
        this.pollInterval = setInterval(() => this.fetchData(), 2000);
    }

    stop() {
        console.log("Dashboard: Stopping polling.");
        this.isPolling = false;
        if (this.pollInterval) clearInterval(this.pollInterval);
    }

    async fetchData() {
        if (!this.isPolling) return;
        try {
            const response = await fetch(this.apiUrl);
            if (!response.ok) throw new Error(`API Error: ${response.status}`);
            const data = await response.json();
            
            // Update local directory with Hero XML data sent by server.js
            if (data.directory) {
                this.directory = data.directory;
            }
            
            this.render(data);
        } catch (error) {
            console.error("Dashboard: Fetch failed", error);
        }
    }

    render(data) {
        if (!data || !data.calls) return;

        const activeCalls = data.calls.filter(c => c.status === 'answered');
        const queuedCalls = data.calls.filter(c => c.status === 'ringing');

        const agentsOnCall = new Set();
        activeCalls.forEach(c => {
            if (this.isAgent(c.caller_number)) agentsOnCall.add(c.caller_number);
            if (this.isAgent(c.callee_number)) agentsOnCall.add(c.callee_number);
        });

        if (this.ui.stats.active) this.ui.stats.active.innerText = activeCalls.length;
        if (this.ui.stats.queues) this.ui.stats.queues.innerText = queuedCalls.length;
        if (this.ui.stats.agents) this.ui.stats.agents.innerText = agentsOnCall.size;

        this.renderCallsList(activeCalls);
        this.renderQueuesList(queuedCalls);
        this.renderAgentsList(activeCalls);
    }

    renderCallsList(calls) {
        const container = this.ui.lists.calls;
        if (!container) return;
        if (calls.length === 0) {
            container.innerHTML = '<div class="empty-state">No active calls</div>';
            return;
        }

        container.innerHTML = calls.map(call => {
            const duration = this.calculateDuration(call.connect_time || call.start_time);
            const { agent, customer, directionIcon } = this.parseCallParties(call);

            return `
            <div class="supervisor-call-item">
                <div class="call-info">
                    <div class="call-header">
                        <span class="call-agent"><i class="${directionIcon}"></i> ${agent}</span>
                        <span class="call-status answered">Active</span>
                    </div>
                    <div class="call-parties">Speaking with <strong>${customer}</strong></div>
                    <div class="call-meta"><i class="fa-regular fa-clock"></i> ${duration}</div>
                </div>
            </div>`;
        }).join('');
    }

    renderQueuesList(calls) {
        const container = this.ui.lists.queues;
        if (!container) return;
        if (calls.length === 0) {
            container.innerHTML = '<div class="empty-state">No queued calls</div>';
            return;
        }

        container.innerHTML = calls.map(call => {
            const duration = this.calculateDuration(call.start_time);
            const queueName = this.formatName(call.callee_number);
            const customer = this.formatName(call.caller_number);

            return `
            <div class="supervisor-queue-item" style="border-left: 3px solid var(--warning);">
                <div class="queue-info">
                    <div class="queue-header"><span class="queue-name"><i class="fa-solid fa-list-ol"></i> ${queueName}</span></div>
                    <div class="queue-stats">
                        <span class="stat" style="color: var(--danger); font-weight:bold;"><i class="fa-solid fa-stopwatch"></i> Waiting: ${duration}</span>
                        <span class="stat">Caller: ${customer}</span>
                    </div>
                </div>
            </div>`;
        }).join('');
    }

    renderAgentsList(calls) {
        const container = this.ui.lists.agents;
        if (!container) return;
        
        const agentCalls = calls.filter(c => this.isAgent(c.caller_number) || this.isAgent(c.callee_number));
        if (agentCalls.length === 0) {
            container.innerHTML = '<div class="empty-state">No agents currently active</div>';
            return;
        }

        container.innerHTML = agentCalls.map(call => {
            const { agent, customer } = this.parseCallParties(call);
            const duration = this.calculateDuration(call.connect_time || call.start_time);

            return `
            <div class="supervisor-agent-item status-busy">
                <div class="agent-info">
                    <div class="agent-header">
                        <span class="agent-extension"><i class="fa-solid fa-headset"></i> ${agent}</span>
                        <span class="agent-status-badge status-busy">On Call</span>
                    </div>
                    <div class="agent-meta"><i class="fa-solid fa-phone"></i> ${customer} &bull; ${duration}</div>
                </div>
            </div>`;
        }).join('');
    }

    parseCallParties(call) {
        let agent, customer, directionIcon;
        if (this.isAgent(call.caller_number)) {
            agent = this.formatName(call.caller_number);
            customer = this.formatName(call.callee_number);
            directionIcon = "fa-solid fa-arrow-right-from-bracket";
        } else {
            agent = this.formatName(call.callee_number);
            customer = this.formatName(call.caller_number);
            directionIcon = "fa-solid fa-arrow-right-to-bracket";
        }
        return { agent, customer, directionIcon };
    }

    isAgent(number) {
        if (!number) return false;
        if (this.directory[number] && this.directory[number].type === 'agent') return true;
        return /^\d{4}$/.test(number.toString()); 
    }

    formatName(rawNumber) {
        if (!rawNumber) return "Unknown";
        if (this.directory[rawNumber]) return this.directory[rawNumber].name;
        
        let clean = rawNumber.toString();
        if (clean.startsWith('64')) clean = '0' + clean.substring(2);
        if (this.directory[clean]) return this.directory[clean].name;
        
        return this.formatNumber(rawNumber);
    }

    formatNumber(num) {
        if (!num) return "";
        let clean = num.toString();
        if (clean.startsWith('64')) clean = '0' + clean.substring(2);
        return clean;
    }

    calculateDuration(startTimeStr) {
        if (!startTimeStr) return "00:00";
        const start = new Date(startTimeStr).getTime();
        const seconds = Math.floor((Date.now() - start) / 1000);
        if (seconds < 0) return "00:00";
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
}