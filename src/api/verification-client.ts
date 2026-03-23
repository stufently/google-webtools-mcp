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

  private normalizeSite(siteUrl: string): { type: string; identifier: string } {
    if (siteUrl.startsWith('sc-domain:')) {
      return { type: 'INET_DOMAIN', identifier: siteUrl.replace('sc-domain:', '') };
    }
    if (siteUrl.startsWith('http')) {
      return { type: 'SITE', identifier: siteUrl };
    }
    // Bare domain
    return { type: 'INET_DOMAIN', identifier: siteUrl };
  }

  async getToken(siteUrl: string, method: string): Promise<VerificationToken> {
    await this.rateLimiter.acquire();
    const { type, identifier } = this.normalizeSite(siteUrl);

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
    const { type, identifier } = this.normalizeSite(siteUrl);

    const res = await this.verification.webResource.insert({
      verificationMethod: method,
      requestBody: {
        site: { type, identifier },
      },
    });
    return {
      success: true,
      owners: res.data.owners ?? [],
    };
  }
}
