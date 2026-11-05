-- Mesma conexão; compatível com IDs legados assinados e não assinados.
SET @merch_company_type=(SELECT IF(LOCATE('unsigned',COLUMN_TYPE)>0,'INT UNSIGNED','INT') FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='companies' AND COLUMN_NAME='id');
SET @merch_ddl=CONCAT('CREATE TABLE company_merchandising (company_id ',@merch_company_type,' PRIMARY KEY,config JSON NOT NULL,version INT UNSIGNED NOT NULL DEFAULT 1,FOREIGN KEY(company_id) REFERENCES companies(id)) ENGINE=InnoDB');
PREPARE merch_statement FROM @merch_ddl;
EXECUTE merch_statement;
DEALLOCATE PREPARE merch_statement;
