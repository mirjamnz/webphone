# db.md

> **Note:** This is the master reference for the Multi-Tenant Asterisk/WebRTC database schema. All changes to the Postgres schema must be reflected here.

## 1. Core Multi-Tenancy

### `tenants`

Stores the high-level organization data.
| Column | Type | Nullable | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `uuid` | NO | `gen_random_uuid()` | Primary Key / Tenant identifier. |
| `name` | `varchar` | NO | - | Name of the Call Centre / Organization. |
| `created_at` | `timestamp`| NO | `now()` | Record creation time. |

---

## 2. PJSIP Configuration (Realtime)

These tables drive the Asterisk PJSIP stack via Realtime. Every row is isolated by `tenant_id`.

PJSIP Realtime Tables
ps_endpoints: Identity and Codec settings. (Note: Prefer ulaw first for WebRTC-to-Trunk compatibility).

ps_auths: SIP Credentials.

ps_aors: Registration & Keep-Alives.

Stability Tip: Always set qualify_frequency to 20 for WebRTC clients to prevent NAT timeouts.

### `ps_endpoints`

The primary configuration for extensions (WebRTC/SIP).
| Column | Type | Nullable | Description |
| :--- | :--- | :--- | :--- |
| `id` | `varchar` | NO | Extension ID (e.g., 4000). |
| `transport` | `varchar` | YES | Reference to WSS/UDP transport. |
| `aors` | `varchar` | YES | Link to `ps_aors`. |
| `auth` | `varchar` | YES | Link to `ps_auths`. |
| `context` | `varchar` | YES | Dialplan entry point. |
| `webrtc` | `varchar` | YES | Must be `yes` for browser clients. |
| `tenant_id` | `uuid` | YES | Multi-tenant isolation key. |

### `ps_auths`

Security and credentials.
| Column | Type | Nullable | Description |
| :--- | :--- | :--- | :--- |
| `id` | `varchar` | NO | Auth ID (usually matches extension). |
| `password` | `varchar` | YES | SIP password. |
| `username` | `varchar` | YES | SIP username. |
| `tenant_id` | `uuid` | YES | Multi-tenant isolation key. |

### `ps_registrations`

Used for outbound registration (if this tenant connects to an external SIP trunk).
| Column | Type | Nullable | Default |
| :--- | :--- | :--- | :--- |
| `transport` | `varchar` | YES | - |
| `support_path` | `varchar` | YES | `'no'` |
| `endpoint` | `varchar` | YES | - |
| `tenant_id` | `uuid` | YES | - |

---

## 3. Dialplan and Logs

### `extensions`

The logic governing what happens when a number is dialed.
| Column | Type | Nullable | Description |
| :--- | :--- | :--- | :--- |
| `id` | `serial` | NO | Primary Key. |
| `context` | `varchar` | NO | Context name (per tenant). |
| `exten` | `varchar` | NO | Dialed pattern (e.g., _55XXX). |
| `app` | `varchar` | NO | Asterisk App (Dial, ChanSpy, etc.). |
| `tenant_id` | `uuid` | YES | Multi-tenant isolation key. |

---

AMI Service: Node.js based event bridge connecting Asterisk (Port 5038) to Web Clients (Port 3000/443).

Socket.io Rooms: Real-time event isolation. Every supervisor joins a room named after their tenant_id to receive filtered updates.


### Maintaining this Document

To keep the project modular and readable:

1. **Migrations:** When adding a column (e.g., adding `agent_role` to a users table), update your Alembic script first, then update this file.
2. **Naming Convention:** Always use `tenant_id` as the foreign key name across all tables to maintain query consistency.

**Now that the supervisor is logged in and the docs are ready, would you like to implement the `ChanSpy` dialplan entries so they can actually listen to the agents?**


### 13yh Febr 2026 Added >>>

Tenant Isolation: Extensions are segmented by UUID in the database and by context in the dialplan.

Dynamic Dialplan: All routing logic (Dial, ChanSpy, Echo) is now in the extensions table.

WebRTC Optimization: Codecs are prioritized (ulaw first) to avoid transcoding crashes while maintaining browser compatibility.

The Switch: extensions.conf is now a robust "Router" using switch => Realtime.