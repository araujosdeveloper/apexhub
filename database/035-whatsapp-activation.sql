ALTER TABLE company_whatsapp_connections
 ADD COLUMN automation_enabled BOOLEAN NOT NULL DEFAULT FALSE,
 ADD COLUMN enabled_at DATETIME(6) NULL,
 ADD COLUMN webhook_checked_at DATETIME(6) NULL;
