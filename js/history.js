import { CONFIG } from './config.js';

export class HistoryManager {
    constructor(settings, callbacks) {
        this.settings = settings;
        this.callbacks = callbacks; 
        this.lastDialedNumber = localStorage.getItem('cc_last_dialed');
    }

    async fetchHistory() {
        const currentExt = this.settings.get('username');
        if (!currentExt) return { error: "No Extension Configured" };

        try {
            // PostgREST Syntax:
            // 1. Filter: (src == currentExt) OR (dst == currentExt)
            // 2. Order: start_time descending (newest first)
            // 3. Limit: 50 records max
            const queryParams = `?or=(src.eq.${currentExt},dst.eq.${currentExt})&order=start_time.desc&limit=50`;
            
            console.log(`Fetching history: ${CONFIG.CDR_API_URL}${queryParams}`);
            
            const response = await fetch(`${CONFIG.CDR_API_URL}${queryParams}`);
            
            if (!response.ok) {
                // Return detailed error if API fails (like 400 Bad Request)
                const errText = await response.text();
                console.error("API Error Body:", errText);
                return { error: `Server Error: ${response.status}` };
            }
            
            let rawData = await response.json();

            // 1. Handle if API returns { "data": [...] } wrapper (common in some setups)
            if (rawData.data && Array.isArray(rawData.data)) {
                rawData = rawData.data;
            }

            // 2. Validate it is an Array
            if (!Array.isArray(rawData)) {
                console.error("Data is not an array:", rawData);
                return { error: "Invalid Data Format" };
            }
            
            // 3. Map Data
            const mapped = rawData.map(record => {
                // normalize fields
                const src = record.src || record.source || record.clid || "";
                const dst = record.dst || record.destination || "";
                
                // Use start_time, fallback to calldate, fallback to NOW
                // Note: PostgREST usually returns ISO strings which new Date() handles well
                const timeRaw = record.start_time || record.calldate || new Date();
                
                // If I am the Source, I called the Destination (Outbound)
                // If I am NOT the Source, someone called me (Inbound)
                const isOutbound = (src == currentExt); 

                return {
                    direction: isOutbound ? 'outbound' : 'inbound',
                    number: isOutbound ? dst : src,
                    date: new Date(timeRaw),
                    duration: parseInt(record.duration || 0, 10),
                    status: record.disposition || "UNKNOWN"
                };
            });

            return mapped;

        } catch (error) {
            console.error("History Fetch Error:", error);
            if (error.name === 'TypeError' && error.message.includes('fetch')) {
                return { error: "Connection Failed (CORS/Network)" };
            }
            return { error: error.message };
        }
    }

    async render(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        // --- 1. Update Redial Button Text ---
        this.lastDialedNumber = localStorage.getItem('cc_last_dialed'); 
        const btnRedialLabel = document.getElementById('redialLabel');
        if (btnRedialLabel) {
            btnRedialLabel.innerText = this.lastDialedNumber 
                ? `Redial ${this.lastDialedNumber}` 
                : "Redial Last Number";
        }

        // --- 2. Show Loading ---
        container.innerHTML = '<div class="loading-spinner"><i class="fa-solid fa-circle-notch fa-spin"></i> Loading...</div>';

        // --- 3. Fetch ---
        const history = await this.fetchHistory();
        container.innerHTML = '';

        // --- 4. Handle Errors & Empty States ---
        if (history.error) {
            container.innerHTML = `
                <div class="empty-state" style="color: var(--danger)">
                    <i class="fa-solid fa-triangle-exclamation"></i><br>
                    ${history.error}
                </div>`;
            return;
        }

        if (history.length === 0) {
            container.innerHTML = '<div class="empty-state">No call records found.</div>';
            return;
        }

        // --- 5. Render Rows ---
        history.forEach(call => {
            const row = document.createElement('div');
            row.className = 'history-row';
            
            let iconClass = 'fa-arrow-turn-up';
            let iconColor = 'var(--text-muted)';
            
            if (call.direction === 'inbound') {
                if (call.status === 'ANSWERED') {
                    iconClass = 'fa-arrow-turn-down';
                    iconColor = 'var(--success)';
                } else {
                    iconClass = 'fa-arrow-turn-down'; // Missed
                    iconColor = 'var(--danger)';
                }
            } else {
                iconClass = 'fa-arrow-turn-up';
                iconColor = 'var(--primary)';
            }

            row.innerHTML = `
                <div class="hist-icon" style="color: ${iconColor}">
                    <i class="fa-solid ${iconClass}"></i>
                </div>
                <div class="hist-info">
                    <div class="hist-number">${call.number}</div>
                    <div class="hist-meta">${this.formatDate(call.date)} • ${this.formatDuration(call.duration)}</div>
                </div>
                <button class="btn-icon-only" title="Call ${call.number}">
                    <i class="fa-solid fa-phone"></i>
                </button>
            `;

            row.querySelector('button').onclick = () => {
                this.callbacks.onRedial(call.number);
            };

            container.appendChild(row);
        });
    }

    saveLastDialed(number) {
        this.lastDialedNumber = number;
        localStorage.setItem('cc_last_dialed', number);
    }

    getLastDialed() {
        return this.lastDialedNumber || localStorage.getItem('cc_last_dialed');
    }

    formatDate(dateObj) {
        if (isNaN(dateObj.getTime())) return "Unknown";
        return dateObj.toLocaleString('en-NZ', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    }

    formatDuration(seconds) {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m}:${s.toString().padStart(2, '0')}`;
    }
}