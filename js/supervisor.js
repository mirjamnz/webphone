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
 * - Socket.io client (for real-time AMI events)
 */

import { CONFIG } from './config.js';
import * as SIP from 'https://cdn.jsdelivr.net/npm/sip.js@0.21.2/+esm';

export class SupervisorManager {
    constructor(phoneEngine, userManager) {
        this.phone = phoneEngine;
        this.user = userManager;
        this.monitoringSessions = new Map(); // Track active monitoring sessions
        this.agentStatus = new Map(); // Cache agent status
        this.socket = null; // Socket.io connection
        this.activeCalls = []; // Real-time active calls from AMI
        this.queues = []; // Real-time queue statistics
        this.connected = false; // Track connection status
        
        // Note: Socket.io connection will be initiated after user role is determined
        // Call initialize() after userManager.initializeFromExtension()
    }

    /**
     * Initialize Socket.io connection (call this after user role is determined)
     */
    initialize() {
        // Check if already connected
        if (this.connected || this.socket?.connected) {
            return;
        }

        // Initialize Socket.io connection if supervisor
        if (this.user.canAccess('supervisor_monitor')) {
            console.log('🔌 Initializing Socket.io connection for supervisor...');
            this.connectSocketIO();
        } else {
            console.log('ℹ️  User does not have supervisor permissions, skipping Socket.io connection');
        }
    }

    /**
     * Connect to Socket.io server for real-time AMI events
     */
    connectSocketIO() {
        // Check if Socket.io client is loaded
        if (typeof io === 'undefined') {
            console.error('❌ Socket.io client not loaded!');
            console.warn('💡 Make sure <script src="https://cdn.socket.io/4.7.2/socket.io.min.js"></script> is in index.html');
            return;
        }

        const socketUrl = CONFIG.SOCKET_IO_URL || 'http://localhost:3001';
        console.log(`🔌 Attempting to connect to AMI Watcher at ${socketUrl}...`);
        
        this.socket = io(socketUrl, {
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionDelay: 1000,
            reconnectionAttempts: 5,
            timeout: 5000
        });

        this.socket.on('connect', () => {
            this.connected = true;
            console.log('✅ Connected to AMI Watcher service');
        });

        this.socket.on('disconnect', () => {
            this.connected = false;
            console.warn('⚠️  Disconnected from AMI Watcher service');
        });

        this.socket.on('connect_error', (error) => {
            console.error('❌ Socket.io connection error:', error.message);
            console.log('💡 Make sure the AMI Watcher service is running on', socketUrl);
        });

        this.socket.on('ami:connected', () => {
            console.log('✅ AMI connected to Asterisk');
        });

        this.socket.on('ami:disconnected', () => {
            console.warn('⚠️  AMI disconnected from Asterisk');
        });

        // Receive active calls
        this.socket.on('calls:active', (calls) => {
            this.activeCalls = calls;
            this.onActiveCallsUpdate?.(calls);
        });

        // Receive agent status
        this.socket.on('agents:status', (agents) => {
            agents.forEach(agent => {
                this.agentStatus.set(agent.extension, agent);
            });
            this.onAgentStatusUpdate?.(agents);
        });

        // Receive queue statistics
        this.socket.on('queues:stats', (queues) => {
            this.queues = queues;
            this.onQueueStatsUpdate?.(queues);
        });

        // Supervisor action responses
        this.socket.on('supervisor:success', (data) => {
            console.log(`Supervisor ${data.action} successful for ${data.agentExtension}`);
            this.onSupervisorActionSuccess?.(data);
        });

        this.socket.on('supervisor:error', (data) => {
            console.error(`Supervisor ${data.action} failed:`, data.error);
            this.onSupervisorActionError?.(data);
        });
    }

    /**
     * Callback setters for UI updates
     */
    setOnActiveCallsUpdate(callback) {
        this.onActiveCallsUpdate = callback;
    }

    setOnAgentStatusUpdate(callback) {
        this.onAgentStatusUpdate = callback;
    }

    setOnQueueStatsUpdate(callback) {
        this.onQueueStatsUpdate = callback;
    }

    setOnSupervisorActionSuccess(callback) {
        this.onSupervisorActionSuccess = callback;
    }

    setOnSupervisorActionError(callback) {
        this.onSupervisorActionError = callback;
    }

    /**
     * Monitor an active call (listen only, no audio to call)
     * Uses Socket.io to send AMI command
     * @param {string} agentExtension - Extension of agent to monitor
     * @param {string} callUniqueId - Unique ID of the call (optional)
     * @returns {Promise<boolean>} Success status
     */
    async monitorCall(agentExtension, callUniqueId = null) {
        if (!this.user.canAccess('supervisor_monitor')) {
            throw new Error("Insufficient permissions for monitoring");
        }

        if (!this.socket || !this.socket.connected) {
            throw new Error("Not connected to AMI Watcher service");
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error("Monitor request timed out"));
            }, 10000);

            const successHandler = (data) => {
                if (data.agentExtension === agentExtension && data.action === 'monitor') {
                    clearTimeout(timeout);
                    this.socket.off('supervisor:success', successHandler);
                    this.socket.off('supervisor:error', errorHandler);
                    resolve(true);
                }
            };

            const errorHandler = (data) => {
                if (data.agentExtension === agentExtension && data.action === 'monitor') {
                    clearTimeout(timeout);
                    this.socket.off('supervisor:success', successHandler);
                    this.socket.off('supervisor:error', errorHandler);
                    reject(new Error(data.error || "Monitor failed"));
                }
            };

            this.socket.once('supervisor:success', successHandler);
            this.socket.once('supervisor:error', errorHandler);

            try {
                // Get supervisor extension from user manager
                const supervisorExtension = this.user.profile?.extension || this.user.currentUser || this.user.settings?.get('username');
                if (!supervisorExtension) {
                    throw new Error("Supervisor extension not found");
                }
                this.socket.emit('supervisor:monitor', {
                    agentExtension,
                    callUniqueId,
                    supervisorExtension
                });
            } catch (error) {
                clearTimeout(timeout);
                this.socket.off('supervisor:success', successHandler);
                this.socket.off('supervisor:error', errorHandler);
                reject(error);
            }
        });
    }

    /**
     * Whisper to an active call (supervisor can talk to agent, not caller)
     * Uses Socket.io to send AMI command
     * @param {string} agentExtension - Extension of agent
     * @returns {Promise<boolean>} Success status
     */
    async whisperToCall(agentExtension) {
        if (!this.user.canAccess('supervisor_listen')) {
            throw new Error("Insufficient permissions for whisper");
        }

        if (!this.socket || !this.socket.connected) {
            throw new Error("Not connected to AMI Watcher service");
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error("Whisper request timed out"));
            }, 10000);

            const successHandler = (data) => {
                if (data.agentExtension === agentExtension && data.action === 'whisper') {
                    clearTimeout(timeout);
                    this.socket.off('supervisor:success', successHandler);
                    this.socket.off('supervisor:error', errorHandler);
                    resolve(true);
                }
            };

            const errorHandler = (data) => {
                if (data.agentExtension === agentExtension && data.action === 'whisper') {
                    clearTimeout(timeout);
                    this.socket.off('supervisor:success', successHandler);
                    this.socket.off('supervisor:error', errorHandler);
                    reject(new Error(data.error || "Whisper failed"));
                }
            };

            this.socket.once('supervisor:success', successHandler);
            this.socket.once('supervisor:error', errorHandler);

            try {
                // Get supervisor extension from user manager
                const supervisorExtension = this.user.profile?.extension || this.user.currentUser || this.user.settings?.get('username');
                if (!supervisorExtension) {
                    throw new Error("Supervisor extension not found");
                }
                this.socket.emit('supervisor:whisper', {
                    agentExtension,
                    supervisorExtension
                });
            } catch (error) {
                clearTimeout(timeout);
                this.socket.off('supervisor:success', successHandler);
                this.socket.off('supervisor:error', errorHandler);
                reject(error);
            }
        });
    }

    /**
     * Barge into an active call (supervisor joins the conversation)
     * Uses Socket.io to send AMI command
     * @param {string} agentExtension - Extension of agent
     * @returns {Promise<boolean>} Success status
     */
    async bargeIntoCall(agentExtension) {
        if (!this.user.canAccess('supervisor_listen')) {
            throw new Error("Insufficient permissions for barge");
        }

        if (!this.socket || !this.socket.connected) {
            throw new Error("Not connected to AMI Watcher service");
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error("Barge request timed out"));
            }, 10000);

            const successHandler = (data) => {
                if (data.agentExtension === agentExtension && data.action === 'barge') {
                    clearTimeout(timeout);
                    this.socket.off('supervisor:success', successHandler);
                    this.socket.off('supervisor:error', errorHandler);
                    resolve(true);
                }
            };

            const errorHandler = (data) => {
                if (data.agentExtension === agentExtension && data.action === 'barge') {
                    clearTimeout(timeout);
                    this.socket.off('supervisor:success', successHandler);
                    this.socket.off('supervisor:error', errorHandler);
                    reject(new Error(data.error || "Barge failed"));
                }
            };

            this.socket.once('supervisor:success', successHandler);
            this.socket.once('supervisor:error', errorHandler);

            try {
                // Get supervisor extension from user manager
                const supervisorExtension = this.user.profile?.extension || this.user.currentUser || this.user.settings?.get('username');
                if (!supervisorExtension) {
                    throw new Error("Supervisor extension not found");
                }
                this.socket.emit('supervisor:barge', {
                    agentExtension,
                    supervisorExtension
                });
            } catch (error) {
                clearTimeout(timeout);
                this.socket.off('supervisor:success', successHandler);
                this.socket.off('supervisor:error', errorHandler);
                reject(error);
            }
        });
    }

    /**
     * Get active calls (from real-time Socket.io data)
     * @returns {Array} Array of active call objects
     */
    getActiveCalls() {
        return this.activeCalls;
    }

    /**
     * Get agent status for all agents (from real-time Socket.io data)
     * @returns {Array} Array of agent status objects
     */
    getAgentStatus() {
        return Array.from(this.agentStatus.values());
    }

    /**
     * Get queue statistics (from real-time Socket.io data)
     * @returns {Array} Array of queue statistics objects
     */
    getQueueStats() {
        return this.queues;
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

