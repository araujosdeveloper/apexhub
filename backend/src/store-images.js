const express=require('express');
const {asyncRoute}=require('./auth');
const {MAX_BYTES,imageInfo}=require('./product-images');
const {loadOperations}=require('./operations');
function storeImagePath(companyId,kind,digest){return `/api/store-images/${companyId}/${kind}?v=${digest}`;}
async function uploadedImage(req){
 let form;try{form=await new Response(req.body,{headers:{'Content-Type':req.get('content-type')||''}}).formData();}catch{throw Error('Envie multipart/form-data com a imagem no campo file.');}
 const entries=[...form.entries()];if(entries.length!==1||entries[0][0]!=='file'||typeof entries[0][1]==='string')throw Error('Envie somente uma imagem no campo file.');
 const file=entries[0][1];if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw Error('Use PNG, JPEG ou WebP de até 2 MB.');
 const bytes=Buffer.from(await file.arrayBuffer()),info=imageInfo(bytes);if(info.type!==file.type)throw Error('O formato do arquivo não corresponde à imagem.');return {bytes,...info};
}
function installStoreImages(app,db,auth,manage){
 const kind=(req,res,next)=>{if(!['banner','logo'].includes(req.params.kind))return res.status(400).json({error:'Tipo de imagem inválido.'});next();};
 app.get('/api/store-images/:company/:kind',kind,asyncRoute(async(req,res)=>{
  if(!/^[1-9]\d{0,9}$/.test(req.params.company)||Number(req.params.company)>4294967295)return res.status(400).json({error:'Loja inválida.'});
  const [[image]]=await db.execute('SELECT i.content_type,i.content,i.digest FROM store_images i JOIN companies c ON c.id=i.company_id WHERE i.company_id=? AND i.kind=? AND c.active=1',[Number(req.params.company),req.params.kind]);if(!image)return res.status(404).json({error:'Imagem indisponível.'});
  const etag='"'+image.digest+'"';res.set({'Content-Type':image.content_type,'X-Content-Type-Options':'nosniff','Content-Disposition':'inline','Cache-Control':'public, max-age=0, must-revalidate',ETag:etag});if(req.headers['if-none-match']===etag)return res.status(304).end();res.send(image.content);
 }));
 const mutate=remove=>asyncRoute(async(req,res)=>{
  let image;if(!remove)try{image=await uploadedImage(req);}catch(error){return res.status(400).json({error:error.message});}
  const conn=await db.getConnection();try{await conn.beginTransaction();const [[company]]=await conn.execute('SELECT id FROM companies WHERE id = ? AND active = 1 FOR UPDATE',[req.tenantId]);if(!company){await conn.rollback();return res.status(403).json({error:'Loja indisponível.'});}
   const config=await loadOperations(conn,req.tenantId),profile=require('./store-profile').profileInput(config.store_profile||{});let path='';
   if(remove)await conn.execute('DELETE FROM store_images WHERE company_id=? AND kind=?',[req.tenantId,req.params.kind]);
   else{await conn.execute('INSERT INTO store_images(company_id,kind,content_type,content,digest) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE content_type=VALUES(content_type),content=VALUES(content),digest=VALUES(digest)',[req.tenantId,req.params.kind,image.type,image.bytes,image.digest]);path=storeImagePath(req.tenantId,req.params.kind,image.digest);}
   profile[req.params.kind+'_url']=path;config.store_profile=profile;await conn.execute('INSERT INTO company_operations (company_id, config) VALUES (?, ?) ON DUPLICATE KEY UPDATE config = VALUES(config)',[req.tenantId,JSON.stringify(config)]);await conn.commit();res.json({profile,image_url:path||null});
  }catch(error){await conn.rollback();throw error;}finally{image?.bytes.fill(0);req.body=undefined;conn.release();}
 });
 app.post('/api/admin/store-profile/images/:kind',auth,manage,kind,express.raw({type:()=>true,limit:MAX_BYTES+65536}),mutate(false));
 app.delete('/api/admin/store-profile/images/:kind',auth,manage,kind,mutate(true));
}
module.exports={storeImagePath,uploadedImage,installStoreImages};
