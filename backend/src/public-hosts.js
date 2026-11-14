'use strict';

const RESERVED = new Set(['admin', 'api', 'app', 'master', 'www']);

function configuredDomain() {
  const value = String(process.env.PUBLIC_BASE_DOMAIN || 'apexdelivery.com.br').trim().toLowerCase();
  return /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(value)
    ? value
    : 'apexdelivery.com.br';
}

function hostName(reqOrHost) {
  const value = typeof reqOrHost === 'string' ? reqOrHost : reqOrHost?.hostname;
  return String(value || '').trim().toLowerCase().replace(/\.$/, '');
}

function isRootHost(reqOrHost) {
  const host = hostName(reqOrHost), domain = configuredDomain();
  return host === domain || host === `www.${domain}`;
}

function isMasterHost(reqOrHost) {
  return hostName(reqOrHost) === `admin.${configuredDomain()}`;
}

function tenantSlugFromHost(reqOrHost) {
  const host = hostName(reqOrHost), suffix = `.${configuredDomain()}`;
  if (!host.endsWith(suffix)) return null;
  const slug = host.slice(0, -suffix.length);
  if (RESERVED.has(slug) || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(slug)) return null;
  return slug;
}

function identityMatchesHost(req, scope, user) {
  if (isMasterHost(req)) return scope === 'master';
  const tenantSlug = tenantSlugFromHost(req);
  if (tenantSlug) return scope === 'tenant' && user?.slug === tenantSlug;
  return true;
}

module.exports = { RESERVED, configuredDomain, hostName, isRootHost, isMasterHost, tenantSlugFromHost, identityMatchesHost };
