-- Sessões assistidas independentes das sessões do lojista, revogadas pelo Master pai.
SET @assist_company_type=(SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='companies' AND COLUMN_NAME='id');
SET @assist_owner_type=(SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='id');
SET @assist_ddl=CONCAT('CREATE TABLE platform_impersonations (id CHAR(64) PRIMARY KEY,cookie_hash CHAR(64) NULL UNIQUE,admin_id INT UNSIGNED NOT NULL,master_session_hash CHAR(64) NOT NULL,company_id ',@assist_company_type,' NOT NULL,owner_id ',@assist_owner_type,' NOT NULL,exchanged BOOLEAN NOT NULL DEFAULT FALSE,expires_at DATETIME NOT NULL,created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,INDEX(expires_at),FOREIGN KEY(admin_id) REFERENCES platform_admins(id) ON DELETE CASCADE,FOREIGN KEY(master_session_hash) REFERENCES platform_sessions(token_hash) ON DELETE CASCADE,FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE CASCADE,FOREIGN KEY(owner_id) REFERENCES users(id) ON DELETE CASCADE) ENGINE=InnoDB');
PREPARE assist_statement FROM @assist_ddl;
EXECUTE assist_statement;
DEALLOCATE PREPARE assist_statement;
