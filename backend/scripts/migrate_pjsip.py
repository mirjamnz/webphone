import configparser
import psycopg2
import os
from dotenv import load_dotenv

# 1. Setup & Config
load_dotenv(os.path.join(os.path.dirname(__file__), '../.env'))
PJSIP_FILE = os.path.expanduser('~/Documents/pjsip_backup.conf')

# Get Tenant ID from DB (The one we created earlier)
DB_CONFIG = {
    "host": "127.0.0.1", 
    "database": "asteriskdb",
    "user": "postgres",
    "password": os.getenv("POSTGRES_PASSWORD")
}

# The settings from your [webrtc_agent] template
WEBRTC_DEFAULTS = {
    "context": "from-internal",
    "disallow": "all",
    "allow": "alaw,ulaw,opus,vp8,h264",
    "webrtc": "yes",
    "dtls_auto_generate_cert": "yes",
    "direct_media": "no"
}

def migrate():
    config = configparser.ConfigParser(strict=False)
    config.read(PJSIP_FILE)

    conn = psycopg2.connect(**DB_CONFIG)
    cur = conn.cursor()

    # Get the Tenant ID for 'BDL PBX Solutions'
    cur.execute("SELECT id FROM tenants WHERE name = 'BDL PBX Solutions' LIMIT 1;")
    tenant_id = cur.fetchone()[0]
    print(f"📦 Found Tenant ID: {tenant_id}")

    # Process Sections
    for section in config.sections():
        # --- Handle Auths ---
        if section.endswith('_auth') and config.has_option(section, 'password'):
            print(f"🔐 Importing Auth: {section}")
            cur.execute("""
                INSERT INTO ps_auths (id, auth_type, password, username, tenant_id)
                VALUES (%s, %s, %s, %s, %s) ON CONFLICT (id) DO NOTHING;
            """, (section, 'userpass', config.get(section, 'password'), config.get(section, 'username'), tenant_id))

        # --- Handle AORs ---
        elif section.isdigit(): # Matches '3001', '3002', etc.
            if config.get(section, 'type', fallback='') == 'aor':
                print(f"📞 Importing AOR: {section}")
                cur.execute("""
                    INSERT INTO ps_aors (id, max_contacts, remove_existing, tenant_id)
                    VALUES (%s, %s, %s, %s) ON CONFLICT (id) DO NOTHING;
                """, (section, config.get(section, 'max_contacts'), 'yes', tenant_id))

        # --- Handle Endpoints (The Agents) ---
        if '(webrtc_agent)' in section or section.isdigit():
            clean_id = section.replace('(webrtc_agent)', '')
            if config.has_option(section, 'auth'):
                print(f"👤 Importing Endpoint: {clean_id}")
                cur.execute("""
                    INSERT INTO ps_endpoints 
                    (id, transport, aors, auth, context, disallow, allow, webrtc, dtls_auto_generate_cert, direct_media, tenant_id)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (id) DO NOTHING;
                """, (
                    clean_id, 
                    'transport-ws', 
                    config.get(section, 'aors'),
                    config.get(section, 'auth'),
                    WEBRTC_DEFAULTS['context'],
                    WEBRTC_DEFAULTS['disallow'],
                    WEBRTC_DEFAULTS['allow'],
                    WEBRTC_DEFAULTS['webrtc'],
                    WEBRTC_DEFAULTS['dtls_auto_generate_cert'],
                    WEBRTC_DEFAULTS['direct_media'],
                    tenant_id
                ))

    conn.commit()
    cur.close()
    conn.close()
    print("\n🚀 Migration Complete!")

if __name__ == "__main__":
    migrate()
