interface AuthResponse {
  success: boolean;
  user?: {
    uid: string;
    email?: string;
    name?: string;
  };
  message?: string;
}

export class AuthService {
  private readonly authServerUrl: string;

  constructor() {
    this.authServerUrl = process.env.AUTH_SERVER_URL || 'http://localhost:3001';
  }

  async verifyToken(token: string): Promise<{ uid: string; email?: string; name?: string } | null> {
    try {
      const response = await fetch(`${this.authServerUrl}/api/auth/verify`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        console.error(`Auth server responded with status: ${response.status}`);
        return null;
      }

      const data: AuthResponse = await response.json();
      
      if (data.success && data.user) {
        return {
          uid: data.user.uid,
          email: data.user.email,
          name: data.user.name,
        };
      }

      return null;
    } catch (error) {
      console.error('Error verifying token with auth server:', error);
      return null;
    }
  }
}
