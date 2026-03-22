/**
 * Error handling utilities that convert raw Google API / Zod errors into
 * well-typed GscError instances and MCP-friendly response payloads.
 */

import { ZodError } from "zod";
import {
  ApiError,
  AuthenticationError,
  AuthorizationError,
  GscError,
  NotFoundError,
  QuotaExceededError,
  ValidationError,
} from "./gsc-error.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Shape returned by the Google APIs client library when a request fails.
 * We only declare the subset of fields we inspect so the module stays
 * decoupled from `googleapis` types.
 */
interface GoogleApiErrorLike {
  code?: number;
  status?: number;
  message?: string;
  errors?: Array<{ message?: string; domain?: string; reason?: string }>;
  response?: {
    status?: number;
    statusText?: string;
    data?: {
      error?: {
        code?: number;
        message?: string;
        errors?: Array<{ message?: string; domain?: string; reason?: string }>;
      };
    };
  };
}

/** The MCP-compliant error payload returned to the host. */
export interface McpErrorResponse {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Best-effort extraction of the HTTP status code from a Google API error.
 */
function extractStatusCode(error: GoogleApiErrorLike): number | undefined {
  return (
    error.code ??
    error.status ??
    error.response?.status ??
    error.response?.data?.error?.code
  );
}

/**
 * Best-effort extraction of the error message from a Google API error.
 */
function extractMessage(error: GoogleApiErrorLike): string {
  return (
    error.response?.data?.error?.message ??
    error.message ??
    "Unknown API error"
  );
}

/**
 * Returns `true` when the error message looks like a quota / rate-limit issue
 * even if the HTTP status is 403 rather than 429.
 */
function isQuotaMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("quota") ||
    lower.includes("rate limit") ||
    lower.includes("rateLimitExceeded".toLowerCase()) ||
    lower.includes("too many requests")
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Convert a raw error thrown by the Google APIs client (or any unknown value)
 * into the most specific {@link GscError} subclass possible.
 *
 * If `error` is already a `GscError` it is returned as-is.
 */
export function handleApiError(error: unknown): GscError {
  // Already one of ours — pass through.
  if (error instanceof GscError) {
    return error;
  }

  // Zod validation failures.
  if (error instanceof ZodError) {
    return handleZodError(error);
  }

  // Attempt to treat the value as a Google API error object.
  if (isGoogleApiError(error)) {
    const status = extractStatusCode(error);
    const message = extractMessage(error);

    switch (status) {
      case 401:
        return new AuthenticationError(message, { cause: error });

      case 403: {
        if (isQuotaMessage(message)) {
          return new QuotaExceededError(message, {
            recoveryHint: "API quota exceeded. Waiting and retrying.",
            cause: error,
          });
        }
        return new AuthorizationError(message, { cause: error });
      }

      case 404:
        return new NotFoundError(message, { cause: error });

      case 429:
        return new QuotaExceededError(message, { cause: error });

      default:
        return new ApiError(message, { statusCode: status, cause: error });
    }
  }

  // Totally unknown error shape — wrap in a generic ApiError.
  const fallbackMessage =
    error instanceof Error ? error.message : String(error);
  return new ApiError(fallbackMessage, { cause: error });
}

/**
 * Convert a {@link ZodError} into a {@link ValidationError} with a readable
 * message that tells the caller exactly which fields are wrong and what was
 * expected.
 */
export function handleZodError(error: ZodError): ValidationError {
  const fieldErrors: Record<string, string[]> = {};
  const lines: string[] = [];

  for (const issue of error.issues) {
    const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
    const entry = `  - ${path}: ${issue.message}`;
    lines.push(entry);

    if (!fieldErrors[path]) {
      fieldErrors[path] = [];
    }
    fieldErrors[path].push(issue.message);
  }

  const message = `Validation failed:\n${lines.join("\n")}`;
  const recoveryHint =
    "Check the input parameters and correct the values listed above.";

  return new ValidationError(message, {
    recoveryHint,
    cause: error,
    fieldErrors,
  });
}

/**
 * Format any error into the MCP tool-result shape that signals failure to the
 * host.  If the error is not already a `GscError` it will be converted first
 * via {@link handleApiError}.
 */
export function formatErrorForMcp(error: unknown): McpErrorResponse {
  const gscError =
    error instanceof GscError ? error : handleApiError(error);

  const parts: string[] = [gscError.message];

  if (gscError.recoveryHint) {
    parts.push(`Hint: ${gscError.recoveryHint}`);
  }

  if (gscError instanceof ValidationError) {
    const fieldKeys = Object.keys(gscError.fieldErrors);
    if (fieldKeys.length > 0) {
      const fieldSummary = fieldKeys
        .map(
          (key) =>
            `  ${key}: ${gscError.fieldErrors[key]?.join("; ") ?? ""}`,
        )
        .join("\n");
      parts.push(`Field errors:\n${fieldSummary}`);
    }
  }

  return {
    content: [{ type: "text", text: parts.join("\n") }],
    isError: true,
  };
}

// ---------------------------------------------------------------------------
// Internal type guard
// ---------------------------------------------------------------------------

function isGoogleApiError(value: unknown): value is GoogleApiErrorLike {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  return (
    typeof obj["code"] === "number" ||
    typeof obj["status"] === "number" ||
    (typeof obj["response"] === "object" && obj["response"] !== null) ||
    (typeof obj["message"] === "string" && "errors" in obj)
  );
}
