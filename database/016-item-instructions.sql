-- Observações pertencem à linha, preservando os pedidos anteriores.
ALTER TABLE order_items ADD COLUMN item_notes VARCHAR(500) NOT NULL DEFAULT '';
