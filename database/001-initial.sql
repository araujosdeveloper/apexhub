-- Instalações novas. Não substitui a migração de um banco já existente.
CREATE TABLE IF NOT EXISTS companies (
 id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 name VARCHAR(160) NOT NULL, slug VARCHAR(80) NOT NULL UNIQUE,
 whatsapp_phone VARCHAR(30) NOT NULL DEFAULT '', active BOOLEAN NOT NULL DEFAULT TRUE,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS company_operations (
 company_id INT UNSIGNED PRIMARY KEY, config JSON NOT NULL,
 FOREIGN KEY (company_id) REFERENCES companies(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS users (
 id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, company_id INT UNSIGNED NOT NULL,
 name VARCHAR(120) NOT NULL, email VARCHAR(254) NOT NULL UNIQUE,
 password_hash VARCHAR(200) NOT NULL, role ENUM('owner','manager','operator') NOT NULL DEFAULT 'owner',
 active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY (company_id) REFERENCES companies(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS sessions (
 token_hash CHAR(64) PRIMARY KEY, user_id INT UNSIGNED NOT NULL, expires_at DATETIME NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX (expires_at),
 FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS subscriptions (
 id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, company_id INT UNSIGNED NOT NULL UNIQUE,
 plan_code VARCHAR(40) NOT NULL, status ENUM('legacy','trialing','active','past_due','cancelled') NOT NULL DEFAULT 'trialing',
 trial_ends_at DATETIME NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY (company_id) REFERENCES companies(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS company_whatsapp_connections (
 company_id INT UNSIGNED PRIMARY KEY,
 waba_id VARCHAR(24) NOT NULL,
 phone_number_id VARCHAR(24) NOT NULL UNIQUE,
 display_phone VARCHAR(48) NOT NULL,
 encrypted_token TEXT NOT NULL,
 automation_enabled BOOLEAN NOT NULL DEFAULT FALSE,
 enabled_at DATETIME(6) NULL,
 webhook_checked_at DATETIME(6) NULL,
 connected_by BIGINT UNSIGNED NOT NULL,
 connected_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS company_whatsapp_inbox (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 company_id INT UNSIGNED NOT NULL,
 phone_number_id VARCHAR(24) NOT NULL,
 message_id VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 sender VARCHAR(20) NOT NULL,
 message_type VARCHAR(32) NOT NULL,
 body TEXT CHARACTER SET utf8mb4 NULL,
 received_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY whatsapp_inbox_message (company_id, phone_number_id, message_id),
 FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS subscription_plan_requests (
 company_id INT UNSIGNED PRIMARY KEY, plan_code ENUM('essencial','pro') NOT NULL,
 status ENUM('pending','accepted','declined') NOT NULL DEFAULT 'pending',
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS categories (
 id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, company_id INT UNSIGNED NOT NULL,
 name VARCHAR(120) NOT NULL, sort_order INT NOT NULL DEFAULT 0, active BOOLEAN NOT NULL DEFAULT TRUE,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX menu_category_order(company_id,sort_order,id),
 UNIQUE KEY category_company (id, company_id), FOREIGN KEY (company_id) REFERENCES companies(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS products (
 id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, company_id INT UNSIGNED NOT NULL, category_id INT UNSIGNED NOT NULL,
 name VARCHAR(160) NOT NULL, description TEXT, price DECIMAL(10,2) NOT NULL,
 active BOOLEAN NOT NULL DEFAULT TRUE, CHECK (price >= 0),
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, image_url VARCHAR(2048) NULL, UNIQUE KEY menu_product_tenant(company_id,id),
 UNIQUE KEY product_company (id, company_id),
 FOREIGN KEY (company_id) REFERENCES companies(id),
 FOREIGN KEY (category_id, company_id) REFERENCES categories(id, company_id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS product_addons (
 product_id INT UNSIGNED PRIMARY KEY, config JSON NOT NULL, version INT UNSIGNED NOT NULL,
 FOREIGN KEY (product_id) REFERENCES products(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS product_options (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,tenant_id INT UNSIGNED NOT NULL,product_id INT UNSIGNED NOT NULL,
 option_key VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,group_key VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 name VARCHAR(120) NOT NULL,additional_price DECIMAL(10,2) NOT NULL,max_quantity INT UNSIGNED NOT NULL DEFAULT 1,is_active BOOLEAN NOT NULL DEFAULT TRUE,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE KEY menu_option_key(tenant_id,product_id,option_key),CHECK(additional_price>=0),CONSTRAINT product_options_quantity_range CHECK(max_quantity BETWEEN 1 AND 20),
 FOREIGN KEY(tenant_id,product_id) REFERENCES products(company_id,id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS customers (
 id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, company_id INT UNSIGNED NOT NULL,
 name VARCHAR(160) NOT NULL, phone VARCHAR(160) NOT NULL,
 address_street VARCHAR(160) NOT NULL, address_number VARCHAR(160) NOT NULL, address_neighborhood VARCHAR(160) NOT NULL,
 UNIQUE KEY customer_phone (company_id, phone), UNIQUE KEY customer_company (id, company_id),
 FOREIGN KEY (company_id) REFERENCES companies(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS company_coupons (
 id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, company_id INT UNSIGNED NOT NULL,
 code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, config JSON NOT NULL,
 version INT UNSIGNED NOT NULL DEFAULT 1, usage_count INT UNSIGNED NOT NULL DEFAULT 0,
 UNIQUE KEY coupon_company_code (company_id, code), FOREIGN KEY (company_id) REFERENCES companies(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS orders (
 id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, company_id INT UNSIGNED NOT NULL, customer_id INT UNSIGNED NOT NULL,
 total_amount DECIMAL(10,2) NOT NULL, status ENUM('pending','preparing','ready','delivering','completed','cancelled') NOT NULL DEFAULT 'pending',
 payment_method VARCHAR(40) NOT NULL, notes TEXT,
 fulfillment_method ENUM('delivery','pickup') NOT NULL DEFAULT 'delivery',
 delivery_fee DECIMAL(10,2) NOT NULL DEFAULT 0.00,
 fulfillment_address VARCHAR(320) NOT NULL DEFAULT '', estimated_minutes SMALLINT UNSIGNED NULL,
 CONSTRAINT orders_delivery_fee_nonnegative CHECK (delivery_fee >= 0),
 coupon_code VARCHAR(32) NOT NULL DEFAULT '', discount_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
 coupon_snapshot JSON NULL, customer_phone_key VARCHAR(15) NULL,
 CONSTRAINT orders_discount_nonnegative CHECK (discount_amount >= 0),
 INDEX orders_coupon_customer (company_id, coupon_code, customer_phone_key),
 snapshot_source VARCHAR(40) NOT NULL DEFAULT 'checkout',
 customer_name VARCHAR(160) NOT NULL, customer_phone VARCHAR(160) NOT NULL,
 address_street VARCHAR(160) NOT NULL, address_number VARCHAR(160) NOT NULL, address_neighborhood VARCHAR(160) NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 INDEX orders_company_date (company_id, created_at, id), CHECK (total_amount >= 0),
 FOREIGN KEY (company_id) REFERENCES companies(id),
 FOREIGN KEY (customer_id, company_id) REFERENCES customers(id, company_id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS order_items (
 id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, order_id INT UNSIGNED NOT NULL, product_id INT UNSIGNED NOT NULL,
 product_name VARCHAR(160) NOT NULL, quantity INT UNSIGNED NOT NULL, item_notes VARCHAR(500) NOT NULL DEFAULT '', addons_snapshot JSON NULL,
 unit_price DECIMAL(10,2) NOT NULL, total_price DECIMAL(10,2) NOT NULL,
 CHECK (quantity > 0), CHECK (unit_price >= 0), CHECK (total_price >= 0),
 FOREIGN KEY (order_id) REFERENCES orders(id), FOREIGN KEY (product_id) REFERENCES products(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS delivery_drivers (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,company_id INT UNSIGNED NOT NULL,name VARCHAR(120) NOT NULL,phone VARCHAR(15) NOT NULL,active BOOLEAN NOT NULL DEFAULT TRUE,version INT UNSIGNED NOT NULL DEFAULT 1,UNIQUE KEY driver_phone(company_id,phone),FOREIGN KEY(company_id) REFERENCES companies(id)) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS delivery_assignments (order_id INT UNSIGNED PRIMARY KEY,company_id INT UNSIGNED NOT NULL,driver_id INT UNSIGNED NULL,driver_name VARCHAR(120) NOT NULL DEFAULT '',driver_phone VARCHAR(15) NOT NULL DEFAULT '',version INT UNSIGNED NOT NULL DEFAULT 1,FOREIGN KEY(order_id) REFERENCES orders(id),FOREIGN KEY(company_id) REFERENCES companies(id),FOREIGN KEY(driver_id) REFERENCES delivery_drivers(id)) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS company_merchandising (company_id INT UNSIGNED PRIMARY KEY,config JSON NOT NULL,version INT UNSIGNED NOT NULL DEFAULT 1,FOREIGN KEY(company_id) REFERENCES companies(id)) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS product_images (product_id INT UNSIGNED PRIMARY KEY,content_type VARCHAR(32) NOT NULL,content MEDIUMBLOB NOT NULL,digest CHAR(64) NOT NULL,FOREIGN KEY(product_id) REFERENCES products(id)) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS order_tracking (order_id INT UNSIGNED PRIMARY KEY,token CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,FOREIGN KEY(order_id) REFERENCES orders(id)) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS order_reviews (order_id INT UNSIGNED PRIMARY KEY,rating TINYINT UNSIGNED NOT NULL,comment VARCHAR(1000) NOT NULL DEFAULT '',created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,INDEX reviews_date(created_at,order_id),CHECK(rating BETWEEN 1 AND 5),FOREIGN KEY(order_id) REFERENCES orders(id)) ENGINE=InnoDB;

-- Contas Master independentes das lojas. Nenhum acesso é criado automaticamente.
CREATE TABLE IF NOT EXISTS platform_admins (
 id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,name VARCHAR(120) NOT NULL,email VARCHAR(254) NOT NULL UNIQUE,
 password_hash VARCHAR(200) NOT NULL,active BOOLEAN NOT NULL DEFAULT TRUE,created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS platform_sessions (
 token_hash CHAR(64) PRIMARY KEY,admin_id INT UNSIGNED NOT NULL,expires_at DATETIME NOT NULL,
 INDEX(expires_at),FOREIGN KEY(admin_id) REFERENCES platform_admins(id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS platform_audit (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,admin_id INT UNSIGNED NOT NULL,action VARCHAR(50) NOT NULL,
 entity_id VARCHAR(80) NOT NULL,details JSON NOT NULL,created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 INDEX(created_at,id),FOREIGN KEY(admin_id) REFERENCES platform_admins(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS platform_tenant_profiles (company_id INT UNSIGNED PRIMARY KEY, cnpj VARCHAR(32) NULL UNIQUE, FOREIGN KEY(company_id) REFERENCES companies(id)) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS platform_impersonations (
 id CHAR(64) PRIMARY KEY,cookie_hash CHAR(64) NULL UNIQUE,admin_id INT UNSIGNED NOT NULL,
 master_session_hash CHAR(64) NOT NULL,company_id INT UNSIGNED NOT NULL,owner_id INT UNSIGNED NOT NULL,
 exchanged BOOLEAN NOT NULL DEFAULT FALSE,expires_at DATETIME NOT NULL,created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 INDEX(expires_at),FOREIGN KEY(admin_id) REFERENCES platform_admins(id) ON DELETE CASCADE,
 FOREIGN KEY(master_session_hash) REFERENCES platform_sessions(token_hash) ON DELETE CASCADE,
 FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE CASCADE,
 FOREIGN KEY(owner_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS store_images (
 company_id INT UNSIGNED NOT NULL,kind ENUM('banner','logo') NOT NULL,content_type VARCHAR(32) NOT NULL,
 content MEDIUMBLOB NOT NULL,digest CHAR(64) NOT NULL,PRIMARY KEY(company_id,kind),
 FOREIGN KEY(company_id) REFERENCES companies(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS whatsapp_initial_replies (
 inbox_id BIGINT UNSIGNED PRIMARY KEY,
 state ENUM('uncertain','accepted','rejected') NOT NULL,
 provider_message_id VARCHAR(255) NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY (inbox_id) REFERENCES company_whatsapp_inbox(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS whatsapp_carts (
 company_id INT UNSIGNED NOT NULL,
 phone_number_id VARCHAR(24) NOT NULL,
 sender VARCHAR(20) NOT NULL,
 items JSON NOT NULL,
 quote JSON NULL,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 PRIMARY KEY (company_id, phone_number_id, sender),
 FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS whatsapp_handoffs (
 company_id INT UNSIGNED NOT NULL,
 phone_number_id VARCHAR(24) NOT NULL,
 sender VARCHAR(20) NOT NULL,
 state ENUM('waiting','human','bot') NOT NULL,
 actor_id BIGINT UNSIGNED NULL,
 skip_through BIGINT UNSIGNED NOT NULL DEFAULT 0,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 PRIMARY KEY (company_id, phone_number_id, sender),
 FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS whatsapp_human_replies (
 company_id INT UNSIGNED NOT NULL,
 phone_number_id VARCHAR(24) NOT NULL,
 sender VARCHAR(20) NOT NULL,
 request_key CHAR(36) NOT NULL,
 actor_id BIGINT UNSIGNED NOT NULL,
 body TEXT CHARACTER SET utf8mb4 NOT NULL,
 state ENUM('uncertain','accepted','rejected') NOT NULL,
 provider_message_id VARCHAR(255) NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY (company_id, phone_number_id, sender, request_key),
 FOREIGN KEY (company_id, phone_number_id, sender)
   REFERENCES whatsapp_handoffs(company_id, phone_number_id, sender) ON DELETE CASCADE
) ENGINE=InnoDB;
