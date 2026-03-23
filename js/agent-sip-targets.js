/**
 * agent-sip-targets.js
 *
 * Maps a supervisor directory agent row to two SIP user strings: one for BLF/presence (SUBSCRIBE)
 * and one for click-to-call (INVITE). Hero often registers WebRTC as a long numeric login while
 * the PBX still routes calls by short extension.
 *
 * Use case: SUBSCRIBE sip:801061400038@domain (registered) vs INVITE sip:7320@domain (routable).
 *
 * Last modified: 2026-03-24 — subscriberStatusProbeIds for Hero API key matching.
 */

/** NZ Hero WebRTC logins are typically 11+ digit numeric strings. */
const FULL_LOGIN_MIN_DIGITS = 11;

function looksLikeFullLogin(s) {
    return typeof s === 'string' && /^\d+$/.test(s) && s.length >= FULL_LOGIN_MIN_DIGITS;
}

/**
 * @param {string} mapKey - Object key from /api/live-status directory
 * @param {{ type?: string, extension?: string|null, shortNumber?: string|null }} data
 * @returns {{ presenceUser: string, dialUser: string }}
 */
export function resolveAgentSipTargets(mapKey, data) {
    if (!data || data.type !== 'agent') {
        return { presenceUser: '', dialUser: '' };
    }
    const key = String(mapKey == null ? '' : mapKey).trim();
    const ext = data.extension != null ? String(data.extension).trim() : '';
    const short = data.shortNumber != null ? String(data.shortNumber).trim() : '';

    const candidates = [ext, key].filter(Boolean);
    let presenceUser = candidates.find(looksLikeFullLogin) || '';
    if (!presenceUser) presenceUser = ext || key;

    const dialUser = short || key || ext;

    return { presenceUser, dialUser };
}

/**
 * Every directory identifier that might appear as a key in Hero Get-Subscriber-Status `Data`.
 * Use case: API keys are often 8010614000xx or 09… CLI while `data-sip-login` may still be a short ext until phonebook is complete.
 *
 * @param {string} mapKey
 * @param {{ type?: string, extension?: string|null, shortNumber?: string|null, authLogin?: string|null, callerId?: string|null }} data
 * @returns {string[]}
 */
export function subscriberStatusProbeIds(mapKey, data) {
    if (!data || data.type !== 'agent') return [];
    const key = String(mapKey == null ? '' : mapKey).trim();
    const ext = data.extension != null ? String(data.extension).trim() : '';
    const short = data.shortNumber != null ? String(data.shortNumber).trim() : '';
    const authLogin = data.authLogin != null ? String(data.authLogin).trim() : '';
    const callerId = data.callerId != null ? String(data.callerId).trim() : '';
    const { presenceUser, dialUser } = resolveAgentSipTargets(mapKey, data);

    const seen = new Set();
    const out = [];
    for (const s of [presenceUser, dialUser, key, ext, short, authLogin, callerId]) {
        if (!s || seen.has(s)) continue;
        seen.add(s);
        out.push(s);
    }
    return out;
}
