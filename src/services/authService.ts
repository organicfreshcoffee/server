import { traceHttpRequest, addSpanAttributes, addSpanEvent } from '../config/tracing';

interface AuthResponse {
  authenticated: boolean;
  user?: {
    uid: string;
    email?: string;
    name?: string;
    emailVerified?: boolean;
  };
  message?: string;
}

export class AuthService {
  private readonly authServerUrl: string;

  constructor() {
    this.authServerUrl = process.env.AUTH_SERVER_URL || 'http://localhost:3001';
  }

  async verifyToken(token: string): Promise<{ uid: string; email?: string; name?: string } | null> {
    return traceHttpRequest('GET', `${this.authServerUrl}/api/verify`, async () => {
      try {
        console.log('[AuthService] Verifying token with auth server:', this.authServerUrl);
        console.log('[AuthService] Token (first 20 chars):', token?.substring(0, 20) + '...');
        
        addSpanAttributes({
          'auth.server.url': this.authServerUrl,
          'auth.token.length': token?.length || 0,
        });
        
        const response = await fetch(`${this.authServerUrl}/api/verify`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        });

        addSpanAttributes({
          'http.response.status_code': response.status,
          'http.response.content_type': response.headers.get('content-type') || '',
        });

        console.log('[AuthService] Auth server response status:', response.status);
        console.log('[AuthService] Auth server response content-type:', response.headers.get('content-type'));

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`[AuthService] Auth server responded with status: ${response.status}, body:`, errorText);
          addSpanEvent('auth.verification.failed', {
            'error.status': response.status,
            'error.message': errorText,
          });
          return null;
        }

        const data: AuthResponse = await response.json();
        console.log('[AuthService] Auth server response data:', JSON.stringify(data, null, 2));
        
        if (data.authenticated && data.user) {
          console.log('[AuthService] Token verification successful for user:', data.user.uid);
          addSpanAttributes({
            'auth.user.uid': data.user.uid,
            'auth.user.email': data.user.email || '',
            'auth.verification.success': true,
          });
          return {
            uid: data.user.uid,
            email: data.user.email,
            name: data.user.name,
          };
        }

        console.log('[AuthService] Token verification failed - no user in response or authenticated=false');
        addSpanEvent('auth.verification.failed', {
          'error.reason': 'invalid_credentials',
        });
        return null;
      } catch (error) {
        console.error('[AuthService] Error verifying token with auth server:', error);
        addSpanEvent('auth.verification.error', {
          'error.message': error instanceof Error ? error.message : 'Unknown error',
        });
        return null;
      }
    });
  }
}
