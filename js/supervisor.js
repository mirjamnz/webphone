/**
 * Supervisor Monitoring Module
 * 
 * Created: 2026-02-12
 * Last Modified: 2026-02-12
 * 
 * Purpose:
 * Provides supervisor features for monitoring agents and listening to active calls.
 * This module enables call monitoring, agent status tracking, and real-time supervision.
 * 
 * Use Cases:
 * - Listen to active calls (whisper, barge, monitor modes)
 * - Monitor agent status and activity
 * - View real-time queue statistics
 * - Access agent performance metrics
 * 
 * Dependencies:
 * - PhoneEngine (for SIP communication)
 * - UserManager (for role verification)
 * - CONFIG (for API URLs)
 */

import { CONFIG } from './config.js';
import * as SIP from 'https://cdn.jsdelivr.net/npm/sip.js@0.21.2/+esm';

export class SupervisorManager {
    constructor(phoneEngine, userManager) {
        this.phone = phoneEngine;
        this.user = userManager;
        this.monitoringSessions = new Map(); // Track active monitoring sessions
        this.agentStatus = new Map(); // Cache agent status
    }

    /**
     * Monitor an active call (listen only, no audio to call)
     * @param {string} agentExtension - Extension of agent to monitor
     * @param {string} callUniqueId - Unique ID of the call
     * @returns {Promise<boolean>} Success status
     */
    async monitorCall(agentExtension, callUniqueId) {
        if (!this.user.canAccess('supervisor_monitor')) {
            throw new Error("Insufficient permissions for monitoring");
        }

        try {
            // Asterisk Monitor: Use ChanSpy or Monitor application
            // Common pattern: *1<extension> or use SIP Subscribe to dialog-info
            const monitorExtension = `*1${agentExtension}`;
            await this.phone.call(monitorExtension);
            
            console.log(`Monitoring call for agent ${agentExtension}`);
            return true;
        } catch (error) {
            console.error("Monitor call failed:", error);
            return false;
        }
    }

    /**
     * Whisper to an active call (supervisor can talk to agent, not caller)
     * @param {string} agentExtension - Extension of agent
     * @returns {Promise<boolean>} Success status
     */
    async whisperToCall(agentExtension) {
        if (!this.user.canAccess('supervisor_listen')) {
            throw new Error("Insufficient permissions for whisper");
        }

        try {
            // Asterisk Whisper: *2<extension>
            const whisperExtension = `*2${agentExtension}`;
            await this.phone.call(whisperExtension);
            
            console.log(`Whispering to agent ${agentExtension}`);
            return true;
        } catch (error) {
            console.error("Whisper failed:", error);
            return false;
        }
    }

    /**
     * Barge into an active call (supervisor joins the conversation)
     * @param {string} agentExtension - Extension of agent
     * @returns {Promise<boolean>} Success status
     */
    async bargeIntoCall(agentExtension) {
        if (!this.user.canAccess('supervisor_listen')) {
            throw new Error("Insufficient permissions for barge");
        }

        try {
            // Asterisk Barge: *3<extension>
            const bargeExtension = `*3${agentExtension}`;
            await this.phone.call(bargeExtension);
            
            console.log(`Barging into call for agent ${agentExtension}`);
            return true;
        } catch (error) {
            console.error("Barge failed:", error);
            return false;
        }
    }

    /**
     * Fetch active calls from API
     * @returns {Promise<Array>} Array of active call objects
     */
    async getActiveCalls() {
        try {
            // TODO: Implement API endpoint: /api/active_calls
            // For now, return mock structure
            const response = await fetch(`${CONFIG.CDR_API_URL}/active_calls`);
            
            if (!response.ok) {
                return [];
            }
            
            const data = await response.json();
            return Array.isArray(data) ? data : [];
        } catch (error) {
            console.error("Error fetching active calls:", error);
            return [];
        }
    }

    /**
     * Get agent status for all agents
     * @returns {Promise<Array>} Array of agent status objects
     */
    async getAgentStatus() {
        try {
            // TODO: Implement API endpoint: /api/agent_status
            // This could use BLF data or a dedicated endpoint
            const response = await fetch(`${CONFIG.CDR_API_URL.replace('/cdr', '')}/ps_endpoints`);
            
            if (!response.ok) {
                return [];
            }
            
            const data = await response.json();
            return Array.isArray(data) ? data : [];
        } catch (error) {
            console.error("Error fetching agent status:", error);
            return [];
        }
    }

    /**
     * Render active calls list for supervisor dashboard
     * @param {string} containerId - DOM element ID
     */
    async renderActiveCalls(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        container.innerHTML = '<div class="loading-spinner"><i class="fa-solid fa-circle-notch fa-spin"></i> Loading...</div>';

        const activeCalls = await this.getActiveCalls();
        container.innerHTML = '';

        if (activeCalls.length === 0) {
            container.innerHTML = '<div class="empty-state">No active calls</div>';
            return;
        }

        activeCalls.forEach(call => {
            const item = document.createElement('div');
            item.className = 'supervisor-call-item';
            item.innerHTML = `
                <div class="call-info">
                    <div class="call-agent">Agent: ${call.agent || call.src}</div>
                    <div class="call-parties">${call.caller} → ${call.called}</div>
                    <div class="call-duration">Duration: ${this.formatDuration(call.duration || 0)}</div>
                </div>
                <div class="call-actions">
                    <button class="btn-icon-only monitor-btn" data-agent="${call.agent || call.src}" title="Monitor">
                        <i class="fa-solid fa-ear-listen"></i>
                    </button>
                    <button class="btn-icon-only whisper-btn" data-agent="${call.agent || call.src}" title="Whisper">
                        <i class="fa-solid fa-comment-dots"></i>
                    </button>
                    <button class="btn-icon-only barge-btn" data-agent="${call.agent || call.src}" title="Barge">
                        <i class="fa-solid fa-phone"></i>
                    </button>
                </div>
            `;

            item.querySelector('.monitor-btn').addEventListener('click', () => {
                this.monitorCall(call.agent || call.src, call.uniqueid);
            });

            item.querySelector('.whisper-btn').addEventListener('click', () => {
                this.whisperToCall(call.agent || call.src);
            });

            item.querySelector('.barge-btn').addEventListener('click', () => {
                this.bargeIntoCall(call.agent || call.src);
            });

            container.appendChild(item);
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

