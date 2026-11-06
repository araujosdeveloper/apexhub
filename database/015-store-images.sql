-- Imagens institucionais isoladas por empresa, incluídas nos backups MySQL.
SET @store_image_company_type=(SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='companies' AND COLUMN_NAME='id');
SET @store_image_ddl=CONCAT('CREATE TABLE store_images (company_id ',@store_image_company_type,' NOT NULL,kind ENUM(''banner'',''logo'') NOT NULL,content_type VARCHAR(32) NOT NULL,content MEDIUMBLOB NOT NULL,digest CHAR(64) NOT NULL,PRIMARY KEY(company_id,kind),FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE CASCADE) ENGINE=InnoDB');
PREPARE store_image_statement FROM @store_image_ddl;
EXECUTE store_image_statement;
DEALLOCATE PREPARE store_image_statement;
