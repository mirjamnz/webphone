import os
import psycopg2
from dotenv import load_dotenv

# Load secrets from .env
load_dotenv(os.path.join(os.path.dirname(__file__), '../.env'))

# Connection config (connect as Root to create users)
DB_HOST = os.getenv("DB_HOST", "127.0.0.1")
DB_NAME = os.getenv("DB_NAME", "asteriskdb")
ROOT_USER = os.getenv("POSTGRES_USER")
ROOT_PASS = os.getenv("POSTGRES_PASSWORD")

# Users to create
ASTERISK_USER = os.getenv("ASTERISK_USER", "asterisk")
ASTERISK_PASS = os.getenv("ASTERISK_PASS", "secure_password_for_pbx")
API_USER = os.getenv("API_USER", "web_anon")

def create_roles():
    try:
        conn = psycopg2.connect(
            host=DB_HOST,
            database=DB_NAME,
            user=ROOT_USER,
            password=ROOT_PASS
        )
        conn.autocommit = True
        cur = conn.cursor()

        print("--- Checking Database Roles ---")

        # 1. Create Asterisk User (The PBX)
        # It needs BypassRLS to see all tenants (so it can route calls between them)
        try:
            cur.execute(f"CREATE ROLE {ASTERISK_USER} WITH LOGIN PASSWORD '{ASTERISK_PASS}' NOINHERIT;")
            print(f"✅ Created role: {ASTERISK_USER}")
        except psycopg2.errors.DuplicateObject:
            print(f"ℹ️  Role {ASTERISK_USER} already exists.")
        
        # Grant Super-powers to Asterisk (It needs to read/write everything)
        cur.execute(f"ALTER ROLE {ASTERISK_USER} BYPASSRLS;")
        cur.execute(f"GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO {ASTERISK_USER};")
        cur.execute(f"GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO {ASTERISK_USER};")

        # 2. Create API User (The Web Interface)
        # This is a 'Nologin' role that PostgREST switches into.
        try:
            cur.execute(f"CREATE ROLE {API_USER} nologin;")
            print(f"✅ Created role: {API_USER}")
        except psycopg2.errors.DuplicateObject:
            print(f"ℹ️  Role {API_USER} already exists.")

        # Grant Read/Write to API User (But RLS will restrict what rows it sees)
        cur.execute(f"GRANT USAGE ON SCHEMA public TO {API_USER};")
        cur.execute(f"GRANT ALL ON ALL TABLES IN SCHEMA public TO {API_USER};")
        cur.execute(f"GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO {API_USER};")
        
        # 3. Create Authenticator Role (How PostgREST connects)
        # This user IS allowed to login
        AUTH_USER = "authenticator"
        AUTH_PASS = "api_password_super_secure" # In production, put this in .env too
        try:
            cur.execute(f"CREATE ROLE {AUTH_USER} WITH LOGIN PASSWORD '{AUTH_PASS}' NOINHERIT;")
            cur.execute(f"GRANT {API_USER} TO {AUTH_USER};")
            print(f"✅ Created role: {AUTH_USER}")
        except psycopg2.errors.DuplicateObject:
            print(f"ℹ️  Role {AUTH_USER} already exists.")

        print("\n🎉 Roles initialized successfully!")

    except Exception as e:
        print(f"\n❌ Error: {e}")
    finally:
        if conn: conn.close()

if __name__ == "__main__":
    create_roles()