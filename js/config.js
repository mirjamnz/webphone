export const CONFIG = {
    // Default SIP Domain & WSS Server
    DEFAULT_DOMAIN: "bdl-pbx.itnetworld.co.nz",
    DEFAULT_WSS: "wss://bdl-pbx.itnetworld.co.nz:8089/ws",
    
    // API Configuration (For Call History)
    CDR_API_URL: "https://bdl-pbx.itnetworld.co.nz/api/cdr",
    
    // Retry connection interval (ms)
    RECONNECT_INTERVAL: 5000,

    // Keep-Alive Interval (Seconds)
    // Sends a ping every 30s to keep NAT/Firewall ports open
    KEEP_ALIVE_INTERVAL: 30,
    
    // SIP.js Options
    SIP_OPTIONS: {
        traceSip: true, // Log SIP messages to console for debugging
        register: true
    }
};