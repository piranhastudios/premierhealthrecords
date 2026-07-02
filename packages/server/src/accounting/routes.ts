// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * QuickBooks Online OAuth connect flow (see docs/quickbooks-integration.md §4).
 *
 * - GET /connect (authenticated, project admin): returns the Intuit authorize URL
 *   as JSON. Non-FHIR authenticated routes are bearer-authenticated (see
 *   admin/routes.ts), so a server-side 302 is not usable from a fetch() caller —
 *   the admin UI opens the returned URL itself.
 * - GET /callback (public — Intuit redirects the admin's browser here): validates
 *   the signed state, exchanges the code, and persists QUICKBOOKS_REALM_ID plus
 *   the initial (rotating) token set into project secrets via the system repo.
 *
 * The `state` parameter is an HMAC-signed value (projectId + expiry + nonce,
 * keyed by the project's QUICKBOOKS_CLIENT_SECRET). The nonce is additionally
 * tracked in Redis so each state is single-use: the callback atomically consumes
 * it and rejects replays within the TTL.
 */
import type { Project } from '@medplum/fhirtypes';
import type { Request, Response } from 'express';
import { Router } from 'express';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { verifyProjectAdmin } from '../admin/utils';
import { getConfig } from '../config/loader';
import { getAuthenticatedContext } from '../context';
import { getGlobalSystemRepo } from '../fhir/repo';
import { globalLogger } from '../logger';
import { authenticateRequest } from '../oauth/middleware';
import { getCacheRedis } from '../redis';
import type { QuickBooksAppCredentials } from './quickbooks';
import { exchangeAuthCode, getQuickBooksAppCredentials, QBO_AUTHORIZE_URL, QBO_OAUTH_SCOPE } from './quickbooks';
import { upsertProjectSettings } from './utils';

/** How long a pending connect state stays valid. */
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

// The callback URL Intuit redirects back to; must exactly match a redirect URI
// registered in the Intuit developer portal. baseUrl already includes the `/api/`
// mount, so use a path RELATIVE to it — mirroring getStripeWebhookUrl. Resolves to
//   https://app.premierhealthcentres.com/api/accounting/quickbooks/callback
export function getQuickBooksCallbackUrl(): string {
  return new URL('accounting/quickbooks/callback', getConfig().baseUrl).toString();
}

interface OAuthStatePayload {
  projectId: string;
  expiresAt: number;
  nonce: string;
}

function signStatePayload(encodedPayload: string, clientSecret: string): string {
  return createHmac('sha256', clientSecret).update(encodedPayload).digest('base64url');
}

function getOAuthStateRedisKey(nonce: string): string {
  return `medplum:qbo:oauth-state:${nonce}`;
}

/**
 * Creates a signed OAuth `state` value binding the connect flow to a project.
 * The nonce is stored in Redis (with the state TTL) so the unauthenticated
 * callback can enforce single use.
 * @param projectId - The project initiating the connect flow.
 * @param clientSecret - The project's Intuit client secret (the signing key).
 * @returns The opaque state string.
 */
export async function createOAuthState(projectId: string, clientSecret: string): Promise<string> {
  const nonce = randomUUID();
  await getCacheRedis().set(getOAuthStateRedisKey(nonce), '1', 'EX', OAUTH_STATE_TTL_MS / 1000);
  const payload: OAuthStatePayload = { projectId, expiresAt: Date.now() + OAUTH_STATE_TTL_MS, nonce };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${signStatePayload(encoded, clientSecret)}`;
}

/**
 * Decodes the state payload WITHOUT verifying it — used only to discover which
 * project's client secret to verify against.
 * @param state - The state string from the callback.
 * @returns The decoded payload, or undefined if malformed.
 */
export function decodeOAuthState(state: string): OAuthStatePayload | undefined {
  try {
    const encoded = state.split('.')[0];
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as OAuthStatePayload;
    return typeof payload.projectId === 'string' &&
      typeof payload.expiresAt === 'number' &&
      typeof payload.nonce === 'string'
      ? payload
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Verifies the state signature and expiry against the project's client secret.
 * @param state - The state string from the callback.
 * @param clientSecret - The project's Intuit client secret.
 * @returns True when authentic and unexpired.
 */
export function verifyOAuthState(state: string, clientSecret: string): boolean {
  const [encoded, signature] = state.split('.');
  if (!encoded || !signature) {
    return false;
  }
  const expected = signStatePayload(encoded, clientSecret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return false;
  }
  const payload = decodeOAuthState(state);
  return !!payload && payload.expiresAt > Date.now();
}

/**
 * Handles GET /accounting/quickbooks/connect: builds the Intuit authorize URL for
 * the current project and returns it as JSON for the admin UI to open.
 * @param _req - The request object.
 * @param res - The response object.
 */
export const quickBooksConnectHandler = async (_req: Request, res: Response): Promise<void> => {
  const ctx = getAuthenticatedContext();

  let credentials: QuickBooksAppCredentials;
  try {
    credentials = getQuickBooksAppCredentials(ctx.project);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
    return;
  }

  const authorizeUrl = new URL(QBO_AUTHORIZE_URL);
  authorizeUrl.searchParams.set('client_id', credentials.clientId);
  authorizeUrl.searchParams.set('scope', QBO_OAUTH_SCOPE);
  authorizeUrl.searchParams.set('redirect_uri', getQuickBooksCallbackUrl());
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('state', await createOAuthState(ctx.project.id, credentials.clientSecret));

  res.status(200).json({ authorizeUrl: authorizeUrl.toString() });
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sendCallbackPage(res: Response, status: number, title: string, message: string): void {
  res
    .status(status)
    .type('html')
    .send(
      `<!DOCTYPE html><html><head><title>${escapeHtml(title)}</title></head>` +
        `<body style="font-family: sans-serif; max-width: 40rem; margin: 4rem auto;">` +
        `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></body></html>`
    );
}

/**
 * Handles GET /accounting/quickbooks/callback: Intuit redirects the admin's
 * browser here with `code`, `realmId`, and our signed `state`. Exchanges the code
 * and persists the realm id + token set into project secrets.
 * @param req - The request object.
 * @param res - The response object.
 */
export const quickBooksCallbackHandler = async (req: Request, res: Response): Promise<void> => {
  const code = req.query.code as string | undefined;
  const realmId = req.query.realmId as string | undefined;
  const state = req.query.state as string | undefined;

  if (!code || !realmId || !state) {
    sendCallbackPage(res, 400, 'QuickBooks connection failed', 'Missing code, realmId, or state.');
    return;
  }

  const payload = decodeOAuthState(state);
  if (!payload) {
    sendCallbackPage(res, 400, 'QuickBooks connection failed', 'Invalid state.');
    return;
  }

  try {
    const systemRepo = getGlobalSystemRepo();
    const project = await systemRepo.readResource<Project>('Project', payload.projectId);

    const credentials = getQuickBooksAppCredentials(project);
    if (!verifyOAuthState(state, credentials.clientSecret)) {
      sendCallbackPage(
        res,
        400,
        'QuickBooks connection failed',
        'Invalid or expired state — restart the connect flow.'
      );
      return;
    }

    // Single-use: atomically consume the nonce stored by createOAuthState (DEL
    // returns 0 when it was already consumed or expired), rejecting replays.
    const consumed = await getCacheRedis().del(getOAuthStateRedisKey(payload.nonce));
    if (consumed === 0) {
      sendCallbackPage(
        res,
        400,
        'QuickBooks connection failed',
        'This connect link was already used or has expired — restart the connect flow.'
      );
      return;
    }

    // The redirect_uri must match the authorize request exactly.
    const tokens = await exchangeAuthCode(credentials, code, getQuickBooksCallbackUrl());

    await systemRepo.updateResource<Project>({
      ...project,
      secret: upsertProjectSettings(project.secret, {
        QUICKBOOKS_REALM_ID: realmId,
        QUICKBOOKS_REFRESH_TOKEN: tokens.refreshToken,
        QUICKBOOKS_ACCESS_TOKEN: tokens.accessToken,
        QUICKBOOKS_ACCESS_TOKEN_EXPIRES_AT: tokens.accessTokenExpiresAt,
      }),
    });

    sendCallbackPage(
      res,
      200,
      'QuickBooks connected',
      `This project is now connected to QuickBooks company ${realmId}. You can close this window.`
    );
  } catch (error) {
    globalLogger.error('[quickbooks] OAuth callback error', { error, projectId: payload.projectId });
    sendCallbackPage(res, 400, 'QuickBooks connection failed', (error as Error).message);
  }
};

export const quickbooksRouter = Router();
quickbooksRouter.get('/connect', authenticateRequest, verifyProjectAdmin, quickBooksConnectHandler);
quickbooksRouter.get('/callback', quickBooksCallbackHandler);
