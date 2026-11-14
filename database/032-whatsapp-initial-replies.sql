CREATE TABLE IF NOT EXISTS whatsapp_initial_replies (
 inbox_id BIGINT UNSIGNED PRIMARY KEY,
 state ENUM('uncertain','accepted','rejected') NOT NULL,
 provider_message_id VARCHAR(255) NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY (inbox_id) REFERENCES company_whatsapp_inbox(id) ON DELETE CASCADE
) ENGINE=InnoDB;
