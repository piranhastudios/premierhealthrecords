// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * QuickBooks Online (QBO) accounting provider abstraction.
 *
 * The EHR is the single financial orchestrator (see docs/quickbooks-integration.md):
 * balanced Invoices and settled payments (card via Stripe, mobile money via pawaPay)
 * are pushed into QBO as QBO Invoices/Payments, while service pricing is pulled the
 * other way from QBO Items into ChargeItemDefinitions.
 *
 * Like {@link ../payments/pawapay}, this module is SDK-free (plain `fetch`) and
 * exposes a small provider surface so callers (FHIR operations, routes) never talk
 * to the Intuit API directly.
 *
 * IMPORTANT — token rotation: Intuit refresh tokens ROTATE. Every token refresh may
 * return a *new* refresh token, invalidating the old one. After any provider call,
 * callers MUST check {@link QuickBooksProvider.getRotatedTokens} and persist the
 * rotated tokens back into project secrets, or the connection bricks until an admin
 * re-authorizes.
 */
import { formatHumanName } from '@medplum/core';
import type { Patient, Project } from '@medplum/fhirtypes';

/** Connection settings resolved from project secrets. */
export interface QuickBooksConfig {
  /** Intuit app client id (project secret QUICKBOOKS_CLIENT_ID). */
  clientId: string;
  /** Intuit app client secret (QUICKBOOKS_CLIENT_SECRET). */
  clientSecret: string;
  /** QBO company id, returned on the OAuth callback (QUICKBOOKS_REALM_ID). */
  realmId: string;
  /** Current (rotating) refresh token (QUICKBOOKS_REFRESH_TOKEN). */
  refreshToken: string;
  /** Cached access token, if previously persisted (QUICKBOOKS_ACCESS_TOKEN). */
  accessToken?: string;
  /** ISO timestamp when the cached access token expires (QUICKBOOKS_ACCESS_TOKEN_EXPIRES_AT). */
  accessTokenExpiresAt?: string;
  /** API base URL; defaults to the sandbox. Set QUICKBOOKS_BASE_URL to go live. */
  baseUrl: string;
}

/** Intuit app credentials only — all that exists before the OAuth connect flow completes. */
export interface QuickBooksAppCredentials {
  clientId: string;
  clientSecret: string;
}

/** The OAuth token set returned by Intuit; must be re-persisted on every rotation. */
export interface QuickBooksTokens {
  accessToken: string;
  /** ISO timestamp when the access token expires. */
  accessTokenExpiresAt: string;
  /** Possibly-rotated refresh token — persist immediately. */
  refreshToken: string;
}

export const QBO_SANDBOX_URL = 'https://sandbox-quickbooks.api.intuit.com';
export const QBO_PRODUCTION_URL = 'https://quickbooks.api.intuit.com';
export const QBO_OAUTH_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
export const QBO_AUTHORIZE_URL = 'https://appcenter.intuit.com/connect/oauth2';
export const QBO_OAUTH_SCOPE = 'com.intuit.quickbooks.accounting';

/** QBO REST API minor version pinned for stable response shapes. */
export const QBO_MINOR_VERSION = '75';

/** Refresh the access token when it expires within this window. */
const TOKEN_EXPIRY_MARGIN_MS = 2 * 60 * 1000;

/** Identifier system correlating a Patient with its QBO Customer. */
export const QBO_CUSTOMER_ID_SYSTEM = 'https://quickbooks.intuit.com/customerId';
/** Identifier system correlating a FHIR Invoice with its QBO Invoice. */
export const QBO_INVOICE_ID_SYSTEM = 'https://quickbooks.intuit.com/invoiceId';
/** Identifier system correlating a PaymentReconciliation with its QBO Payment. */
export const QBO_PAYMENT_ID_SYSTEM = 'https://quickbooks.intuit.com/paymentId';
/** Identifier system correlating a ChargeItemDefinition with its QBO Item. */
export const QBO_ITEM_ID_SYSTEM = 'https://quickbooks.intuit.com/itemId';

/** Name of the fallback QBO Item used for invoice lines with no mapped QBO Item. */
export const QBO_DEFAULT_SERVICE_ITEM_NAME = 'Healthcare Services';

/**
 * Resolves QuickBooks connection settings from project secrets.
 * Prefers per-project secrets; falls back to server env vars for single-tenant
 * on-prem deployments (mirroring `getStripeConfig` / `getPawaPayConfig`).
 * @param project - The current project.
 * @returns The resolved QuickBooks config.
 */
export function getQuickBooksConfig(project: Project): QuickBooksConfig {
  const { clientId, clientSecret } = getQuickBooksAppCredentials(project);
  const realmId = getSecretOrEnv(project, 'QUICKBOOKS_REALM_ID');
  const refreshToken = getSecretOrEnv(project, 'QUICKBOOKS_REFRESH_TOKEN');
  if (!realmId || !refreshToken) {
    throw new Error(
      'QuickBooks is not connected (missing QUICKBOOKS_REALM_ID / QUICKBOOKS_REFRESH_TOKEN — run the connect flow at accounting/quickbooks/connect)'
    );
  }
  return {
    clientId,
    clientSecret,
    realmId,
    refreshToken,
    accessToken: getSecretOrEnv(project, 'QUICKBOOKS_ACCESS_TOKEN'),
    accessTokenExpiresAt: getSecretOrEnv(project, 'QUICKBOOKS_ACCESS_TOKEN_EXPIRES_AT'),
    baseUrl: getSecretOrEnv(project, 'QUICKBOOKS_BASE_URL') ?? QBO_SANDBOX_URL,
  };
}

/**
 * Resolves only the Intuit app credentials — used by the OAuth connect/callback
 * routes, which run before a realm id or refresh token exists.
 * @param project - The current project.
 * @returns The Intuit app client id and secret.
 */
export function getQuickBooksAppCredentials(project: Project): QuickBooksAppCredentials {
  const clientId = getSecretOrEnv(project, 'QUICKBOOKS_CLIENT_ID');
  if (!clientId) {
    throw new Error(
      'QuickBooks client id not configured (set the QUICKBOOKS_CLIENT_ID project secret or environment variable)'
    );
  }
  const clientSecret = getSecretOrEnv(project, 'QUICKBOOKS_CLIENT_SECRET');
  if (!clientSecret) {
    throw new Error(
      'QuickBooks client secret not configured (set the QUICKBOOKS_CLIENT_SECRET project secret or environment variable)'
    );
  }
  return { clientId, clientSecret };
}

function getSecretOrEnv(project: Project, name: string): string | undefined {
  return project.secret?.find((s) => s.name === name)?.valueString ?? process.env[name];
}

/**
 * An Intuit API error. `retryable` distinguishes transient failures (5xx /
 * throttling — the caller may retry) from bad requests (4xx — do not retry).
 */
export class QuickBooksApiError extends Error {
  readonly status: number;
  readonly retryable: boolean;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'QuickBooksApiError';
    this.status = status;
    this.retryable = status === 429 || status >= 500;
  }
}

/** A QBO Item, as returned by `select * from Item`. */
export interface QboItem {
  Id: string;
  Name: string;
  Description?: string;
  UnitPrice?: number;
  Type?: string;
  Active?: boolean;
  SyncToken?: string;
  [key: string]: unknown;
}

/** One QBO Invoice line (SalesItemLineDetail). Amounts are in MAJOR units (XAF passes straight through). */
export interface QboInvoiceLine {
  /** QBO Item id (ItemRef.value). */
  itemId: string;
  /** Line amount in major currency units. */
  amount: number;
  /** Human-readable line description. */
  description?: string;
}

/** A request to create (or sparse-update) a QBO Invoice. */
export interface QboInvoiceRequest {
  /** QBO Customer id. */
  customerId: string;
  /** Invoice lines; each references a QBO Item. */
  lines: QboInvoiceLine[];
  /** Optional document number surfaced in the QBO UI (e.g. the FHIR Invoice id). */
  docNumber?: string;
  /** When set, sparse-update this existing QBO Invoice instead of creating one. */
  existingInvoiceId?: string;
}

/** A request to record a QBO Payment applied to a QBO Invoice. */
export interface QboPaymentRequest {
  /** QBO Customer id. */
  customerId: string;
  /** QBO Invoice id the payment settles. */
  qboInvoiceId: string;
  /** Payment amount in major currency units. */
  amount: number;
  /** Reference number shown in QBO (e.g. the PaymentReconciliation id). */
  paymentRefNum?: string;
}

/** Result of ensuring a QBO Customer exists for a Patient. */
export interface QboCustomerResult {
  customerId: string;
  /** True when this call created the Customer (the caller should persist the id on the Patient). */
  created: boolean;
}

/**
 * Escapes a value for interpolation into a QBO SQL-ish query string.
 * QBO queries escape single quotes with a backslash; the backslash itself is
 * escaped first so a literal `\'` in the value cannot break out of the string.
 * @param value - The raw value.
 * @returns The escaped value.
 */
export function escapeQboQueryValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Builds the QBO Customer DisplayName for a Patient. DisplayName must be unique
 * across all QBO Customers/Vendors/Employees, so the patient name is disambiguated
 * with a suffix of the Patient id.
 * @param patient - The FHIR Patient.
 * @returns The unique DisplayName.
 */
export function buildCustomerDisplayName(patient: Patient): string {
  const idSuffix = (patient.id ?? '').slice(0, 8);
  const name = patient.name?.[0] ? formatHumanName(patient.name[0]) : 'Patient';
  return `${name} (${idSuffix})`;
}

interface TokenResponseBody {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  [key: string]: unknown;
}

async function requestTokens(
  credentials: QuickBooksAppCredentials,
  params: Record<string, string>
): Promise<QuickBooksTokens> {
  const basic = Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString('base64');
  const response = await fetch(QBO_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(params).toString(),
  });
  const json = (await response.json().catch(() => ({}))) as TokenResponseBody;
  if (!response.ok || !json.access_token || !json.refresh_token) {
    // Redact the body down to the OAuth error fields — a partial success (e.g.
    // missing refresh_token) may still carry a live access token.
    const redacted = { error: json.error, error_description: json.error_description };
    throw new QuickBooksApiError(
      `QuickBooks token request failed: ${response.status} ${response.statusText} - ${JSON.stringify(redacted)}`,
      response.status
    );
  }
  return {
    accessToken: json.access_token,
    accessTokenExpiresAt: new Date(Date.now() + (json.expires_in ?? 3600) * 1000).toISOString(),
    refreshToken: json.refresh_token,
  };
}

/**
 * Exchanges an OAuth authorization code for the initial token set (the connect
 * callback). The redirect URI must match the one used on the authorize URL exactly.
 * @param credentials - The Intuit app credentials.
 * @param code - The authorization code from the callback query string.
 * @param redirectUri - The exact redirect URI registered with Intuit.
 * @returns The initial token set — persist it (with the realmId) into project secrets.
 */
export async function exchangeAuthCode(
  credentials: QuickBooksAppCredentials,
  code: string,
  redirectUri: string
): Promise<QuickBooksTokens> {
  return requestTokens(credentials, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  });
}

export class QuickBooksProvider {
  private readonly config: QuickBooksConfig;
  private accessToken?: string;
  private accessTokenExpiresAt?: number;
  private refreshToken: string;
  private rotatedTokens?: QuickBooksTokens;

  constructor(config: QuickBooksConfig) {
    this.config = config;
    this.accessToken = config.accessToken;
    this.accessTokenExpiresAt = config.accessTokenExpiresAt ? Date.parse(config.accessTokenExpiresAt) : undefined;
    this.refreshToken = config.refreshToken;
  }

  /**
   * Returns the token set produced by the most recent refresh, if any. Intuit
   * ROTATES refresh tokens, so after any provider usage the caller must persist
   * these back into project secrets (see `persistRotatedQuickBooksTokens`).
   * @returns The rotated tokens, or undefined when no refresh happened.
   */
  getRotatedTokens(): QuickBooksTokens | undefined {
    return this.rotatedTokens;
  }

  private async getAccessToken(): Promise<string> {
    if (
      this.accessToken &&
      this.accessTokenExpiresAt !== undefined &&
      !Number.isNaN(this.accessTokenExpiresAt) &&
      this.accessTokenExpiresAt - Date.now() > TOKEN_EXPIRY_MARGIN_MS
    ) {
      return this.accessToken;
    }
    return this.refreshAccessToken();
  }

  private async refreshAccessToken(): Promise<string> {
    const tokens = await requestTokens(this.config, {
      grant_type: 'refresh_token',
      refresh_token: this.refreshToken,
    });
    this.accessToken = tokens.accessToken;
    this.accessTokenExpiresAt = Date.parse(tokens.accessTokenExpiresAt);
    this.refreshToken = tokens.refreshToken;
    // Expose every refreshed token set (the refresh token may have rotated) so the
    // caller can persist it — failing to do so bricks the connection.
    this.rotatedTokens = tokens;
    return tokens.accessToken;
  }

  /**
   * Performs a QBO REST v3 request with token refresh and error classification:
   * 401 → refresh once and retry; other 4xx → non-retryable error; 5xx → retryable error.
   * @param method - The HTTP method.
   * @param path - Path relative to /v3/company/realmId, may include a query string.
   * @param body - Optional JSON body.
   * @param isRetry - Internal: true when this call is the post-refresh retry.
   * @returns The parsed JSON response body.
   */
  private async apiRequest<T>(method: 'GET' | 'POST', path: string, body?: unknown, isRetry = false): Promise<T> {
    const token = await this.getAccessToken();
    // Append minorversion without URLSearchParams re-serialization, which would
    // turn the query's %20 escapes into '+'.
    const separator = path.includes('?') ? '&' : '?';
    const url = `${this.config.baseUrl}/v3/company/${this.config.realmId}${path}${separator}minorversion=${QBO_MINOR_VERSION}`;
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : undefined),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (response.status === 401 && !isRetry) {
      // Stale access token — refresh exactly once and retry.
      await this.refreshAccessToken();
      return this.apiRequest(method, path, body, true);
    }
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new QuickBooksApiError(
        `QuickBooks request failed: ${method} ${path} - ${response.status} ${response.statusText} - ${JSON.stringify(json)}`,
        response.status
      );
    }
    return json as T;
  }

  /**
   * Runs a QBO query (`select ...`) and returns its QueryResponse payload.
   * @param sql - The QBO query string.
   * @returns The QueryResponse object (entity arrays keyed by entity name).
   */
  async query(sql: string): Promise<Record<string, unknown>> {
    const json = await this.apiRequest<{ QueryResponse?: Record<string, unknown> }>(
      'GET',
      `/query?query=${encodeURIComponent(sql)}`
    );
    return json.QueryResponse ?? {};
  }

  /**
   * Ensures a QBO Customer exists for the Patient: use the stored identifier if
   * present, else find by the deterministic DisplayName, else create. Idempotent.
   * @param patient - The FHIR Patient.
   * @returns The QBO customer id and whether it was newly created.
   */
  async ensureCustomer(patient: Patient): Promise<QboCustomerResult> {
    const stored = patient.identifier?.find((i) => i.system === QBO_CUSTOMER_ID_SYSTEM)?.value;
    if (stored) {
      return { customerId: stored, created: false };
    }

    const displayName = buildCustomerDisplayName(patient);
    const queryResponse = await this.query(
      `select * from Customer where DisplayName = '${escapeQboQueryValue(displayName)}'`
    );
    const existing = (queryResponse.Customer as { Id: string }[] | undefined)?.[0];
    if (existing?.Id) {
      return { customerId: existing.Id, created: false };
    }

    const name = patient.name?.[0];
    const email = patient.telecom?.find((t) => t.system === 'email')?.value;
    const created = await this.apiRequest<{ Customer: { Id: string } }>('POST', '/customer', {
      DisplayName: displayName,
      GivenName: name?.given?.[0],
      FamilyName: name?.family,
      ...(email ? { PrimaryEmailAddr: { Address: email } } : undefined),
    });
    return { customerId: created.Customer.Id, created: true };
  }

  /**
   * Creates a QBO Invoice (or sparse-updates an existing one, using its current
   * SyncToken for optimistic concurrency). Amounts are in MAJOR units — QBO uses
   * decimal major units, so XAF values pass straight through.
   * @param req - The invoice request.
   * @returns The QBO invoice id and raw entity.
   */
  async upsertInvoice(req: QboInvoiceRequest): Promise<{ invoiceId: string; raw: unknown }> {
    const line = req.lines.map((l) => ({
      DetailType: 'SalesItemLineDetail',
      Amount: l.amount,
      Description: l.description,
      SalesItemLineDetail: { ItemRef: { value: l.itemId } },
    }));

    let body: Record<string, unknown> = {
      CustomerRef: { value: req.customerId },
      Line: line,
      ...(req.docNumber ? { DocNumber: req.docNumber } : undefined),
    };

    if (req.existingInvoiceId) {
      // Read-before-update: QBO requires the current SyncToken on every update.
      const current = await this.apiRequest<{ Invoice: { Id: string; SyncToken: string } }>(
        'GET',
        `/invoice/${req.existingInvoiceId}`
      );
      body = { ...body, Id: current.Invoice.Id, SyncToken: current.Invoice.SyncToken, sparse: true };
    }

    const result = await this.apiRequest<{ Invoice: { Id: string } }>('POST', '/invoice', body);
    return { invoiceId: result.Invoice.Id, raw: result.Invoice };
  }

  /**
   * Records a QBO Payment applied (via LinkedTxn) to an existing QBO Invoice.
   * @param req - The payment request.
   * @returns The QBO payment id and raw entity.
   */
  async recordPayment(req: QboPaymentRequest): Promise<{ paymentId: string; raw: unknown }> {
    const result = await this.apiRequest<{ Payment: { Id: string } }>('POST', '/payment', {
      CustomerRef: { value: req.customerId },
      TotalAmt: req.amount,
      ...(req.paymentRefNum ? { PaymentRefNum: req.paymentRefNum } : undefined),
      Line: [
        {
          Amount: req.amount,
          LinkedTxn: [{ TxnId: req.qboInvoiceId, TxnType: 'Invoice' }],
        },
      ],
    });
    return { paymentId: result.Payment.Id, raw: result.Payment };
  }

  /**
   * Lists all QBO Items (the finance team's price list). QBO query responses are
   * capped (100 rows by default, 1000 hard max), so page with
   * STARTPOSITION/MAXRESULTS until a page comes back short.
   * @returns The QBO Items.
   */
  async listItems(): Promise<QboItem[]> {
    const pageSize = 1000;
    const items: QboItem[] = [];
    for (let startPosition = 1; ; startPosition += pageSize) {
      const queryResponse = await this.query(
        `select * from Item STARTPOSITION ${startPosition} MAXRESULTS ${pageSize}`
      );
      const page = (queryResponse.Item as QboItem[] | undefined) ?? [];
      items.push(...page);
      if (page.length < pageSize) {
        break;
      }
    }
    return items;
  }

  /**
   * Finds or creates the default Service Item ("Healthcare Services") used for
   * invoice lines whose ChargeItem has no mapped QBO Item. Creating a Service item
   * requires an income account, so the first Income-type account is used.
   * @returns The QBO item id of the default service item.
   */
  async getOrCreateDefaultServiceItem(): Promise<string> {
    const itemResponse = await this.query(
      `select * from Item where Name = '${escapeQboQueryValue(QBO_DEFAULT_SERVICE_ITEM_NAME)}'`
    );
    const existing = (itemResponse.Item as QboItem[] | undefined)?.[0];
    if (existing?.Id) {
      return existing.Id;
    }

    const accountResponse = await this.query(`select * from Account where AccountType = 'Income'`);
    const account = (accountResponse.Account as { Id: string }[] | undefined)?.[0];
    if (!account?.Id) {
      throw new QuickBooksApiError(
        'Cannot create the default QuickBooks service item: no Income account found in the QBO company',
        400
      );
    }

    const created = await this.apiRequest<{ Item: { Id: string } }>('POST', '/item', {
      Name: QBO_DEFAULT_SERVICE_ITEM_NAME,
      Type: 'Service',
      IncomeAccountRef: { value: account.Id },
    });
    return created.Item.Id;
  }
}
