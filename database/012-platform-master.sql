-- Contas Master independentes das lojas. Nenhum acesso é criado automaticamente.
CREATE TABLE platform_admins (
 id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,name VARCHAR(120) NOT NULL,email VARCHAR(254) NOT NULL UNIQUE,
 password_hash VARCHAR(200) NOT NULL,active BOOLEAN NOT NULL DEFAULT TRUE,created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;
CREATE TABLE platform_sessions (
 token_hash CHAR(64) PRIMARY KEY,admin_id INT UNSIGNED NOT NULL,expires_at DATETIME NOT NULL,
 INDEX(expires_at),FOREIGN KEY(admin_id) REFERENCES platform_admins(id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE platform_audit (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,admin_id INT UNSIGNED NOT NULL,action VARCHAR(50) NOT NULL,
 entity_id VARCHAR(80) NOT NULL,details JSON NOT NULL,created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 INDEX(created_at,id),FOREIGN KEY(admin_id) REFERENCES platform_admins(id)
) ENGINE=InnoDB;

-- Tipo do vínculo compatível com empresas legadas INT e INT UNSIGNED.
SET @master_company_type=(SELECT IF(LOCATE('unsigned',COLUMN_TYPE)>0,'INT UNSIGNED','INT') FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='companies' AND COLUMN_NAME='id');
SET @master_profile_ddl=CONCAT('CREATE TABLE platform_tenant_profiles (company_id ',@master_company_type,' PRIMARY KEY,cnpj VARCHAR(32) NULL UNIQUE,FOREIGN KEY(company_id) REFERENCES companies(id)) ENGINE=InnoDB');
PREPARE master_profile_statement FROM @master_profile_ddl;
EXECUTE master_profile_statement;
DEALLOCATE PREPARE master_profile_statement;
