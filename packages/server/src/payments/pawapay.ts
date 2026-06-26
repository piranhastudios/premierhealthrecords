// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Mobile-money payment provider abstraction.
 *
 * The EHR collects patient payments through mobile money, which is the dominant
 * consumer rail in Cameroon. pawaPay is an aggregator that fronts MTN MoMo,
 * Orange Money and others behind a single API, so a single integration covers
 * the common correspondents and can be extended to new markets/rails later.
 *
 * This module deliberately exposes a small {@link PaymentProvider} interface so
 * that cash/card/insurer rails can be slotted in behind the same `$pay`
 * operation without changing callers.
 */

/** Connection settings resolved from project secrets. */
export interface PawaPayConfig {
  /** pawaPay API bearer token (project secret PAWAPAY_API_TOKEN). */
  apiToken: string;
  /** Base URL; defaults to the sandbox. Set PAWAPAY_BASE_URL to the production host to go live. */
  baseUrl: string;
}

export const PAWAPAY_SANDBOX_URL = 'https://api.sandbox.pawapay.io';
export const PAWAPAY_PRODUCTION_URL = 'https://api.pawapay.io';

/** A request to collect money from a payer (a pawaPay "deposit"). */
export interface DepositRequest {
  /** Idempotency key / pawaPay deposit id (a server-generated UUID). */
  depositId: string;
  /** Amount as a plain decimal string, e.g. "1500" (pawaPay expects a string). */
  amount: string;
  /** ISO 4217 currency, e.g. "XAF" for Central African CFA franc. */
  currency: string;
  /** Mobile-money correspondent, e.g. "MTN_MOMO_CMR" or "ORANGE_CMR". */
  correspondent: string;
  /** Payer MSISDN in international format without "+", e.g. "237690000000". */
  payerMsisdn: string;
  /** Short description shown on the payer's statement (<= 22 chars for most MMOs). */
  statementDescription?: string;
  /** Arbitrary key/value metadata echoed back on the callback (e.g. project id). */
  metadata?: { fieldName: string; fieldValue: string; isPII?: boolean }[];
}

/** Normalised result of a deposit request or status lookup. */
export interface DepositResult {
  depositId: string;
  /**
   * pawaPay status. On submission: ACCEPTED | REJECTED | DUPLICATE_IGNORED.
   * On status lookup the deposit progresses to: COMPLETED | FAILED.
   */
  status: string;
  /** Reason, when rejected/failed. */
  failureReason?: string;
  /** The raw pawaPay payload, for auditing/debugging. */
  raw: unknown;
}

export interface PaymentProvider {
  /** Initiate a collection from the payer. */
  initiateDeposit(req: DepositRequest, config: PawaPayConfig): Promise<DepositResult>;
  /** Fetch the authoritative current status of a deposit. */
  getDeposit(depositId: string, config: PawaPayConfig): Promise<DepositResult | undefined>;
}

/** Maps a pawaPay deposit object (from any endpoint) to {@link DepositResult}. */
function toDepositResult(depositId: string, body: any): DepositResult {
  const obj = Array.isArray(body) ? body[0] : body;
  return {
    depositId: obj?.depositId ?? depositId,
    status: obj?.status ?? 'UNKNOWN',
    failureReason: obj?.failureReason?.failureMessage ?? obj?.rejectionReason?.rejectionMessage,
    raw: body,
  };
}

export class PawaPayProvider implements PaymentProvider {
  async initiateDeposit(req: DepositRequest, config: PawaPayConfig): Promise<DepositResult> {
    const body = {
      depositId: req.depositId,
      amount: req.amount,
      currency: req.currency,
      correspondent: req.correspondent,
      payer: { type: 'MSISDN', address: { value: req.payerMsisdn } },
      customerTimestamp: new Date().toISOString(),
      statementDescription: req.statementDescription?.slice(0, 22),
      metadata: req.metadata,
    };

    const response = await fetch(`${config.baseUrl}/deposits`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        `pawaPay deposit failed: ${response.status} ${response.statusText} - ${JSON.stringify(json)}`
      );
    }
    return toDepositResult(req.depositId, json);
  }

  async getDeposit(depositId: string, config: PawaPayConfig): Promise<DepositResult | undefined> {
    const response = await fetch(`${config.baseUrl}/deposits/${depositId}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${config.apiToken}` },
    });
    if (response.status === 404) {
      return undefined;
    }
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        `pawaPay deposit lookup failed: ${response.status} ${response.statusText} - ${JSON.stringify(json)}`
      );
    }
    // The status endpoint returns an array (possibly empty) of deposit objects.
    if (Array.isArray(json) && json.length === 0) {
      return undefined;
    }
    return toDepositResult(depositId, json);
  }
}

/** Identifier system used to correlate a pawaPay deposit with its FHIR resources. */
export const PAWAPAY_DEPOSIT_SYSTEM = 'https://pawapay.io/depositId';
