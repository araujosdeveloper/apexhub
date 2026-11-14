CREATE TABLE IF NOT EXISTS whatsapp_handoffs (
 company_id INT NOT NULL,
 phone_number_id VARCHAR(24) NOT NULL,
 sender VARCHAR(20) NOT NULL,
 state ENUM('waiting','human','bot') NOT NULL,
 actor_id BIGINT UNSIGNED NULL,
 skip_through BIGINT UNSIGNED NOT NULL DEFAULT 0,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 PRIMARY KEY (company_id, phone_number_id, sender),
 FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS whatsapp_human_replies (
 company_id INT NOT NULL,
 phone_number_id VARCHAR(24) NOT NULL,
 sender VARCHAR(20) NOT NULL,
 request_key CHAR(36) NOT NULL,
 actor_id BIGINT UNSIGNED NOT NULL,
 body TEXT CHARACTER SET utf8mb4 NOT NULL,
 state ENUM('uncertain','accepted','rejected') NOT NULL,
 provider_message_id VARCHAR(255) NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY (company_id, phone_number_id, sender, request_key),
 FOREIGN KEY (company_id, phone_number_id, sender)
   REFERENCES whatsapp_handoffs(company_id, phone_number_id, sender) ON DELETE CASCADE
) ENGINE=InnoDB;
