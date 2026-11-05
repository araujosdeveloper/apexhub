// Chaves efêmeras exclusivas dos testes; nunca persistidas ou usadas na aplicação real.
const {randomBytes}=require('node:crypto');
const {configuration}=require('../src/jwt');
function testJwt(){return configuration({JWT_TENANT_SECRET:randomBytes(32).toString('hex'),JWT_MASTER_SECRET:randomBytes(32).toString('hex')});}
module.exports={testJwt};
