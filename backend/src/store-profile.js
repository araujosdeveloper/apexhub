const {asyncRoute}=require('./auth');
function profileInput(body){
 if(!body||typeof body!=='object'||Array.isArray(body))throw Error('Informe a apresentação da loja.');
 const result={};for(const [key,max]of [['banner_url',2048],['logo_url',2048],['address',320],['phone',15],['notice',500]]){
  const value=body[key]??'';if(typeof value!=='string'||value.length>max)throw Error('Confira os dados da apresentação da loja.');result[key]=value.trim();
 }
 for(const key of ['banner_url','logo_url'])if(result[key]){if(/^\/api\/store-images\/[1-9]\d{0,9}\/(?:banner|logo)\?v=[a-f0-9]{64}$/.test(result[key]))continue;let url;try{url=new URL(result[key]);}catch{throw Error('Use links HTTPS válidos para capa e logo.');}if(url.protocol!=='https:'||url.username||url.password||url.href.length>2048)throw Error('Use links HTTPS sem credenciais para capa e logo.');result[key]=url.href;}
 if(result.phone&&!/^\d{10,15}$/.test(result.phone))throw Error('Informe telefone com país e DDD, somente números (10 a 15 dígitos).');
 for(const key of ['email','instagram_url','facebook_url'])if(body[key]!==undefined){const value=body[key];if(typeof value!=='string'||value.length>(key==='email'?254:2048))throw Error('Confira e-mail e redes sociais.');result[key]=value.trim();}
 if(result.email&&!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(result.email))throw Error('Informe um e-mail válido.');
 for(const [key,hosts]of [['instagram_url',['instagram.com','www.instagram.com']],['facebook_url',['facebook.com','www.facebook.com','m.facebook.com']]])if(result[key]){let url;try{url=new URL(result[key]);}catch{throw Error('Informe um link HTTPS válido da rede social.');}if(url.protocol!=='https:'||url.username||url.password||!hosts.includes(url.hostname)||url.href.length>2048)throw Error('Confira o endereço HTTPS da rede social.');result[key]=url.href;}
 return result;
}
function installStoreProfile(app,db,auth,manage){
 app.get('/api/admin/store-profile',auth,manage,asyncRoute(async(req,res)=>{const {loadOperations}=require('./operations');const config=await loadOperations(db,req.tenantId);res.json({profile:profileInput(config.store_profile||{})});}));
 app.put('/api/admin/store-profile',auth,manage,asyncRoute(async(req,res)=>{
  let profile;try{profile=profileInput(req.body);}catch(error){return res.status(400).json({error:error.message});}
  const conn=await db.getConnection();try{await conn.beginTransaction();const [[company]]=await conn.execute('SELECT id FROM companies WHERE id = ? AND active = 1 FOR UPDATE',[req.tenantId]);if(!company){await conn.rollback();return res.status(403).json({error:'Loja indisponível.'});}
   const config=await require('./operations').loadOperations(conn,req.tenantId);profile=profileInput({...config.store_profile,...req.body});
   for(const [field,kind]of [['banner_url','banner'],['logo_url','logo']])if(profile[field].startsWith('/api/')&&!profile[field].startsWith('/api/store-images/'+req.tenantId+'/'+kind+'?')){await conn.rollback();return res.status(400).json({error:'A imagem não pertence à apresentação desta loja.'});}
   config.store_profile=profile;
   await conn.execute('INSERT INTO company_operations (company_id, config) VALUES (?, ?) ON DUPLICATE KEY UPDATE config = VALUES(config)',[req.tenantId,JSON.stringify(config)]);await conn.commit();res.json({profile});
  }catch(error){await conn.rollback();throw error;}finally{conn.release();}
 }));
}
module.exports={profileInput,installStoreProfile};
