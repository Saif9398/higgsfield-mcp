import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey, type JWTPayload } from 'jose';
import type { RequestHandler } from 'express';
import type { Config } from './config.js';

export function protectedResource(config: Config) {
  return {
    resource: `${config.PUBLIC_URL?.replace(/\/$/, '')}/mcp`,
    authorization_servers: [config.OAUTH_ISSUER],
    scopes_supported: [config.OAUTH_SCOPE],
    bearer_methods_supported: ['header'],
  };
}

export function createTokenVerifier(config: Config, key?: JWTVerifyGetKey) {
  const keys = key ?? createRemoteJWKSet(new URL(config.OAUTH_JWKS_URL!), { timeoutDuration: 5000, cooldownDuration: 30_000 });
  return async (token: string): Promise<JWTPayload> => {
    const { payload } = await jwtVerify(token, keys, {
      issuer: config.OAUTH_ISSUER,
      audience: protectedResource(config).resource,
      algorithms: ['RS256', 'ES256'],
      requiredClaims: ['exp', 'iat', 'sub'],
      clockTolerance: 5,
    });
    return payload;
  };
}

export function authMiddleware(config: Config, verify = createTokenVerifier(config)): RequestHandler {
  const base = config.PUBLIC_URL!.replace(/\/$/, '');
  const subjects = new Set(config.OAUTH_ALLOWED_SUBJECTS!.split(',').map(s => s.trim()).filter(Boolean));
  return async (req, res, next) => {
    const challenge = `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource", scope="${config.OAUTH_SCOPE}"`;
    const match = /^Bearer ([^\s]+)$/i.exec(req.headers.authorization ?? '');
    if (!match?.[1]) { res.set('WWW-Authenticate', challenge).status(401).json({ error: 'unauthorized' }); return; }
    try {
      const payload = await verify(match[1]);
      if (!payload.sub || !subjects.has(payload.sub)) { res.status(403).json({ error: 'access_denied' }); return; }
      const scopes = typeof payload.scope === 'string' ? payload.scope.split(' ') : [];
      if (!scopes.includes(config.OAUTH_SCOPE)) {
        res.set('WWW-Authenticate', `${challenge}, error="insufficient_scope"`).status(403).json({ error: 'insufficient_scope' }); return;
      }
      next();
    } catch {
      res.set('WWW-Authenticate', `${challenge}, error="invalid_token"`).status(401).json({ error: 'invalid_token' });
    }
  };
}
