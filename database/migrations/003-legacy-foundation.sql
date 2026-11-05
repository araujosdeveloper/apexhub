-- Apenas para o esquema legado inventariado em 02/11/2026 (IDs INT com sinal).
-- Executado pelo ensaio em uma cópia restaurada. DDL tem commit implícito no MySQL.
ALTER TABLE companies MODIFY name VARCHAR(160) NOT NULL, MODIFY whatsapp_phone VARCHAR(30) NOT NULL DEFAULT '';
ALTER TABLE categories MODIFY name VARCHAR(120) NOT NULL;
ALTER TABLE products MODIFY name VARCHAR(160) NOT NULL;
ALTER TABLE customers MODIFY name VARCHAR(160) NULL, MODIFY phone VARCHAR(160) NOT NULL,
 MODIFY address_number VARCHAR(160) NULL, MODIFY address_neighborhood VARCHAR(160) NULL;
ALTER TABLE orders
 ADD customer_name VARCHAR(160) NOT NULL DEFAULT '',
 ADD customer_phone VARCHAR(160) NOT NULL DEFAULT '',
 ADD address_street VARCHAR(200) NOT NULL DEFAULT '',
 ADD address_number VARCHAR(160) NOT NULL DEFAULT '',
 ADD address_neighborhood VARCHAR(160) NOT NULL DEFAULT '',
 ADD snapshot_source VARCHAR(40) NOT NULL DEFAULT 'checkout',
 ADD INDEX orders_company_date (company_id, created_at, id);
UPDATE orders o JOIN customers c ON c.id = o.customer_id AND c.company_id = o.company_id
 SET o.customer_name = COALESCE(c.name, ''), o.customer_phone = COALESCE(c.phone, ''),
 o.address_street = COALESCE(c.address_street, ''), o.address_number = COALESCE(c.address_number, ''),
 o.address_neighborhood = COALESCE(c.address_neighborhood, ''), o.snapshot_source = 'legacy_customer_record';
ALTER TABLE order_items ADD product_name VARCHAR(160) NOT NULL DEFAULT '', ADD total_price DECIMAL(10,2) NULL;
UPDATE order_items i JOIN products p ON p.id = i.product_id SET i.product_name = p.name, i.total_price = i.quantity * i.unit_price;
ALTER TABLE order_items MODIFY total_price DECIMAL(10,2) NOT NULL;
CREATE TABLE users (
 id INT AUTO_INCREMENT PRIMARY KEY, company_id INT NOT NULL, name VARCHAR(120) NOT NULL,
 email VARCHAR(254) NOT NULL UNIQUE, password_hash VARCHAR(200) NOT NULL,
 role ENUM('owner','manager','operator') NOT NULL DEFAULT 'owner', active BOOLEAN NOT NULL DEFAULT TRUE,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY (company_id) REFERENCES companies(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE sessions (
 token_hash CHAR(64) PRIMARY KEY, user_id INT NOT NULL, expires_at DATETIME NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX (expires_at),
 FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE subscriptions (
 id INT AUTO_INCREMENT PRIMARY KEY, company_id INT NOT NULL UNIQUE, plan_code VARCHAR(40) NOT NULL,
 status ENUM('legacy','trialing','active','past_due','cancelled') NOT NULL DEFAULT 'trialing',
 trial_ends_at DATETIME NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY (company_id) REFERENCES companies(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
-- Mantém a situação original em companies.subscription_status sem presumir pagamento.
INSERT INTO subscriptions (company_id, plan_code, status) SELECT id, 'legacy', 'legacy' FROM companies;
CREATE TABLE checkout_requests (
 company_id INT NOT NULL, request_key VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, order_id INT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (company_id, request_key),
 FOREIGN KEY (company_id) REFERENCES companies(id), FOREIGN KEY (order_id) REFERENCES orders(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
