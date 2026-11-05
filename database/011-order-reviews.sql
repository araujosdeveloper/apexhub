-- Mesma conexão; tipo de ID compatível com pedidos existentes.
SET @reviews_order_type=(SELECT IF(LOCATE('unsigned',COLUMN_TYPE)>0,'INT UNSIGNED','INT') FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND COLUMN_NAME='id');
SET @reviews_ddl=CONCAT('CREATE TABLE order_reviews (order_id ',@reviews_order_type,' PRIMARY KEY,rating TINYINT UNSIGNED NOT NULL,comment VARCHAR(1000) NOT NULL DEFAULT '''',created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,INDEX reviews_date(created_at,order_id),CHECK(rating BETWEEN 1 AND 5),FOREIGN KEY(order_id) REFERENCES orders(id)) ENGINE=InnoDB');
PREPARE reviews_statement FROM @reviews_ddl;
EXECUTE reviews_statement;
DEALLOCATE PREPARE reviews_statement;
