/**
 * User Profile & Role Management Module
 * 
 * Created: 2026-02-12
 * Last Modified: 2026-02-12
 * 
 * Purpose:
 * Manages user profiles, roles (agent/supervisor), and role-based feature access.
 * This module provides a foundation for role-based UI rendering and feature gating.
 * 
 * Use Cases:
 * - Detect user role from extension or API
 * - Enable/disable features based on role
 * - Store user preferences and profile data
 * - Support future authentication/authorization
 */

export class UserManager {
    constructor(settings) {
        this.settings = settings;
        this.currentUser = null;
        this.role = 'agent'; // Default: 'agent' | 'supervisor' | 'admin'
        this.profile = this.loadProfile();
    }

    /**
     * Load user profile from localStorage or initialize defaults
     * @returns {Object} User profile object
     */
    loadProfile() {
        const stored = localStorage.getItem('cc_user_profile');
        if (stored) {
            try {
                return JSON.parse(stored);
            } catch (e) {
                console.error("Profile parse error", e);
            }
        }
        
        // Default profile
        return {
            extension: this.settings.get('username') || '',
            role: 'agent',
            name: '',
            email: '',
            queues: [], // Queue memberships
            preferences: {
                theme: 'dark',
                notifications: true,
                autoAnswer: false
            }
        };
    }

    /**
     * Save profile to localStorage
     */
    saveProfile() {
        localStorage.setItem('cc_user_profile', JSON.stringify(this.profile));
    }

    /**
     * Initialize user profile from extension number
     * In a real system, this would fetch from API based on extension
     * @param {string} extension - User extension number
     */
    async initializeFromExtension(extension) {
        if (!extension) return;

        this.profile.extension = extension;
        
        // TODO: In production, fetch from API: /api/extensions?extension=eq.3001
        // For now, use simple heuristics or localStorage
        const roleOverride = localStorage.getItem(`cc_role_${extension}`);
        if (roleOverride) {
            this.profile.role = roleOverride;
        } else {
            // Simple heuristic: extensions 3000-3099 = agents, 4000+ = supervisors
            // This can be overridden via API or settings
            const extNum = parseInt(extension);
            if (extNum >= 4000) {
                this.profile.role = 'supervisor';
            } else {
                this.profile.role = 'agent';
            }
        }

        this.role = this.profile.role;
        this.currentUser = extension;
        this.saveProfile();
        
        console.log(`User initialized: ${extension} as ${this.role}`);
    }

    /**
     * Check if user has a specific role
     * @param {string} requiredRole - Role to check ('agent' | 'supervisor' | 'admin')
     * @returns {boolean}
     */
    hasRole(requiredRole) {
        const roleHierarchy = { 'agent': 1, 'supervisor': 2, 'admin': 3 };
        const userLevel = roleHierarchy[this.role] || 0;
        const requiredLevel = roleHierarchy[requiredRole] || 0;
        return userLevel >= requiredLevel;
    }

    /**
     * Check if a feature is available for current user
     * @param {string} feature - Feature name (e.g., 'supervisor_listen', 'queue_management')
     * @returns {boolean}
     */
    canAccess(feature) {
        const featurePermissions = {
            'supervisor_listen': ['supervisor', 'admin'],
            'supervisor_monitor': ['supervisor', 'admin'],
            'queue_management': ['supervisor', 'admin'],
            'recordings_access': ['supervisor', 'admin'],
            'agent_management': ['admin'],
            'basic_calling': ['agent', 'supervisor', 'admin'],
            'call_history': ['agent', 'supervisor', 'admin']
        };

        const allowedRoles = featurePermissions[feature] || [];
        return allowedRoles.includes(this.role);
    }

    /**
     * Get user display name
     * @returns {string}
     */
    getDisplayName() {
        return this.profile.name || this.profile.extension || 'Unknown';
    }

    /**
     * Update user role (for testing or admin override)
     * @param {string} newRole - New role to assign
     */
    setRole(newRole) {
        if (['agent', 'supervisor', 'admin'].includes(newRole)) {
            this.profile.role = newRole;
            this.role = newRole;
            this.saveProfile();
        }
    }

    /**
     * Get all queues this user is a member of
     * @returns {Array<string>} Array of queue names
     */
    getQueues() {
        return this.profile.queues || [];
    }

    /**
     * Add user to a queue
     * @param {string} queueName - Queue identifier
     */
    addToQueue(queueName) {
        if (!this.profile.queues.includes(queueName)) {
            this.profile.queues.push(queueName);
            this.saveProfile();
        }
    }

    /**
     * Remove user from a queue
     * @param {string} queueName - Queue identifier
     */
    removeFromQueue(queueName) {
        this.profile.queues = this.profile.queues.filter(q => q !== queueName);
        this.saveProfile();
    }
}

