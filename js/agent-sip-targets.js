/**
 * agent-sip-targets.js
 *
 * Maps a supervisor directory agent row to two SIP user strings: one for BLF/presence (SUBSCRIBE)
 * and one for click-to-call (INVITE). Hero often registers WebRTC as a long numeric login while
 * the PBX still routes calls by short extension.
 *
 * Use case: SUBSCRIBE sip:801061400038@domain (registered) vs INVITE sip:7320@domain (routable).
 *
 * Last modified: 2026-03-24
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
