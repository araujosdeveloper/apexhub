-- Extensão compatível do catálogo existente. Datas legadas indicam a migração.
ALTER TABLE categories ADD created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, ADD INDEX menu_category_order(company_id,sort_order,id);
ALTER TABLE products ADD created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, ADD UNIQUE KEY menu_product_tenant(company_id,id);
SET @menu_image_ddl=IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='products' AND COLUMN_NAME='image_url'),'ALTER TABLE products MODIFY image_url VARCHAR(2048) NULL','ALTER TABLE products ADD image_url VARCHAR(2048) NULL');
PREPARE menu_image_statement FROM @menu_image_ddl;
EXECUTE menu_image_statement;
DEALLOCATE PREPARE menu_image_statement;
SET @menu_tenant_type=(SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='companies' AND COLUMN_NAME='id');
SET @menu_product_type=(SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='products' AND COLUMN_NAME='id');
SET @menu_ddl=CONCAT('CREATE TABLE product_options (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,tenant_id ',@menu_tenant_type,' NOT NULL,product_id ',@menu_product_type,' NOT NULL,option_key VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,group_key VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,name VARCHAR(120) NOT NULL,additional_price DECIMAL(10,2) NOT NULL,max_quantity INT UNSIGNED NOT NULL DEFAULT 1,is_active BOOLEAN NOT NULL DEFAULT TRUE,UNIQUE KEY menu_option_key(tenant_id,product_id,option_key),CHECK(additional_price>=0),CHECK(max_quantity=1),FOREIGN KEY(tenant_id,product_id) REFERENCES products(company_id,id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
PREPARE menu_statement FROM @menu_ddl;
EXECUTE menu_statement;
DEALLOCATE PREPARE menu_statement;
INSERT INTO product_options(tenant_id,product_id,group_key,option_key,name,additional_price,is_active)
 SELECT p.company_id,p.id,j.group_key,j.option_key,j.name,j.price,j.active FROM products p JOIN product_addons a ON a.product_id=p.id
 JOIN JSON_TABLE(a.config,'$[*]' COLUMNS(group_key VARCHAR(64) PATH '$.id',NESTED PATH '$.options[*]' COLUMNS(option_key VARCHAR(64) PATH '$.id',name VARCHAR(120) PATH '$.name',price DECIMAL(10,2) PATH '$.price',active TINYINT PATH '$.active'))) j ON j.option_key IS NOT NULL;

-- Coluna final também impede tratar importação interrompida como migração completa.
ALTER TABLE product_options ADD created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;
