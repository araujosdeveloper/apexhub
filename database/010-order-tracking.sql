-- Mesma conexão; preserva pedidos e acompanha o tipo real do ID.
SET @tracking_order_type=(SELECT IF(LOCATE('unsigned',COLUMN_TYPE)>0,'INT UNSIGNED','INT') FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND COLUMN_NAME='id');
SET @tracking_ddl=CONCAT('CREATE TABLE order_tracking (order_id ',@tracking_order_type,' PRIMARY KEY,token CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,FOREIGN KEY(order_id) REFERENCES orders(id)) ENGINE=InnoDB');
PREPARE tracking_statement FROM @tracking_ddl;
EXECUTE tracking_statement;
DEALLOCATE PREPARE tracking_statement;
