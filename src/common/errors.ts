export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class InsufficientFundsError extends AppError {
  constructor(message = "Insufficient funds in source account", details?: unknown) {
    super(422, "INSUFFICIENT_FUNDS", message, details);
  }
}

export class AccountNotFoundError extends AppError {
  constructor(accountId: string) {
    super(404, "ACCOUNT_NOT_FOUND", `Account with ID '${accountId}' was not found`);
  }
}

export class AccountInactiveError extends AppError {
  constructor(accountId: string, status: string) {
    super(400, "ACCOUNT_INACTIVE", `Account '${accountId}' is not active (status: ${status})`);
  }
}

export class CurrencyMismatchError extends AppError {
  constructor(currencyA: string, currencyB: string) {
    super(
      400,
      "CURRENCY_MISMATCH",
      `Source account currency '${currencyA}' does not match destination currency '${currencyB}'`
    );
  }
}

export class IdempotencyConflictError extends AppError {
  constructor(message = "Idempotency key reused with a different request payload") {
    super(409, "IDEMPOTENCY_CONFLICT", message);
  }
}

export class ConcurrentRequestError extends AppError {
  constructor(message = "A concurrent request with the same Idempotency-Key is currently in progress") {
    super(429, "CONCURRENT_REQUEST_IN_FLIGHT", message);
  }
}

export class InvalidAmountError extends AppError {
  constructor(message = "Amount must be a positive integer in smallest currency units (paise/cents)") {
    super(400, "INVALID_AMOUNT", message);
  }
}

export class SameAccountTransferError extends AppError {
  constructor() {
    super(400, "SAME_ACCOUNT_TRANSFER", "Source and destination accounts cannot be identical");
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Invalid or missing administrative authorization") {
    super(401, "UNAUTHORIZED", message);
  }
}
