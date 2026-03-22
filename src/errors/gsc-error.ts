/**
 * Custom error classes for the Google Search Console MCP server.
 *
 * All domain errors extend GscError, which carries a machine-readable code,
 * an HTTP-style statusCode, and a human-readable recoveryHint that tells the
 * caller what they can do to fix the problem.
 */

export type GscErrorCode =
  | "AUTHENTICATION_ERROR"
  | "AUTHORIZATION_ERROR"
  | "NOT_FOUND"
  | "QUOTA_EXCEEDED"
  | "VALIDATION_ERROR"
  | "API_ERROR";

export interface GscErrorOptions {
  code: GscErrorCode;
  statusCode: number;
  recoveryHint?: string;
  cause?: unknown;
}

/**
 * Base error for every error originating from the GSC MCP server.
 */
export class GscError extends Error {
  readonly code: GscErrorCode;
  readonly statusCode: number;
  readonly recoveryHint: string | undefined;

  constructor(message: string, options: GscErrorOptions) {
    super(message);
    this.name = "GscError";
    this.code = options.code;
    this.statusCode = options.statusCode;
    this.recoveryHint = options.recoveryHint;

    if (options.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }

    // Maintain correct prototype chain for instanceof checks after transpilation.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * 401 - The provided credentials are missing or invalid.
 */
export class AuthenticationError extends GscError {
  constructor(
    message = "Authentication failed.",
    options?: { recoveryHint?: string; cause?: unknown },
  ) {
    super(message, {
      code: "AUTHENTICATION_ERROR",
      statusCode: 401,
      recoveryHint:
        options?.recoveryHint ??
        "Credentials invalid. Check GOOGLE_APPLICATION_CREDENTIALS path.",
      cause: options?.cause,
    });
    this.name = "AuthenticationError";
  }
}

/**
 * 403 - The authenticated principal lacks permission for the requested resource.
 */
export class AuthorizationError extends GscError {
  constructor(
    message = "Insufficient permissions.",
    options?: { recoveryHint?: string; cause?: unknown },
  ) {
    super(message, {
      code: "AUTHORIZATION_ERROR",
      statusCode: 403,
      recoveryHint:
        options?.recoveryHint ??
        "Service account lacks access. Add it in Search Console \u2192 Settings \u2192 Users.",
      cause: options?.cause,
    });
    this.name = "AuthorizationError";
  }
}

/**
 * 404 - The requested property or resource does not exist.
 */
export class NotFoundError extends GscError {
  constructor(
    message = "Resource not found.",
    options?: { recoveryHint?: string; cause?: unknown },
  ) {
    super(message, {
      code: "NOT_FOUND",
      statusCode: 404,
      recoveryHint:
        options?.recoveryHint ??
        "Property not found. Run list_properties to see exact URLs.",
      cause: options?.cause,
    });
    this.name = "NotFoundError";
  }
}

/**
 * 429 - The API quota or rate limit has been exceeded.
 */
export class QuotaExceededError extends GscError {
  constructor(
    message = "API quota exceeded.",
    options?: { recoveryHint?: string; cause?: unknown },
  ) {
    super(message, {
      code: "QUOTA_EXCEEDED",
      statusCode: 429,
      recoveryHint:
        options?.recoveryHint ??
        "API quota exceeded. Waiting and retrying.",
      cause: options?.cause,
    });
    this.name = "QuotaExceededError";
  }
}

/**
 * Input validation error (e.g. Zod parse failure, bad date range, etc.).
 */
export class ValidationError extends GscError {
  readonly fieldErrors: Record<string, string[]>;

  constructor(
    message = "Input validation failed.",
    options?: {
      recoveryHint?: string;
      cause?: unknown;
      fieldErrors?: Record<string, string[]>;
    },
  ) {
    super(message, {
      code: "VALIDATION_ERROR",
      statusCode: 400,
      recoveryHint:
        options?.recoveryHint ?? "Check the input parameters and try again.",
      cause: options?.cause,
    });
    this.name = "ValidationError";
    this.fieldErrors = options?.fieldErrors ?? {};
  }
}

/**
 * Catch-all for unexpected Google API errors that don't map to a more specific class.
 */
export class ApiError extends GscError {
  constructor(
    message = "An unexpected API error occurred.",
    options?: { statusCode?: number; recoveryHint?: string; cause?: unknown },
  ) {
    super(message, {
      code: "API_ERROR",
      statusCode: options?.statusCode ?? 500,
      recoveryHint:
        options?.recoveryHint ??
        "An unexpected error occurred. Check server logs for details.",
      cause: options?.cause,
    });
    this.name = "ApiError";
  }
}
