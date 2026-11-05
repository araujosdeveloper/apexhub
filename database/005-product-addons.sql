-- Aplicar uma vez após 004 em banco existente, após backup e ensaio.
-- Mesma conexão MySQL para todos os comandos. Preserva as tabelas legadas de opções.
SET @addons_id_type = (SELECT IF(LOCATE('unsigned', COLUMN_TYPE) > 0, 'INT UNSIGNED', 'INT')
 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'id');
SET @addons_ddl = CONCAT('CREATE TABLE product_addons (product_id ', @addons_id_type,
 ' PRIMARY KEY, config JSON NOT NULL, version INT UNSIGNED NOT NULL, FOREIGN KEY (product_id) REFERENCES products(id)) ENGINE=InnoDB');
PREPARE addons_statement FROM @addons_ddl;
EXECUTE addons_statement;
DEALLOCATE PREPARE addons_statement;
ALTER TABLE order_items ADD COLUMN addons_snapshot JSON NULL;
