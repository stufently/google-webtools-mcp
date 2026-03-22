import { google } from 'googleapis';
import type { siteVerification_v1 } from 'googleapis';
import type { AuthClient } from '../auth/client-factory.js';
import { RateLimiter } from '../utils/rate-limiter.js';

export interface VerificationToken {
  method: string;
  token: string;
}

export class VerificationApiClient {
  readonly verification: siteVerification_v1.Siteverification;
  readonly rateLimiter: RateLimiter;

  constructor(auth: AuthClient, rateLimiter?: RateLimiter) {
    this.verification = google.siteVerification({ version: 'v1', auth: auth as any });
    this.rateLimiter = rateLimiter ?? new RateLimiter(5, 10);
  }

  async getToken(siteUrl: string, method: string): Promise<VerificationToken> {
    await this.rateLimiter.acquire();
    // Determine if domain or site
    const isDomain = !siteUrl.startsWith('http');
    const type = isDomain ? 'INET_DOMAIN' : 'SITE';
    const identifier = siteUrl;

    const res = await this.verification.webResource.getToken({
      requestBody: {
        site: { type, identifier },
        verificationMethod: method, // FILE, DNS_TXT, META, ANALYTICS
      },
    });
    return {
      method,
      token: res.data.token ?? '',
    };
  }

  async verifySite(siteUrl: string, method: string): Promise<{ success: boolean; owners?: string[] }> {
    await this.rateLimiter.acquire();
    const isDomain = !siteUrl.startsWith('http');
    const type = isDomain ? 'INET_DOMAIN' : 'SITE';

    const res = await this.verification.webResource.insert({
      verificationMethod: method,
      requestBody: {
        site: { type, identifier: siteUrl },
      },
    });
    return {
      success: true,
      owners: res.data.owners ?? [],
    };
  }
}
