"""add_multitenancy

Revision ID: 9f9566f3261d
Revises: df1ba9905c26
Create Date: 2026-02-11 16:30:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '9f9566f3261d'
down_revision = 'df1ba9905c26'
branch_labels = None
depends_on = None

def upgrade():
    # 1. Create Tenants Table (UUIDs are more secure than simple IDs)
    op.create_table('tenants',
        sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint('id')
    )

    # 2. Add tenant_id to all major tables
    tables = ['ps_endpoints', 'ps_auths', 'ps_aors', 'extensions', 'cdr']
    
    for table in tables:
        # Add the column
        op.add_column(table, sa.Column('tenant_id', sa.UUID(), nullable=True))
        
        # Create foreign key relationship
        op.create_foreign_key(f'fk_{table}_tenant', table, 'tenants', ['tenant_id'], ['id'])
        
        # 3. Enable Row Level Security (RLS)
        # This prevents 'Company A' from ever seeing 'Company B' data
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        
        # 4. Create the Isolation Policy
        # PostgREST will set 'app.current_tenant' in the session based on the JWT token
        op.execute(f"""
            CREATE POLICY tenant_isolation_policy ON {table}
            FOR ALL
            TO web_anon
            USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
        """)

def downgrade():
    tables = ['ps_endpoints', 'ps_auths', 'ps_aors', 'extensions', 'cdr']
    for table in tables:
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation_policy ON {table}")
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")
        op.drop_constraint(f'fk_{table}_tenant', table, type_='foreignkey')
        op.drop_column(table, 'tenant_id')

    op.drop_table('tenants')