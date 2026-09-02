export type ProviderErrorCode =
  | "PROVIDER_FUNCTION_UNAVAILABLE" | "PROVIDER_ACCESS_DENIED" | "PROVIDER_AUTH_INVALID"
  | "PROVIDER_TIMEOUT" | "PROVIDER_UNAVAILABLE" | "PROVIDER_RESPONSE_INVALID"
  | "PROVIDER_MAPPING_MISSING" | "UNSUPPORTED_PROVIDER" | "FILE_TOO_LARGE"
  | "UNSUPPORTED_CONTENT_TYPE" | "FILE_REFERENCE_INVALID";

export class ProviderError extends Error {
  readonly code:ProviderErrorCode;readonly retryable:boolean;
  constructor(code: ProviderErrorCode, message: string, retryable = false) {
    super(message);
    this.code=code;this.retryable=retryable;
    this.name = "ProviderError";
  }
}

export function redactSecrets(value: string): string {
  return value
    .replace(/([?&](?:token|wstoken|access_token|refresh_token)=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/(bearer\s+)[A-Za-z0-9._~+\/-]+/gi, "$1[REDACTED]");
}
