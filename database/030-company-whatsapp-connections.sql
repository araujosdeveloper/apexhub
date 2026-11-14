CREATE TABLE IF NOT EXISTS company_whatsapp_connections (
 company_id INT PRIMARY KEY,
 waba_id VARCHAR(24) NOT NULL,
 phone_number_id VARCHAR(24) NOT NULL UNIQUE,
 display_phone VARCHAR(48) NOT NULL,
 encrypted_token TEXT NOT NULL,
 connected_by BIGINT UNSIGNED NOT NULL,
 connected_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
) ENGINE=InnoDB;
