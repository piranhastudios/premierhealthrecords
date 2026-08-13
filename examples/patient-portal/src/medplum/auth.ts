import type { LoginAuthenticationResponse, MedplumClient, ProfileResource } from '@medplum/core';
import * as AuthSession from 'expo-auth-session';
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';
import { bytesToBase64Url } from '../lib/encoding';
import { config } from '../lib/config';

// Required so the auth session popup can be dismissed on web/native.
WebBrowser.maybeCompleteAuthSession();

export interface Credentials {
  email: string;
  password: string;
}

export interface RegisterInput extends Credentials {
  firstName: string;
  lastName: string;
}

/**
 * Finish a Medplum login: turn a `LoginAuthenticationResponse` into an active
 * profile by exchanging its auth `code` for tokens. Handles the multi-profile
 * case (rare for patients) by selecting the first membership.
 */
async function completeLogin(
  medplum: MedplumClient,
  response: LoginAuthenticationResponse
): Promise<ProfileResource> {
  if (response.mfaRequired) {
    throw new Error('This account uses multi-factor authentication, which is not supported in the app yet.');
  }

  let code = response.code;

  if (!code && response.memberships?.length) {
    // Multiple profiles — pick the first. (Patients normally have exactly one.)
    const chosen = await medplum.post('auth/profile', {
      login: response.login,
      profile: response.memberships[0].id,
    });
    code = (chosen as LoginAuthenticationResponse).code;
  }

  if (!code) {
    throw new Error('Sign-in could not be completed. Please try again.');
  }

  return medplum.processCode(code);
}

/**
 * Sign in an existing patient with email + password (no browser redirect).
 * Uses Medplum's password grant scoped to the patient portal project.
 */
export async function signIn(medplum: MedplumClient, { email, password }: Credentials): Promise<ProfileResource> {
  const response = await medplum.startLogin({
    email: email.trim().toLowerCase(),
    password,
    projectId: config.medplumProjectId || undefined,
    scope: 'openid profile',
    remember: true,
  });
  return completeLogin(medplum, response);
}

/**
 * Create a new patient account in the portal project, then sign in.
 *
 * Flow: startNewUser (creates the User + a login) → startNewPatient (creates the
 * Patient profile + project membership using the project's default patient access
 * policy) → processCode (exchange for tokens). reCAPTCHA is skipped server-side
 * when the project/server has no reCAPTCHA secret configured.
 */
export async function register(medplum: MedplumClient, input: RegisterInput): Promise<ProfileResource> {
  const projectId = config.medplumProjectId;
  if (!projectId) {
    throw new Error('Account creation is not available right now. Please contact Premier Health.');
  }

  const newUser = await medplum.startNewUser({
    projectId,
    firstName: input.firstName.trim(),
    lastName: input.lastName.trim(),
    email: input.email.trim().toLowerCase(),
    password: input.password,
    recaptchaToken: '',
    remember: true,
  });

  const newPatient = await medplum.startNewPatient({ login: newUser.login, projectId });
  if (!newPatient.code) {
    throw new Error('Your account was created, but automatic sign-in failed. Please sign in.');
  }
  return medplum.processCode(newPatient.code);
}

/**
 * Request a password-reset email for an existing patient.
 *
 * Calls Medplum's `auth/resetpassword`, scoped to the portal project so it can
 * locate the (project-scoped) patient User. The server emails a link to the web
 * set-password page; the user resets there, then returns to the app to sign in.
 *
 * Per OWASP anti-enumeration, the server responds "ok" whether or not the email
 * matches an account, so this resolves without revealing account existence.
 */
export async function requestPasswordReset(medplum: MedplumClient, email: string): Promise<void> {
  await medplum.post('auth/resetpassword', {
    email: email.trim().toLowerCase(),
    projectId: config.medplumProjectId || undefined,
  });
}

/**
 * Set a new password from a reset link (`id` + `secret` from the emailed URL).
 *
 * Calls Medplum's public `auth/setpassword` endpoint (no session required — the
 * secret authorizes the change). The server rejects reused links, wrong secrets,
 * and breached passwords, surfacing those as errors.
 */
export async function setNewPassword(
  medplum: MedplumClient,
  input: { id: string; secret: string; password: string }
): Promise<void> {
  await medplum.post('auth/setpassword', input);
}

/**
 * Sign in with OAuth2 PKCE.
 *
 * - Web: delegate to MedplumClient.signInWithRedirect() (browser has sessionStorage
 *   + Web Crypto + window.location).
 * - Native: drive PKCE ourselves (MedplumClient.requestAuthorization relies on
 *   window.location, which no-ops in RN), then hand the code to processCode().
 *   processCode() reads the PKCE verifier from sessionStorage — our polyfill shim
 *   (src/lib/polyfills.ts) holds the value we set below.
 */
export async function login(medplum: MedplumClient): Promise<ProfileResource | undefined> {
  if (Platform.OS === 'web') {
    return medplum.signInWithRedirect();
  }

  const redirectUri = AuthSession.makeRedirectUri({ scheme: 'phc', path: 'auth/callback' });

  const verifier = bytesToBase64Url(Crypto.getRandomBytes(48));
  const challengeB64 = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, {
    encoding: Crypto.CryptoEncoding.BASE64,
  });
  const codeChallenge = challengeB64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  // Stash the verifier where processCode() will look for it.
  (globalThis as unknown as { sessionStorage?: Storage }).sessionStorage?.setItem('codeVerifier', verifier);

  const authUrl = new URL('oauth2/authorize', config.medplumBaseUrl);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', config.medplumClientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('scope', 'openid profile');

  const result = await WebBrowser.openAuthSessionAsync(authUrl.toString(), redirectUri);
  if (result.type !== 'success') {
    return undefined;
  }

  const code = new URL(result.url).searchParams.get('code');
  if (!code) {
    throw new Error('Sign-in failed: no authorization code returned.');
  }

  return medplum.processCode(code, { clientId: config.medplumClientId, redirectUri });
}

export async function logout(medplum: MedplumClient): Promise<void> {
  await medplum.signOut();
}
