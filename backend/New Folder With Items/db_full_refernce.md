 ***************
 
 SELECT *
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'asteriskdb'
ORDER BY TABLE_NAME, ORDINAL_POSITION;
asteriskdb=# 
asteriskdb=# SELECT                                                                    
    table_name,                                                                                                                                                 
    column_name, 
    data_type,                                                                                   
    is_nullable, 
    column_default
FROM                                                               
    information_schema.columns
WHERE                                                                                                               
    table_schema = 'public' -- Change to your schema name
ORDER BY                                        
    table_name,                                                                                  
    ordinal_position
    
******************


table_name     |        column_name        |          data_type          | is_nullable |             column_default             
--------------------+---------------------------+-----------------------------+-------------+----------------------------------------
 alembic_version    | version_num               | character varying           | NO          | 
 cdr                | id                        | integer                     | NO          | nextval('cdr_id_seq'::regclass)
 cdr                | calldate                  | timestamp without time zone | YES         | 
 cdr                | clid                      | character varying           | NO          | ''::character varying
 cdr                | src                       | character varying           | NO          | ''::character varying
 cdr                | dst                       | character varying           | NO          | ''::character varying
 cdr                | dcontext                  | character varying           | NO          | ''::character varying
 cdr                | channel                   | character varying           | NO          | ''::character varying
 cdr                | dstchannel                | character varying           | NO          | ''::character varying
 cdr                | lastapp                   | character varying           | NO          | ''::character varying
 cdr                | lastdata                  | character varying           | NO          | ''::character varying
 cdr                | duration                  | integer                     | NO          | 0
 cdr                | billsec                   | integer                     | NO          | 0
 cdr                | disposition               | character varying           | NO          | ''::character varying
 cdr                | amaflags                  | integer                     | NO          | 0
 cdr                | accountcode               | character varying           | NO          | ''::character varying
 cdr                | uniqueid                  | character varying           | NO          | ''::character varying
 cdr                | userfield                 | character varying           | NO          | ''::character varying
 cdr                | linkedid                  | character varying           | NO          | ''::character varying
 cdr                | sequence                  | integer                     | NO          | 0
 cdr                | peeraccount               | character varying           | NO          | ''::character varying
 cdr                | tenant_id                 | uuid                        | YES         | 
 cdr                | start_time                | timestamp without time zone | YES         | 
 cdr                | answer_time               | timestamp without time zone | YES         | 
 cdr                | end_time                  | timestamp without time zone | YES         | 
 extensions         | id                        | integer                     | NO          | nextval('extensions_id_seq'::regclass)
 extensions         | context                   | character varying           | NO          | 
 extensions         | exten                     | character varying           | NO          | 
 extensions         | priority                  | integer                     | NO          | 
 extensions         | app                       | character varying           | NO          | 
 extensions         | appdata                   | character varying           | NO          | 
 extensions         | tenant_id                 | uuid                        | YES         | 
 ps_aors            | id                        | character varying           | NO          | 
 ps_aors            | max_contacts              | integer                     | YES         | 
 ps_aors            | remove_existing           | USER-DEFINED                | YES         | 
 ps_aors            | tenant_id                 | uuid                        | YES         | 
 ps_aors            | contact                   | character varying           | YES         | 
 ps_aors            | qualify_frequency         | integer                     | YES         | 
 ps_aors            | qualify_timeout           | double precision            | YES         | 
 ps_aors            | authenticate_qualify      | character varying           | YES         | 
 ps_auths           | id                        | character varying           | NO          | 
 ps_auths           | auth_type                 | character varying           | YES         | 
 ps_auths           | password                  | character varying           | YES         | 
 ps_auths           | username                  | character varying           | YES         | 
 ps_auths           | tenant_id                 | uuid                        | YES         | 
 ps_contacts        | id                        | character varying           | NO          | 
 ps_contacts        | uri                       | character varying           | YES         | 
 ps_contacts        | expiration_time           | character varying           | YES         | 
 ps_contacts        | qualify_frequency         | integer                     | YES         | 
 ps_contacts        | outbound_proxy            | character varying           | YES         | 
 ps_contacts        | path                      | text                        | YES         | 
 ps_contacts        | user_agent                | character varying           | YES         | 
 ps_contacts        | endpoint                  | character varying           | YES         | 
 ps_contacts        | reg_server                | character varying           | YES         | 
 ps_contacts        | via_addr                  | character varying           | YES         | 
 ps_contacts        | via_port                  | integer                     | YES         | 
 ps_contacts        | call_id                   | character varying           | YES         | 
 ps_contacts        | tenant_id                 | uuid                        | YES         | 
 ps_contacts        | qualify_timeout           | double precision            | YES         | 
 ps_contacts        | qualify_2xx_only          | boolean                     | YES         | false
 ps_contacts        | prune_on_boot             | boolean                     | YES         | false
 ps_contacts        | authenticate_qualify      | boolean                     | YES         | false
 ps_endpoint_id_ips | id                        | character varying           | NO          | 
 ps_endpoint_id_ips | endpoint                  | character varying           | YES         | 
 ps_endpoint_id_ips | match                     | character varying           | YES         | 
 ps_endpoints       | id                        | character varying           | NO          | 
 ps_endpoints       | transport                 | character varying           | YES         | 
 ps_endpoints       | aors                      | character varying           | YES         | 
 ps_endpoints       | auth                      | character varying           | YES         | 
 ps_endpoints       | context                   | character varying           | YES         | 
 ps_endpoints       | disallow                  | character varying           | YES         | 
 ps_endpoints       | allow                     | character varying           | YES         | 
 ps_endpoints       | direct_media              | USER-DEFINED                | YES         | 
 ps_endpoints       | webrtc                    | USER-DEFINED                | YES         | 
 ps_endpoints       | dtls_auto_generate_cert   | USER-DEFINED                | YES         | 
 ps_endpoints       | tenant_id                 | uuid                        | YES         | 
 ps_endpoints       | rtp_symmetric             | character varying           | YES         | 'no'::character varying
 ps_endpoints       | force_rport               | character varying           | YES         | 'no'::character varying
 ps_endpoints       | rewrite_contact           | character varying           | YES         | 'no'::character varying
 ps_endpoints       | ice_support               | character varying           | YES         | 'no'::character varying
 ps_endpoints       | timers                    | character varying           | YES         | 'yes'::character varying
 ps_endpoints       | timers_min_se             | integer                     | YES         | 90
 ps_endpoints       | timers_sess_expires       | integer                     | YES         | 1800
 ps_endpoints       | media_address             | character varying           | YES         | 
 ps_endpoints       | bind_rtp_to_media_address | character varying           | YES         | 'no'::character varying
 ps_endpoints       | use_avpf                  | character varying           | YES         | 'no'::character varying
 ps_endpoints       | media_encryption          | character varying           | YES         | 'no'::character varying
 ps_endpoints       | dtls_verify               | character varying           | YES         | 'fingerprint'::character varying
 ps_endpoints       | dtls_cert_file            | character varying           | YES         | 
 ps_endpoints       | dtls_private_key          | character varying           | YES         | 
 ps_endpoints       | dtls_setup                | character varying           | YES         | 'actpass'::character varying
 ps_endpoints       | outbound_auth             | character varying           | YES         | 
 ps_registrations   | id                        | character varying           | NO          | 
 ps_registrations   | auth_rejection_permanent  | character varying           | YES         | 'yes'::character varying
 ps_registrations   | client_uri                | character varying           | YES         | 
 ps_registrations   | contact_user              | character varying           | YES         | 
 ps_registrations   | expiration                | integer                     | YES         | 
 ps_registrations   | max_retries               | integer                     | YES         | 
 ps_registrations   | outbound_auth             | character varying           | YES         | 
 ps_registrations   | outbound_proxy            | character varying           | YES         | 
 ps_registrations   | retry_interval            | integer                     | YES         | 
 ps_registrations   | forbidden_retry_interval  | integer                     | YES         | 
 ps_registrations   | server_uri                | character varying           | YES         | 
 ps_registrations   | transport                 | character varying           | YES         | 
 ps_registrations   | support_path              | character varying           | YES         | 'no'::character varying
 ps_registrations   | fatal_retry_interval      | integer                     | YES         | 
 ps_registrations   | line                      | character varying           | YES         | 'no'::character varying
 ps_registrations   | endpoint                  | character varying           | YES         | 
 ps_registrations   | tenant_id                 | uuid                        | YES         | 
 tenants            | id                        | uuid                        | NO          | gen_random_uuid()
 tenants            | name                      | character varying           | NO          | 
 tenants            | created_at                | timestamp without time zone | NO          | now()







