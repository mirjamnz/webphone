/**
 * Queue Management Module
 * 
 * Created: 2026-02-12
 * Last Modified: 2026-02-12
 * 
 * Purpose:
 * Handles agent login/logout to Asterisk queues and queue status monitoring.
 * Provides UI and logic for queue membership management.
 * 
 * Use Cases:
 * - Agent login/logout to queues
 * - Monitor queue status (waiting calls, agent count)
 * - Supervisor queue management
 * 
 * Dependencies:
 * - PhoneEngine (for SIP communication)
 * - UserManager (for role checking)
 */

export class QueueManager {
    constructor(phoneEngine, userManager, settings) {
        this.phone = phoneEngine;
        this.user = userManager;
        this.settings = settings;
        this.loggedInQueues = new Set(); // Track which queues agent is logged into
        this.queueStatus = new Map(); // Cache queue status data
    }

    /**
     * Login agent to a queue
     * Uses Asterisk Queue() application via SIP call to special extension
     * @param {string} queueName - Queue identifier (e.g., 'sales', 'support')
     * @returns {Promise<boolean>} Success status
     */
    async loginToQueue(queueName) {
        if (!this.phone.userAgent) {
            throw new Error("Not connected to SIP server");
        }

        if (this.loggedInQueues.has(queueName)) {
            console.log(`Already logged into queue: ${queueName}`);
            return true;
        }

        try {
            // Asterisk Queue Login: Call *60<queue> or use Queue() application
            // Common pattern: *60 + queue number
            const queueExtension = `*60${queueName}`;
            
            // Alternative: Use Queue() application directly via dialplan
            // For now, we'll use a special extension pattern
            await this.phone.call(queueExtension);
            
            // Wait a moment for Asterisk to process
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            this.loggedInQueues.add(queueName);
            this.user.addToQueue(queueName);
            
            console.log(`Logged into queue: ${queueName}`);
            return true;
        } catch (error) {
            console.error(`Queue login failed for ${queueName}:`, error);
            return false;
        }
    }

    /**
     * Logout agent from a queue
     * @param {string} queueName - Queue identifier
     * @returns {Promise<boolean>} Success status
     */
    async logoutFromQueue(queueName) {
        if (!this.loggedInQueues.has(queueName)) {
            console.log(`Not logged into queue: ${queueName}`);
            return true;
        }

        try {
            // Asterisk Queue Logout: Call *61<queue> or use Queue() application
            const queueExtension = `*61${queueName}`;
            await this.phone.call(queueExtension);
            
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            this.loggedInQueues.delete(queueName);
            this.user.removeFromQueue(queueName);
            
            console.log(`Logged out from queue: ${queueName}`);
            return true;
        } catch (error) {
            console.error(`Queue logout failed for ${queueName}:`, error);
            return false;
        }
    }

    /**
     * Toggle login status for a queue
     * @param {string} queueName - Queue identifier
     * @returns {Promise<boolean>} New login status (true = logged in)
     */
    async toggleQueue(queueName) {
        if (this.loggedInQueues.has(queueName)) {
            return await this.logoutFromQueue(queueName);
        } else {
            return await this.loginToQueue(queueName);
        }
    }

    /**
     * Get current queue login status
     * @returns {Array<string>} Array of queue names agent is logged into
     */
    getLoggedInQueues() {
        return Array.from(this.loggedInQueues);
    }

    /**
     * Check if agent is logged into a specific queue
     * @param {string} queueName - Queue identifier
     * @returns {boolean}
     */
    isLoggedIn(queueName) {
        return this.loggedInQueues.has(queueName);
    }

    /**
     * Fetch queue status from API (for supervisors)
     * @param {string} queueName - Queue identifier
     * @returns {Promise<Object>} Queue status data
     */
    async fetchQueueStatus(queueName) {
        // TODO: Implement API call to /api/queue_status?queue=eq.{queueName}
        // For now, return mock data structure
        return {
            name: queueName,
            waiting: 0,
            agents: 0,
            available: 0,
            longestWait: 0
        };
    }

    /**
     * Get all available queues (from API or config)
     * @returns {Promise<Array<string>>} Array of queue names
     */
    async getAvailableQueues() {
        // TODO: Fetch from API: /api/queues
        // For now, return common defaults
        return ['sales', 'support', 'billing'];
    }
}

