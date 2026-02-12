/**
 * Call Recordings Module
 * 
 * Created: 2026-02-12
 * Last Modified: 2026-02-12
 * 
 * Purpose:
 * Handles fetching, listing, and playing call recordings from the Asterisk server.
 * Provides UI for supervisors and agents to access recorded calls.
 * 
 * Use Cases:
 * - List recordings for a specific call (CDR)
 * - Play recordings in browser
 * - Download recordings
 * - Filter recordings by date, extension, etc.
 * 
 * Dependencies:
 * - CONFIG (for API URLs)
 * - UserManager (for role checking)
 */

import { CONFIG } from './config.js';

export class RecordingsManager {
    constructor(userManager) {
        this.user = userManager;
        this.recordingsCache = new Map();
    }

    /**
     * Fetch recordings for a specific call (by CDR uniqueid)
     * @param {string} uniqueid - CDR uniqueid
     * @returns {Promise<Array>} Array of recording objects
     */
    async getRecordingsForCall(uniqueid) {
        try {
            // TODO: Implement API endpoint: /api/recordings?uniqueid=eq.{uniqueid}
            // For now, return mock structure
            // In production, this would fetch from your recordings storage
            const response = await fetch(`${CONFIG.CDR_API_URL}/recordings?uniqueid=eq.${uniqueid}`);
            
            if (!response.ok) {
                return [];
            }
            
            const data = await response.json();
            return Array.isArray(data) ? data : [];
        } catch (error) {
            console.error("Error fetching recordings:", error);
            return [];
        }
    }

    /**
     * Fetch all recordings for current user (filtered by extension)
     * @param {Object} filters - Optional filters (dateFrom, dateTo, extension)
     * @returns {Promise<Array>} Array of recording objects
     */
    async getAllRecordings(filters = {}) {
        try {
            const extension = this.user.profile.extension;
            if (!extension) return [];

            // Build query parameters
            let queryParams = `?src=eq.${extension}`;
            if (filters.dateFrom) {
                queryParams += `&start_time=gte.${filters.dateFrom}`;
            }
            if (filters.dateTo) {
                queryParams += `&start_time=lte.${filters.dateTo}`;
            }
            queryParams += `&order=start_time.desc&limit=100`;

            // TODO: Implement API endpoint: /api/recordings
            const response = await fetch(`${CONFIG.CDR_API_URL}/recordings${queryParams}`);
            
            if (!response.ok) {
                return [];
            }
            
            const data = await response.json();
            return Array.isArray(data) ? data : [];
        } catch (error) {
            console.error("Error fetching recordings:", error);
            return [];
        }
    }

    /**
     * Get recording URL for playback
     * @param {string} recordingId - Recording identifier
     * @returns {string} URL to recording file
     */
    getRecordingUrl(recordingId) {
        // Construct URL based on your server setup
        // Common patterns:
        // - /recordings/{recordingId}.wav
        // - /api/recordings/{recordingId}/stream
        return `${CONFIG.CDR_API_URL.replace('/cdr', '')}/recordings/${recordingId}`;
    }

    /**
     * Render recordings list in a container
     * @param {string} containerId - DOM element ID
     * @param {Array} recordings - Array of recording objects
     */
    renderRecordings(containerId, recordings) {
        const container = document.getElementById(containerId);
        if (!container) return;

        if (recordings.length === 0) {
            container.innerHTML = '<div class="empty-state">No recordings found.</div>';
            return;
        }

        container.innerHTML = '';
        
        recordings.forEach(recording => {
            const item = document.createElement('div');
            item.className = 'recording-item';
            item.innerHTML = `
                <div class="recording-info">
                    <div class="recording-title">
                        <i class="fa-solid fa-microphone"></i> 
                        ${recording.caller || recording.src} → ${recording.called || recording.dst}
                    </div>
                    <div class="recording-meta">
                        ${this.formatDate(recording.start_time || recording.date)} • 
                        ${this.formatDuration(recording.duration || 0)}
                    </div>
                </div>
                <div class="recording-actions">
                    <button class="btn-icon-only play-recording" data-recording-id="${recording.id}" title="Play">
                        <i class="fa-solid fa-play"></i>
                    </button>
                    <button class="btn-icon-only download-recording" data-recording-id="${recording.id}" title="Download">
                        <i class="fa-solid fa-download"></i>
                    </button>
                </div>
            `;

            // Play button
            item.querySelector('.play-recording').addEventListener('click', () => {
                this.playRecording(recording.id);
            });

            // Download button
            item.querySelector('.download-recording').addEventListener('click', () => {
                this.downloadRecording(recording.id);
            });

            container.appendChild(item);
        });
    }

    /**
     * Play a recording in browser
     * @param {string} recordingId - Recording identifier
     */
    playRecording(recordingId) {
        const url = this.getRecordingUrl(recordingId);
        const audio = new Audio(url);
        audio.play().catch(e => {
            console.error("Playback error:", e);
            alert("Unable to play recording. Please try downloading instead.");
        });
    }

    /**
     * Download a recording
     * @param {string} recordingId - Recording identifier
     */
    downloadRecording(recordingId) {
        const url = this.getRecordingUrl(recordingId);
        const link = document.createElement('a');
        link.href = url;
        link.download = `recording_${recordingId}.wav`;
        link.click();
    }

    /**
     * Format date for display
     * @param {Date|string} date - Date object or ISO string
     * @returns {string} Formatted date string
     */
    formatDate(date) {
        if (!date) return "Unknown";
        const d = new Date(date);
        if (isNaN(d.getTime())) return "Unknown";
        return d.toLocaleString('en-NZ', { 
            month: 'short', 
            day: 'numeric', 
            hour: '2-digit', 
            minute: '2-digit' 
        });
    }

    /**
     * Format duration for display
     * @param {number} seconds - Duration in seconds
     * @returns {string} Formatted duration (MM:SS)
     */
    formatDuration(seconds) {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m}:${s.toString().padStart(2, '0')}`;
    }
}

