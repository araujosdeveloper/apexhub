const express=require('express');
const {createHash}=require('node:crypto');
const {asyncRoute}=require('./auth');
const MAX_BYTES=2*1024*1024;
function imageInfo(buffer){
 if(!Buffer.isBuffer(buffer)||!buffer.length||buffer.length>MAX_BYTES)throw new Error('Envie uma imagem JPG, PNG ou WebP de até 2 MB.');
 let type,width,height;
 if(buffer.length>=33&&buffer.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))&&buffer.readUInt32BE(8)===13&&buffer.toString('ascii',12,16)==='IHDR'){
  type='image/png';width=buffer.readUInt32BE(16);height=buffer.readUInt32BE(20);
 }else if(buffer.length>=12&&buffer[0]===255&&buffer[1]===216){
  let offset=2;
  while(offset+4<=buffer.length){if(buffer[offset++]!==255)break;while(buffer[offset]===255)offset++;const marker=buffer[offset++];if(marker===0xd9||marker===0xda)break;if(marker===0x01||marker>=0xd0&&marker<=0xd7)continue;
   if(offset+2>buffer.length)break;const length=buffer.readUInt16BE(offset);if(length<2||offset+length>buffer.length)break;
   if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)&&length>=8){height=buffer.readUInt16BE(offset+3);width=buffer.readUInt16BE(offset+5);type='image/jpeg';break;}offset+=length;
  }
 }else if(buffer.length>=20&&buffer.toString('ascii',0,4)==='RIFF'&&buffer.toString('ascii',8,12)==='WEBP'&&buffer.readUInt32LE(4)+8===buffer.length){
  const chunk=buffer.toString('ascii',12,16);
  if(chunk==='VP8X'&&buffer.length>=30&&buffer.readUInt32LE(16)===10){width=1+buffer.readUIntLE(24,3);height=1+buffer.readUIntLE(27,3);type='image/webp';}
  if(chunk==='VP8 '&&buffer.length>=30&&buffer[23]===0x9d&&buffer[24]===0x01&&buffer[25]===0x2a){width=buffer.readUInt16LE(26)&0x3fff;height=buffer.readUInt16LE(28)&0x3fff;type='image/webp';}
  if(chunk==='VP8L'&&buffer.length>=25&&buffer[20]===0x2f){const bits=buffer.readUInt32LE(21);width=(bits&0x3fff)+1;height=((bits>>>14)&0x3fff)+1;type='image/webp';}
 }
 if(!type||!width||!height||width>8192||height>8192||width*height>32000000)throw new Error('Imagem inválida ou muito grande. Use JPG, PNG ou WebP com até 8192 pixels por lado e 32 megapixels.');
 return {type,digest:createHash('sha256').update(buffer).digest('hex')};
}
function safeImageUrl(value){try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url.href:null;}catch{return null;}}
function withImage(product,admin=false,assistedContext=null){const {image_digest,...rest}=product;return {...rest,image_url:image_digest?`${admin?'/api/admin/products/':'/api/product-images/'}${product.id}${admin?'/image':''}?v=${image_digest}${admin&&assistedContext?'&assisted_context='+encodeURIComponent(assistedContext):''}`:safeImageUrl(product.image_url)};}
function sendImage(req,res,image,admin=false){
 res.set({'Content-Type':image.content_type,'Content-Disposition':'inline','X-Content-Type-Options':'nosniff','Cache-Control':admin?'private, no-store':'public, max-age=0, must-revalidate',ETag:'"'+image.digest+'"'});
 if(!admin&&req.headers['if-none-match']==='"'+image.digest+'"')return res.status(304).end();res.send(image.content);
}
function installProductImages(app,db,auth,manage){
 const idCheck=(req,res,next)=>{const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<1)return res.status(400).json({error:'Produto inválido.'});req.productId=id;next();};
 app.get('/api/product-images/:id',idCheck,asyncRoute(async(req,res)=>{
  const [[image]]=await db.execute(`SELECT i.content_type,i.content,i.digest FROM product_images i JOIN products p ON p.id=i.product_id JOIN categories c ON c.id=p.category_id AND c.company_id=p.company_id JOIN companies co ON co.id=p.company_id WHERE p.id=? AND p.active=1 AND c.active=1 AND co.active=1`,[req.productId]);
  if(!image)return res.status(404).json({error:'Imagem indisponível.'});sendImage(req,res,image);
 }));
 app.get('/api/admin/products/:id/image',auth,manage,idCheck,asyncRoute(async(req,res)=>{
  const [[image]]=await db.execute('SELECT i.content_type,i.content,i.digest FROM product_images i JOIN products p ON p.id=i.product_id WHERE p.id=? AND p.company_id=?',[req.productId,req.tenantId]);
  if(!image)return res.status(404).json({error:'Imagem não encontrada nesta loja.'});sendImage(req,res,image,true);
 }));
 app.put('/api/admin/products/:id/image',auth,manage,idCheck,express.raw({type:['image/jpeg','image/png','image/webp'],limit:MAX_BYTES}),asyncRoute(async(req,res)=>{
  let info;try{info=imageInfo(req.body);if(req.get('content-type')?.split(';')[0]!==info.type)throw new Error('O formato do arquivo não corresponde à imagem.');}catch(e){return res.status(400).json({error:e.message});}
  const conn=await db.getConnection();try{await conn.beginTransaction();const [[product]]=await conn.execute('SELECT id FROM products WHERE id=? AND company_id=? FOR UPDATE',[req.productId,req.tenantId]);if(!product){await conn.rollback();return res.status(404).json({error:'Produto não encontrado nesta loja.'});}
   await conn.execute('INSERT INTO product_images(product_id,content_type,content,digest) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE content_type=VALUES(content_type),content=VALUES(content),digest=VALUES(digest)',[req.productId,info.type,req.body,info.digest]);await conn.commit();res.json({image_url:withImage({id:req.productId,image_digest:info.digest},true,req.auth.impersonation?req.auth.sid:null).image_url});
  }catch(e){await conn.rollback();throw e;}finally{conn.release();}
 }));
 app.delete('/api/admin/products/:id/image',auth,manage,idCheck,asyncRoute(async(req,res)=>{
  const conn=await db.getConnection();try{await conn.beginTransaction();const [[product]]=await conn.execute('SELECT id FROM products WHERE id=? AND company_id=? FOR UPDATE',[req.productId,req.tenantId]);if(!product){await conn.rollback();return res.status(404).json({error:'Produto não encontrado nesta loja.'});}
   await conn.execute('DELETE i FROM product_images i JOIN products p ON p.id=i.product_id WHERE i.product_id=? AND p.company_id=?',[req.productId,req.tenantId]);await conn.commit();res.json({image_url:null});
  }catch(e){await conn.rollback();throw e;}finally{conn.release();}
 }));
}
module.exports={MAX_BYTES,imageInfo,withImage,installProductImages};
