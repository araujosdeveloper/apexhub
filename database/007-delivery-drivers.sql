-- Mesma conexão; IDs compatíveis com instalações legadas.
SET @drivers_company_type = (SELECT IF(LOCATE('unsigned',COLUMN_TYPE)>0,'INT UNSIGNED','INT') FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='companies' AND COLUMN_NAME='id');
SET @drivers_order_type = (SELECT IF(LOCATE('unsigned',COLUMN_TYPE)>0,'INT UNSIGNED','INT') FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND COLUMN_NAME='id');
SET @drivers_ddl = CONCAT('CREATE TABLE delivery_drivers (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,company_id ',@drivers_company_type,' NOT NULL,name VARCHAR(120) NOT NULL,phone VARCHAR(15) NOT NULL,active BOOLEAN NOT NULL DEFAULT TRUE,version INT UNSIGNED NOT NULL DEFAULT 1,UNIQUE KEY driver_phone(company_id,phone),FOREIGN KEY(company_id) REFERENCES companies(id)) ENGINE=InnoDB');
PREPARE drivers_statement FROM @drivers_ddl;
EXECUTE drivers_statement;
DEALLOCATE PREPARE drivers_statement;
SET @drivers_ddl = CONCAT('CREATE TABLE delivery_assignments (order_id ',@drivers_order_type,' PRIMARY KEY,company_id ',@drivers_company_type,' NOT NULL,driver_id INT UNSIGNED NULL,driver_name VARCHAR(120) NOT NULL DEFAULT '''',driver_phone VARCHAR(15) NOT NULL DEFAULT '''',version INT UNSIGNED NOT NULL DEFAULT 1,FOREIGN KEY(order_id) REFERENCES orders(id),FOREIGN KEY(company_id) REFERENCES companies(id),FOREIGN KEY(driver_id) REFERENCES delivery_drivers(id)) ENGINE=InnoDB');
PREPARE drivers_statement FROM @drivers_ddl;
EXECUTE drivers_statement;
DEALLOCATE PREPARE drivers_statement;
