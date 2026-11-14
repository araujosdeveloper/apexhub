CREATE TABLE IF NOT EXISTS company_whatsapp_inbox (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 company_id INT NOT NULL,
 phone_number_id VARCHAR(24) NOT NULL,
 message_id VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 sender VARCHAR(20) NOT NULL,
 message_type VARCHAR(32) NOT NULL,
 body TEXT CHARACTER SET utf8mb4 NULL,
 received_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY whatsapp_inbox_message (company_id, phone_number_id, message_id),
 FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
) ENGINE=InnoDB;
