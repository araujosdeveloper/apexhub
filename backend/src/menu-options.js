// Projeção relacional sincronizada na MESMA transação da configuração de checkout.
// O chamador mantém o bloqueio do produto e valida o tenant antes de chamar.
async function syncOptions(conn,tenantId,productId,groups){
 const options=groups.flatMap(group=>group.options.map(option=>({...option,group:group.id})));
 for(const option of options)await conn.execute(`INSERT INTO product_options(tenant_id,product_id,group_key,option_key,name,additional_price,max_quantity,is_active)
 VALUES (?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE group_key=VALUES(group_key),name=VALUES(name),additional_price=VALUES(additional_price),max_quantity=VALUES(max_quantity),is_active=VALUES(is_active)`,[tenantId,productId,option.group,option.id,option.name,option.price,option.max_quantity || 1,option.active]);
 await conn.execute(`DELETE FROM product_options WHERE tenant_id=? AND product_id=?${options.length?' AND option_key NOT IN ('+options.map(()=>'?').join(',')+')':''}`,[tenantId,productId,...options.map(o=>o.id)]);
}
module.exports={syncOptions};
