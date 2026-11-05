-- Aplicar após 001 (ou após migração equivalente do banco legado).
-- Os IDs devem ter os mesmos tipos das tabelas referenciadas.
CREATE TABLE IF NOT EXISTS checkout_requests (
 company_id INT UNSIGNED NOT NULL,
 request_key VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 order_id INT UNSIGNED NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY (company_id, request_key),
 FOREIGN KEY (company_id) REFERENCES companies(id),
 FOREIGN KEY (order_id) REFERENCES orders(id)
) ENGINE=InnoDB;
