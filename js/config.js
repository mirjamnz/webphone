export const CONFIG = {
    // Default SIP Domain & WSS Server
    DEFAULT_DOMAIN: "bdl-pbx.itnetworld.co.nz",
    DEFAULT_WSS: "wss://bdl-pbx.itnetworld.co.nz:8089/ws",
    
    // Retry connection interval (ms)
    RECONNECT_INTERVAL: 5000,
    
    // SIP.js Options
    SIP_OPTIONS: {
        traceSip: true, // Log SIP messages to console for debugging
        register: true
    }
};