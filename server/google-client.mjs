import { OAuth2Client } from 'google-auth-library';

// Native Workers fetch avoids reliance on Node's outbound HTTP adapter.
export function createGoogleClient(fetchImplementation = fetch) {
    return new OAuth2Client({ transporterOptions: { fetchImplementation, timeout: 10000 } });
}
