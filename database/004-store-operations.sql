-- Banco existente já migrado para a fundação SaaS. Aplicar uma única vez,
-- após backup e ensaio em cópia, antes de iniciar a nova aplicação.
-- DDL MySQL tem commit implícito: não tratar este arquivo como transação reversível.
-- Preserva o tipo de companies.id: INT no legado e INT UNSIGNED em bancos novos.
-- Todos os comandos devem executar na mesma conexão MySQL.
SET @operations_id_type = (SELECT IF(LOCATE('unsigned', COLUMN_TYPE) > 0, 'INT UNSIGNED', 'INT')
 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'companies' AND COLUMN_NAME = 'id');
SET @operations_ddl = CONCAT('CREATE TABLE IF NOT EXISTS company_operations (company_id ', @operations_id_type,
 ' PRIMARY KEY, config JSON NOT NULL, FOREIGN KEY (company_id) REFERENCES companies(id)) ENGINE=InnoDB');
PREPARE operations_statement FROM @operations_ddl;
EXECUTE operations_statement;
DEALLOCATE PREPARE operations_statement;
-- O legado já possui delivery_fee nullable: preservar valores e nulos históricos.
SET @operations_has_fee = (SELECT COUNT(*) FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'delivery_fee');
SET @operations_alter = CONCAT('ALTER TABLE orders
 ADD COLUMN fulfillment_method ENUM(''delivery'',''pickup'') NOT NULL DEFAULT ''delivery'', ',
 IF(@operations_has_fee = 0, 'ADD COLUMN delivery_fee DECIMAL(10,2) NOT NULL DEFAULT 0.00, ', ''),
 'ADD COLUMN fulfillment_address VARCHAR(320) NOT NULL DEFAULT '''',
 ADD COLUMN estimated_minutes SMALLINT UNSIGNED NULL,
 ADD CONSTRAINT orders_delivery_fee_nonnegative CHECK (delivery_fee IS NULL OR delivery_fee >= 0)');
PREPARE operations_statement FROM @operations_alter;
EXECUTE operations_statement;
DEALLOCATE PREPARE operations_statement;
