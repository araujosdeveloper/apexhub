-- Somente metadados: não retorna registros de clientes, pedidos ou credenciais.
SELECT JSON_OBJECT(
 'database', DATABASE(),
 'server_version', @@version,
 'captured_at', UTC_TIMESTAMP(),
 'tables', COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT(
   'name', TABLE_NAME, 'type', TABLE_TYPE, 'engine', ENGINE, 'collation', TABLE_COLLATION,
   'estimated_rows', TABLE_ROWS))
   FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()), JSON_ARRAY()),
 'columns', COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT(
   'table', TABLE_NAME, 'name', COLUMN_NAME, 'type', COLUMN_TYPE, 'nullable', IS_NULLABLE,
   'default', COLUMN_DEFAULT, 'extra', EXTRA, 'position', ORDINAL_POSITION))
   FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()), JSON_ARRAY()),
 'indexes', COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT(
   'table', TABLE_NAME, 'name', INDEX_NAME, 'column', COLUMN_NAME, 'position', SEQ_IN_INDEX,
   'unique', IF(NON_UNIQUE = 0, TRUE, FALSE), 'prefix', SUB_PART))
   FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE()), JSON_ARRAY()),
 'foreign_keys', COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT(
   'table', TABLE_NAME, 'name', CONSTRAINT_NAME, 'column', COLUMN_NAME,
   'referenced_table', REFERENCED_TABLE_NAME, 'referenced_column', REFERENCED_COLUMN_NAME,
   'position', ORDINAL_POSITION))
   FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL), JSON_ARRAY())
);
