import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';

// Offline certificates exercise the real library, without a real Google account.
test('Google library checks signature, audience, issuer and expiration', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const google = new OAuth2Client();
    google.getFederatedSignonCertsAsync = async () => ({ certs: {
        test: publicKey.export({ type: 'spki', format: 'pem' })
    } });
    const now = Math.floor(Date.now() / 1000);
    const claims = { sub: 'test', aud: 'client.apps.googleusercontent.com', iss: 'https://accounts.google.com', iat: now, exp: now + 3600 };
    const token = payload => {
        const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test' })).toString('base64url');
        const body = `${header}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
        return `${body}.${sign('RSA-SHA256', Buffer.from(body), privateKey).toString('base64url')}`;
    };
    const verify = idToken => google.verifyIdToken({ idToken, audience: claims.aud });
    assert.equal((await verify(token(claims))).getPayload().sub, 'test');
    await assert.rejects(verify(token({ ...claims, aud: 'another-client' })));
    await assert.rejects(verify(token({ ...claims, iss: 'https://attacker.example' })));
    await assert.rejects(verify(token({ ...claims, iat: now - 7200, exp: now - 3600 })));
    const valid = token(claims).split('.');
    valid[1] = Buffer.from(JSON.stringify({ ...claims, sub: 'forged' })).toString('base64url');
    await assert.rejects(verify(valid.join('.')));
});
