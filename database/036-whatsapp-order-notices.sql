CREATE TABLE IF NOT EXISTS whatsapp_order_notices (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 company_id INT NOT NULL,
 order_id BIGINT UNSIGNED NOT NULL,
 kind ENUM('consent','preparing','ready','delivering','cancelled') NOT NULL,
 state ENUM('queued','uncertain','accepted','delivered','rejected','suppressed') NOT NULL,
 phone_number_id VARCHAR(24) NULL,
 provider_message_id VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY whatsapp_notice_event (company_id, order_id, kind),
 KEY whatsapp_notice_queue (state, id),
 KEY whatsapp_notice_provider (phone_number_id, provider_message_id),
 FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS whatsapp_notice_optouts (
 company_id INT NOT NULL,
 sender VARCHAR(20) NOT NULL,
 PRIMARY KEY (company_id, sender),
 FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
) ENGINE=InnoDB;
