-- Registra solicitações de contratação sem liberar recursos antes da ativação.
CREATE TABLE IF NOT EXISTS subscription_plan_requests (
 company_id INT PRIMARY KEY,
 plan_code ENUM('essencial','pro') NOT NULL,
 status ENUM('pending','accepted','declined') NOT NULL DEFAULT 'pending',
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
) ENGINE=InnoDB;
