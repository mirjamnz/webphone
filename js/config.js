/**
 * WebRTC Call Center - Client Configuration
 * Supports both named exports (for history.js) and default exports (for supervisor.js)
 */

export const CONFIG = { 
    // Default SIP Domain & WSS Server (Secure)
    DEFAULT_DOMAIN: "bdl-pbx.itnetworld.co.nz",
    DEFAULT_WSS: "wss://bdl-pbx.itnetworld.co.nz:8089/ws",
    
    // API Configuration (For Call History/CDR)
    CDR_API_URL: "https://bdl-pbx.itnetworld.co.nz/api/cdr",
    API_BASE_URL: "https://bdl-pbx.itnetworld.co.nz/api",

    // Socket.io Configuration (For AMI Watcher)
    // Points to your Nginx proxy which handles SSL for the watcher
    SOCKET_IO_URL: "https://bdl-pbx.itnetworld.co.nz",
    
    // This MUST match your database tenant_id exactly (Uppercase)
    DEFAULT_TENANT_ID: "28B0D0E2-0A39-48C0-84F9-D340472273A9",

    // Retry connection interval (ms)
    RECONNECT_INTERVAL: 5000,

    // Keep-Alive Interval (Seconds)
    // Sends a ping every 30s to keep NAT/Firewall ports open
    KEEP_ALIVE_INTERVAL: 30,
    
    // SIP.js Options
    SIP_OPTIONS: {
        traceSip: true, // Log SIP messages to console for debugging
        register: true
    },

    // UI/Debug settings
    DEBUG_MODE: true
};

// Also provide a default export to maintain compatibility with other modules
export default CONFIG;