"""init_asterisk_schema

Revision ID: df1ba9905c26
Revises: 
Create Date: 2026-02-11 16:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'df1ba9905c26'  # Matches your filename
down_revision = None
branch_labels = None
depends_on = None

def upgrade():
    # --- 1. PJSIP Endpoints (Agents/Phones) ---
    op.create_table('ps_endpoints',
        sa.Column('id', sa.String(length=40), nullable=False),
        sa.Column('transport', sa.String(length=40), nullable=True),
        sa.Column('aors', sa.String(length=200), nullable=True),
        sa.Column('auth', sa.String(length=40), nullable=True),
        sa.Column('context', sa.String(length=40), nullable=True),
        sa.Column('disallow', sa.String(length=200), nullable=True),
        sa.Column('allow', sa.String(length=200), nullable=True),
        sa.Column('direct_media', sa.Enum('yes', 'no', name='yesno_enum'), nullable=True),
        sa.Column('webrtc', sa.Enum('yes', 'no', name='yesno_enum'), nullable=True),
        sa.Column('dtls_auto_generate_cert', sa.Enum('yes', 'no', name='yesno_enum'), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )

    # --- 2. PJSIP Auths (Passwords) ---
    op.create_table('ps_auths',
        sa.Column('id', sa.String(length=40), nullable=False),
        sa.Column('auth_type', sa.String(length=40), nullable=True),
        sa.Column('password', sa.String(length=80), nullable=True),
        sa.Column('username', sa.String(length=40), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )

    # --- 3. PJSIP AORs (Contacts) ---
    op.create_table('ps_aors',
        sa.Column('id', sa.String(length=40), nullable=False),
        sa.Column('max_contacts', sa.Integer(), nullable=True),
        sa.Column('remove_existing', sa.Enum('yes', 'no', name='yesno_enum'), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )

    # --- 4. Call Detail Records (CDR) ---
    op.create_table('cdr',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('calldate', sa.DateTime(), nullable=False),
        sa.Column('clid', sa.String(length=80), server_default='', nullable=False),
        sa.Column('src', sa.String(length=80), server_default='', nullable=False),
        sa.Column('dst', sa.String(length=80), server_default='', nullable=False),
        sa.Column('dcontext', sa.String(length=80), server_default='', nullable=False),
        sa.Column('channel', sa.String(length=80), server_default='', nullable=False),
        sa.Column('dstchannel', sa.String(length=80), server_default='', nullable=False),
        sa.Column('lastapp', sa.String(length=80), server_default='', nullable=False),
        sa.Column('lastdata', sa.String(length=80), server_default='', nullable=False),
        sa.Column('duration', sa.Integer(), server_default='0', nullable=False),
        sa.Column('billsec', sa.Integer(), server_default='0', nullable=False),
        sa.Column('disposition', sa.String(length=45), server_default='', nullable=False),
        sa.Column('amaflags', sa.Integer(), server_default='0', nullable=False),
        sa.Column('accountcode', sa.String(length=20), server_default='', nullable=False),
        sa.Column('uniqueid', sa.String(length=32), server_default='', nullable=False),
        sa.Column('userfield', sa.String(length=255), server_default='', nullable=False),
        sa.Column('linkedid', sa.String(length=32), server_default='', nullable=False),
        sa.Column('sequence', sa.Integer(), server_default='0', nullable=False),
        sa.Column('peeraccount', sa.String(length=20), server_default='', nullable=False),
        sa.PrimaryKeyConstraint('id')
    )

    # --- 5. Extensions (Dialplan) ---
    op.create_table('extensions',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('context', sa.String(length=40), nullable=False),
        sa.Column('exten', sa.String(length=40), nullable=False),
        sa.Column('priority', sa.Integer(), nullable=False),
        sa.Column('app', sa.String(length=40), nullable=False),
        sa.Column('appdata', sa.String(length=256), nullable=False),
        sa.PrimaryKeyConstraint('id')
    )

def downgrade():
    op.drop_table('extensions')
    op.drop_table('cdr')
    op.drop_table('ps_aors')
    op.drop_table('ps_auths')
    op.drop_table('ps_endpoints')
    # Cleanup Enums (Postgres specific)
    sa.Enum(name='yesno_enum').drop(op.get_bind(), checkfirst=False)