const {test}=require('node:test');
const assert=require('node:assert/strict');
const {serve}=require('../test-support/http');
const {imageInfo,withImage,MAX_BYTES}=require('../src/product-images');
const {snapshot}=require('../src/live-update');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=','base64');
const headers={Cookie:'delivery_session='+'a'.repeat(64)};
function fake({role='owner',missing=false,fail=false}={}){const calls=[];async function execute(sql,args){calls.push({sql,args});
 if(sql.includes('FROM sessions s'))return [[{id:1,company_id:7,role}]];
 if(sql.startsWith('SELECT id FROM products'))return [missing?[]:[{id:3}]];
 if(sql.startsWith('SELECT i.content_type'))return [missing?[]:[{content:png,content_type:'image/png',digest:imageInfo(png).digest}]];
 if(sql.startsWith('INSERT INTO product_images')||sql.startsWith('DELETE FROM product_images')){if(fail)throw new Error('Falha');return [{affectedRows:1}];}throw new Error(sql);
 }return {calls,execute,getConnection:async()=>({execute,beginTransaction:async()=>calls.push('begin'),commit:async()=>calls.push('commit'),rollback:async()=>calls.push('rollback'),release:()=>calls.push('release')})};}
test('fotos: identifica PNG/JPEG/WebP pelos bytes e limita tamanho e dimensões',()=>{
 assert.equal(imageInfo(png).type,'image/png');assert.match(imageInfo(png).digest,/^[a-f0-9]{64}$/);
 const jpeg=Buffer.from([255,216,255,192,0,8,8,0,10,0,20,0]);assert.equal(imageInfo(jpeg).type,'image/jpeg');
 const webp=Buffer.alloc(30);webp.write('RIFF');webp.writeUInt32LE(22,4);webp.write('WEBPVP8X',8);webp.writeUInt32LE(10,16);assert.equal(imageInfo(webp).type,'image/webp');
 const tooWide=Buffer.from(png);tooWide.writeUInt32BE(100000,16);
 for(const bytes of [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),Buffer.from('texto'),Buffer.alloc(MAX_BYTES+1),tooWide,Buffer.alloc(0)])assert.throws(()=>imageInfo(bytes));
 assert.equal(withImage({id:3}).image_url,null);assert.equal(withImage({id:3,image_digest:'a'.repeat(64)}).image_url,'/api/product-images/3?v='+'a'.repeat(64));
});
test('fotos: dono/gerente envia imagem binária com isolamento e transação',async t=>{
 const db=fake({role:'manager'}),r=await serve(t,db),response=await r('/api/admin/products/3/image',{method:'PUT',headers:{...headers,'Content-Type':'image/png'},body:png});assert.equal(response.status,200);assert.match((await response.json()).image_url,/^\/api\/admin\/products\/3\/image\?v=/);
 assert.deepEqual(db.calls.find(c=>c.sql?.startsWith('SELECT id FROM products')).args,[3,7]);const insert=db.calls.find(c=>c.sql?.startsWith('INSERT'));assert.deepEqual(insert.args.slice(0,2),[3,'image/png']);assert.deepEqual(insert.args[2],png);assert.deepEqual(db.calls.slice(-2),['commit','release']);
});
test('fotos: operador e sessão ausente não enviam/removem ou consultam prévia privada',async t=>{
 const db=fake({role:'operator'}),r=await serve(t,db);for(const method of ['PUT','DELETE','GET']){assert.equal((await r('/api/admin/products/3/image',{method})).status,401);assert.equal((await r('/api/admin/products/3/image',{method,headers})).status,403);}assert.equal(db.calls.some(c=>c==='begin'),false);
});
test('fotos: MIME falso, SVG e excesso de bytes são recusados antes da gravação',async t=>{
 const db=fake(),r=await serve(t,db);for(const [type,body,status]of [['image/jpeg',png,400],['image/svg+xml',Buffer.from('<svg/>'),400],['image/png',Buffer.alloc(MAX_BYTES+1),413]]){assert.equal((await r('/api/admin/products/3/image',{method:'PUT',headers:{...headers,'Content-Type':type},body})).status,status);}assert.equal(db.calls.some(c=>c==='begin'),false);
});
test('fotos: produto de outra loja e falhas liberam conexão sem publicar imagem',async t=>{
 for(const [options,status]of [[{missing:true},404],[{fail:true},500]]){const db=fake(options),r=await serve(t,db);assert.equal((await r('/api/admin/products/999/image',{method:'PUT',headers:{...headers,'Content-Type':'image/png'},body:png})).status,status);assert.deepEqual(db.calls.slice(-2),['rollback','release']);}
});
test('fotos: leitura pública usa bytes/MIME corretos, disponibilidade e revalidação ETag',async t=>{
 const db=fake(),r=await serve(t,db),response=await r('/api/product-images/3');assert.equal(response.status,200);assert.equal(response.headers['content-type'],'image/png');assert.deepEqual(await response.arrayBuffer(),png);assert.equal(response.headers['x-content-type-options'],'nosniff');assert.match(db.calls[0].sql,/p.active=1 AND c.active=1 AND co.active=1/);
 const cached=await r('/api/product-images/3',{headers:{'If-None-Match':response.headers.etag}});assert.equal(cached.status,304);
 const missing=await serve(t,fake({missing:true}));assert.equal((await missing('/api/product-images/3')).status,404);
});
test('fotos: remover não apaga produto e consulta privada limita empresa',async t=>{
 const db=fake(),r=await serve(t,db);assert.equal((await r('/api/admin/products/3/image',{headers})).status,200);assert.deepEqual(db.calls.find(c=>c.sql?.startsWith('SELECT i.')).args,[3,7]);assert.equal((await r('/api/admin/products/3/image',{method:'DELETE',headers})).status,200);assert.deepEqual(db.calls.find(c=>c.sql?.startsWith('DELETE')).args,[3]);assert.equal(db.calls.some(c=>c.sql?.startsWith('DELETE FROM products')),false);
});
test('preservação: fotografia BLOB é conferida por hash SQL sem carregar bytes no processo',async()=>{
 const calls=[];const db={query:async(sql)=>{calls.push(sql);return sql.includes('information_schema.STATISTICS')?[[{name:'product_id'}]]:[[{product_id:3,content:'digest-do-conteudo'}]];}};
 const schema={tables:[{name:'product_images'}],columns:[{table_name:'product_images',column_name:'product_id',column_type:'int'},{table_name:'product_images',column_name:'content',column_type:'mediumblob'}]};const result=await snapshot(db,schema);assert.equal(result.product_images.rows,1);assert.match(calls[1],/SHA2\(`content`,256\) AS `content`/);
});
