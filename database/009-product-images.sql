-- Mesma conexão; tipo do ID acompanha o catálogo real.
SET @images_product_type=(SELECT IF(LOCATE('unsigned',COLUMN_TYPE)>0,'INT UNSIGNED','INT') FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='products' AND COLUMN_NAME='id');
SET @images_ddl=CONCAT('CREATE TABLE product_images (product_id ',@images_product_type,' PRIMARY KEY,content_type VARCHAR(32) NOT NULL,content MEDIUMBLOB NOT NULL,digest CHAR(64) NOT NULL,FOREIGN KEY(product_id) REFERENCES products(id)) ENGINE=InnoDB');
PREPARE images_statement FROM @images_ddl;
EXECUTE images_statement;
DEALLOCATE PREPARE images_statement;
