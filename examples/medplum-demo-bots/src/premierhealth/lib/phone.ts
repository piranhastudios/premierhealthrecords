// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Best-effort phone canonicalization for matching `Patient.telecom` against the
 * E.164 numbers Twilio delivers. Full libphonenumber parsing is intentionally
 * avoided to keep the bot bundle small; see the messaging plan's normalization
 * risk note. Default country code is Cameroon (+237).
 */

const DEFAULT_COUNTRY_CODE = '237';

// Remove the `whatsapp:` channel prefix Twilio prepends to WhatsApp addresses.
export function stripWhatsappPrefix(value: string): string {
  return value.replace(/^whatsapp:/i, '').trim();
}

// Add the `whatsapp:` prefix required by the Twilio WhatsApp API.
export function toWhatsappAddress(e164: string): string {
  return `whatsapp:${e164}`;
}

// Normalize a phone string to an E.164-ish form (`+<digits>`). Already-prefixed
// numbers are preserved; `00` international prefixes and bare national numbers are
// upgraded using the default country code.
export function normalizeE164(value: string, defaultCountryCode = DEFAULT_COUNTRY_CODE): string {
  const v = stripWhatsappPrefix(value).replace(/[\s()\-.]/g, '');
  if (v.startsWith('+')) {
    return v;
  }
  if (v.startsWith('00')) {
    return `+${v.slice(2)}`;
  }
  // Bare national number: drop a single leading trunk zero and prepend the country code.
  return `+${defaultCountryCode}${v.replace(/^0+/, '')}`;
}
