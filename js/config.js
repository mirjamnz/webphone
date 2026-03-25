/**
 * js/config.js - SIP defaults (Contact: transport=ws).
 */
export const CONFIG = { 
    DEFAULT_DOMAIN: "wss.hero.co.nz",
    DEFAULT_WSS: "wss://wss.hero.co.nz:7443/",
    
    API_BASE_URL: "https://bdl-pbx.itnetworld.co.nz/api",
    SOCKET_IO_URL: "https://bdl-pbx.itnetworld.co.nz",
    
    RECONNECT_INTERVAL: 5000,
    
    SIP_OPTIONS: {
        traceSip: true,
        register: true,
        hackIpInContact: false, // Use .invalid / UUID Contact, not local IP in Contact
        // --- Improve Registration Success Rate ---
        hackAllowUnregisteredOptionTags: true,
        contactParams: { transport: 'ws' },
        // Standard ICE negotiation
        sessionDescriptionHandlerFactoryOptions: {
            peerConnectionConfiguration: {
                iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
            }
        },
        transportOptions: {
            server: "wss://wss.hero.co.nz:7443/",
            keepAliveInterval: 15 // Pings Hero every 15 seconds
        }
    }
};

export default CONFIG;