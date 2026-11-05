const assert=require('node:assert/strict');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=','base64');
async function verifyProductImages(db,request,{a,b,productId,json}){
 const [[identity]]=await db.query('SELECT DATABASE() AS name');assert.match(identity.name,/_test$/);
 const upload=cookie=>request('/api/admin/products/'+productId+'/image',{method:'PUT',headers:{Cookie:cookie,'Content-Type':'image/png'},body:png});
 assert.equal((await upload(b.cookie)).status,404);assert.equal((await upload(a.cookie)).status,200);
 const catalog=await request('/api/admin/catalog',{headers:{Cookie:a.cookie}});assert.equal(catalog.status,200);const adminProduct=(await catalog.json()).products.find(p=>p.id===productId);assert.match(adminProduct.image_url,/^\/api\/admin\/products\//);
 const privateImage=await request(adminProduct.image_url,{headers:{Cookie:a.cookie}});assert.equal(privateImage.status,200);assert.deepEqual(await privateImage.arrayBuffer(),png);
 assert.equal((await request(adminProduct.image_url,{headers:{Cookie:b.cookie}})).status,404);
 let menu=await request('/api/menu/'+a.slug);assert.equal(menu.status,200);let product=(await menu.json()).products.find(p=>p.id===productId);assert.match(product.image_url,/^\/api\/product-images\//);
 const image=await request(product.image_url);assert.equal(image.status,200);assert.equal(image.headers['content-type'],'image/png');assert.deepEqual(await image.arrayBuffer(),png);
 await db.execute('UPDATE products SET active=0 WHERE id=? AND company_id=?',[productId,a.id]);assert.equal((await request(product.image_url)).status,404);assert.equal((await request(adminProduct.image_url,{headers:{Cookie:a.cookie}})).status,200);
 await db.execute('UPDATE products SET active=1 WHERE id=? AND company_id=?',[productId,a.id]);
 const [[category]]=await db.execute('SELECT category_id FROM products WHERE id=? AND company_id=?',[productId,a.id]);
 await db.execute('UPDATE categories SET active=0 WHERE id=? AND company_id=?',[category.category_id,a.id]);assert.equal((await request(product.image_url)).status,404);assert.equal((await upload(a.cookie)).status,200);
 const edit=await request('/api/admin/products/'+productId,json('PUT',{name:adminProduct.name,description:adminProduct.description||'',category_id:category.category_id,price:adminProduct.price},a.cookie));assert.equal(edit.status,200);
 await db.execute('UPDATE categories SET active=1 WHERE id=? AND company_id=?',[category.category_id,a.id]);
 assert.equal((await request('/api/admin/products/'+productId+'/image',{method:'DELETE',headers:{Cookie:b.cookie}})).status,404);
 assert.equal((await request('/api/admin/products/'+productId+'/image',{method:'DELETE',headers:{Cookie:a.cookie}})).status,200);
 assert.equal((await request(product.image_url)).status,404);menu=await request('/api/menu/'+a.slug);assert.equal((await menu.json()).products.find(p=>p.id===productId).image_url,null);
 // Deixa uma foto persistida para a auditoria final do esquema e limpeza por empresa.
 assert.equal((await upload(a.cookie)).status,200);const [[stored]]=await db.execute('SELECT content FROM product_images WHERE product_id=?',[productId]);assert.deepEqual(stored.content,png);
}
module.exports={verifyProductImages,png};
