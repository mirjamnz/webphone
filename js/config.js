/**
 * js/config.js - Final Clean Version
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
        hackIpInContact: false,
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