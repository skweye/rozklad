import { OAuth2Client } from 'google-auth-library';

// Native Workers fetch avoids reliance on Node's outbound HTTP adapter.
export function createGoogleClient(fetchImplementation = fetch) {
    return new OAuth2Client({ transporterOptions: { fetchImplementation, timeout: 10000 } });
}

export async function loadGoogleProfile(token, fetchImplementation = fetch) {
    const response = await fetchImplementation('https://openidconnect.googleapis.com/v1/userinfo', {
        headers: { Authorization: `Bearer ${token}` },
        // Workers rejects redirect: 'error'. Manual mode never forwards the bearer token.
        signal: AbortSignal.timeout(10000), redirect: 'manual'
    });
    if (!response.ok) {
        const error = new Error('google_profile_unavailable');
        // Reject redirects as well as HTTP failures; retain no body, headers or URL.
        error.response = { status: response.status };
        throw error;
    }
    return response.json();
}
