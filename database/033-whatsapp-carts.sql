CREATE TABLE IF NOT EXISTS whatsapp_carts (
 company_id INT NOT NULL,
 phone_number_id VARCHAR(24) NOT NULL,
 sender VARCHAR(20) NOT NULL,
 items JSON NOT NULL,
 quote JSON NULL,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 PRIMARY KEY (company_id, phone_number_id, sender),
 FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
) ENGINE=InnoDB;
