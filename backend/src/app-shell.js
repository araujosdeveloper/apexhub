const path = require('node:path');
// Somente páginas internas conhecidas podem ser carregadas dentro do shell.
const INTERNAL_PAGES = new Set(['dashboard','admin','kitchen','catalog','customers','drivers','coupons','reports','finance','operations','addons','merchandising','reviews','team'].map(name=>'/'+name+'.html'));
function installAppShell(app) {
  app.get([...INTERNAL_PAGES],(req,res,next)=>{
    res.set('X-Frame-Options','SAMEORIGIN');
    res.set('Content-Security-Policy',"frame-ancestors 'self'");
    res.set('Cache-Control','no-store');
    if(req.query.view==='1'||req.get('Sec-Fetch-Dest')==='iframe')return next();
    res.sendFile(path.join(__dirname,'../../frontend/app-shell.html'));
  });
}
module.exports={INTERNAL_PAGES,installAppShell};
