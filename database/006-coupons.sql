-- Aplicar uma vez após 004/005 em banco existente, após backup e ensaio.
-- Todos os comandos na mesma conexão; tipos com/sem sinal preservados.
SET @coupons_company_type = (SELECT IF(LOCATE('unsigned', COLUMN_TYPE) > 0, 'INT UNSIGNED', 'INT')
 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'companies' AND COLUMN_NAME = 'id');
SET @coupons_ddl = CONCAT('CREATE TABLE company_coupons (
 id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, company_id ', @coupons_company_type, ' NOT NULL,
 code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, config JSON NOT NULL,
 version INT UNSIGNED NOT NULL DEFAULT 1, usage_count INT UNSIGNED NOT NULL DEFAULT 0,
 UNIQUE KEY coupon_company_code (company_id, code), FOREIGN KEY (company_id) REFERENCES companies(id)) ENGINE=InnoDB');
PREPARE coupons_statement FROM @coupons_ddl;
EXECUTE coupons_statement;
DEALLOCATE PREPARE coupons_statement;
ALTER TABLE orders
 ADD COLUMN coupon_code VARCHAR(32) NOT NULL DEFAULT '',
 ADD COLUMN discount_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
 ADD COLUMN coupon_snapshot JSON NULL,
 ADD COLUMN customer_phone_key VARCHAR(15) NULL,
 ADD INDEX orders_coupon_customer (company_id, coupon_code, customer_phone_key),
 ADD CONSTRAINT orders_discount_nonnegative CHECK (discount_amount >= 0);
