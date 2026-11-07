-- Replace the legacy single-unit constraint without changing existing rows.
SET @quantity_check=(SELECT tc.CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS tc JOIN information_schema.CHECK_CONSTRAINTS cc ON cc.CONSTRAINT_SCHEMA=tc.CONSTRAINT_SCHEMA AND cc.CONSTRAINT_NAME=tc.CONSTRAINT_NAME WHERE tc.TABLE_SCHEMA=DATABASE() AND tc.TABLE_NAME='product_options' AND tc.CONSTRAINT_TYPE='CHECK' AND REPLACE(REPLACE(REPLACE(REPLACE(LOWER(cc.CHECK_CLAUSE),'`',''),' ',''),'(',''),')','')='max_quantity=1' LIMIT 1);
SET @quantity_ddl=CONCAT('ALTER TABLE product_options ',IF(@quantity_check IS NULL,'',CONCAT('DROP CHECK `',REPLACE(@quantity_check,'`','``'),'`, ')),'ADD CONSTRAINT product_options_quantity_range CHECK(max_quantity BETWEEN 1 AND 20)');
PREPARE quantity_statement FROM @quantity_ddl;
EXECUTE quantity_statement;
DEALLOCATE PREPARE quantity_statement;
