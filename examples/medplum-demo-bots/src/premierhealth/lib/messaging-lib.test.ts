// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { Communication, Patient } from '@medplum/fhirtypes';
import { describe, expect, test } from 'vitest';
import { resolvePatientEndpoint } from './channel-resolver';
import { channelToMedium, mediumToChannel } from './constants';
import {
  extractHeader,
  fromMailgun,
  fromResendReceived,
  normalizeInboundEmail,
  parseAddress,
  splitMessageIds,
} from './email-adapters';
import {
  emailHeadersExtension,
  getEmailHeaders,
  getWhatsappTemplate,
  isWhatsappWindowOpen,
  setDeliveryStatus,
  whatsappTemplateExtension,
  whatsappWindowExtension,
} from './extensions';
import { normalizeE164, stripWhatsappPrefix, toWhatsappAddress } from './phone';
import { buildReplyHeaders, generateMessageId } from './resend';
import { twilioConfigFromSecrets } from './twilio';

describe('phone', () => {
  test('strips whatsapp prefix and normalizes', () => {
    expect(stripWhatsappPrefix('whatsapp:+237650000000')).toBe('+237650000000');
    expect(normalizeE164('whatsapp:+237 650 000 000')).toBe('+237650000000');
    expect(normalizeE164('00237650000000')).toBe('+237650000000');
    expect(normalizeE164('0650000000')).toBe('+237650000000');
    expect(toWhatsappAddress('+237650000000')).toBe('whatsapp:+237650000000');
  });
});

describe('channel medium round-trip', () => {
  test('whatsapp and email', () => {
    expect(mediumToChannel([channelToMedium('whatsapp')])).toBe('whatsapp');
    expect(mediumToChannel([channelToMedium('email')])).toBe('email');
    expect(mediumToChannel(undefined)).toBeUndefined();
  });
});

describe('channel resolver', () => {
  const patient: Patient = {
    resourceType: 'Patient',
    telecom: [
      { system: 'phone', value: '+237650000000' },
      { system: 'email', value: 'Test@Example.com' },
    ],
  };
  test('resolves whatsapp from phone and email lowercased', () => {
    expect(resolvePatientEndpoint(patient, 'whatsapp')).toBe('+237650000000');
    expect(resolvePatientEndpoint(patient, 'email')).toBe('test@example.com');
  });
  test('returns undefined when missing', () => {
    expect(resolvePatientEndpoint({ resourceType: 'Patient' }, 'whatsapp')).toBeUndefined();
  });
});

describe('whatsapp window', () => {
  test('open within 24h, closed after', () => {
    const now = new Date('2026-06-30T12:00:00.000Z');
    const recent: Communication = {
      resourceType: 'Communication',
      status: 'in-progress',
      extension: [whatsappWindowExtension('2026-06-30T06:00:00.000Z')],
    };
    const stale: Communication = {
      resourceType: 'Communication',
      status: 'in-progress',
      extension: [whatsappWindowExtension('2026-06-29T06:00:00.000Z')],
    };
    expect(isWhatsappWindowOpen(recent, now)).toBe(true);
    expect(isWhatsappWindowOpen(stale, now)).toBe(false);
    expect(isWhatsappWindowOpen({ resourceType: 'Communication', status: 'in-progress' }, now)).toBe(false);
  });
});

describe('email headers extension', () => {
  test('write then read', () => {
    const comm: Communication = {
      resourceType: 'Communication',
      status: 'in-progress',
      extension: [
        emailHeadersExtension({ messageId: '<a@x>', inReplyTo: '<b@x>', references: '<b@x> <a@x>', subject: 'Hi' }),
      ],
    };
    expect(getEmailHeaders(comm)).toEqual({
      messageId: '<a@x>',
      inReplyTo: '<b@x>',
      references: '<b@x> <a@x>',
      subject: 'Hi',
    });
  });
});

describe('whatsapp template extension', () => {
  test('write then read with vars', () => {
    const comm: Communication = {
      resourceType: 'Communication',
      status: 'in-progress',
      extension: [whatsappTemplateExtension({ sid: 'HX1', vars: { '1': 'Jane' } })],
    };
    expect(getWhatsappTemplate(comm)).toEqual({ sid: 'HX1', vars: { '1': 'Jane' } });
  });
});

describe('delivery status', () => {
  test('upserts status, timestamp, and clears error on success', () => {
    let ext = setDeliveryStatus(undefined, 'failed', '2026-06-30T12:00:00.000Z', 'boom');
    expect(ext.find((e) => e.url.endsWith('delivery-status'))?.valueCode).toBe('failed');
    expect(ext.find((e) => e.url.endsWith('delivery-error'))?.valueString).toBe('boom');
    ext = setDeliveryStatus(ext, 'sent', '2026-06-30T12:05:00.000Z');
    expect(ext.find((e) => e.url.endsWith('delivery-status'))?.valueCode).toBe('sent');
    expect(ext.find((e) => e.url.endsWith('delivery-error'))).toBeUndefined();
  });
});

describe('email threading headers', () => {
  test('first message has only Message-ID', () => {
    expect(buildReplyHeaders('<new@x>', undefined)).toEqual({ messageId: '<new@x>' });
  });
  test('reply chains References and sets In-Reply-To', () => {
    const result = buildReplyHeaders('<new@x>', { messageId: '<b@x>', references: '<a@x>', inReplyTo: '<a@x>' });
    expect(result.inReplyTo).toBe('<b@x>');
    expect(result.references).toBe('<a@x> <b@x>');
    expect(result.messageId).toBe('<new@x>');
  });
  test('generateMessageId uses sender domain', () => {
    expect(generateMessageId('care@premierhealth.cm')).toMatch(/@premierhealth\.cm>$/);
  });
});

describe('inbound email adapters', () => {
  test('parseAddress and splitMessageIds', () => {
    expect(parseAddress('Jane Doe <jane@x.com>')).toBe('jane@x.com');
    expect(splitMessageIds('<a@x>  <b@x>')).toEqual(['<a@x>', '<b@x>']);
  });
  test('extractHeader is case-insensitive across shapes', () => {
    expect(extractHeader([{ name: 'Message-ID', value: '<a@x>' }], 'message-id')).toBe('<a@x>');
    expect(extractHeader({ 'In-Reply-To': '<b@x>' }, 'in-reply-to')).toBe('<b@x>');
  });
  test('fromResendReceived combines webhook metadata + fetched content', () => {
    const email = fromResendReceived(
      {
        email_id: 'eml_1',
        from: 'Jane <jane@x.com>',
        to: ['care@premierhealth.cm'],
        subject: 'Re: Hello',
        message_id: '<m1@x>',
      },
      {
        text: 'hi',
        headers: [
          { name: 'In-Reply-To', value: '<m0@x>' },
          { name: 'References', value: '<m0@x>' },
        ],
      },
      [{ filename: 'scan.pdf', downloadUrl: 'https://dl.resend/scan.pdf', contentType: 'application/pdf' }]
    );
    expect(email.from).toBe('jane@x.com');
    expect(email.messageId).toBe('<m1@x>');
    expect(email.inReplyTo).toBe('<m0@x>');
    expect(email.references).toEqual(['<m0@x>']);
    expect(email.text).toBe('hi');
    expect(email.attachments[0]).toEqual({
      filename: 'scan.pdf',
      contentType: 'application/pdf',
      url: 'https://dl.resend/scan.pdf',
    });
  });
  test('fromMailgun reads form fields', () => {
    const email = fromMailgun({
      sender: 'jane@x.com',
      recipient: 'care@premierhealth.cm',
      subject: 'Hello',
      'body-plain': 'hi there',
      'Message-Id': '<m1@x>',
    });
    expect(email.from).toBe('jane@x.com');
    expect(email.text).toBe('hi there');
    expect(email.messageId).toBe('<m1@x>');
  });
  test('normalizeInboundEmail dispatches by provider', () => {
    const email = normalizeInboundEmail('generic', {
      from: 'jane@x.com',
      to: 'care@x.com',
      subject: 's',
      messageId: '<m@x>',
    });
    expect(email.from).toBe('jane@x.com');
    expect(email.messageId).toBe('<m@x>');
  });
});

describe('twilio config dev-mode flag', () => {
  const base = {
    TWILIO_ACCOUNT_SID: { name: 'TWILIO_ACCOUNT_SID', valueString: 'AC1' },
    TWILIO_AUTH_TOKEN: { name: 'TWILIO_AUTH_TOKEN', valueString: 'tok' },
    TWILIO_WHATSAPP_NUMBER: { name: 'TWILIO_WHATSAPP_NUMBER', valueString: '+237600000000' },
  };
  const sandboxOn = { TWILIO_SANDBOX: { name: 'TWILIO_SANDBOX', valueString: 'true' } };
  test('production uses live credentials + business number', () => {
    const config = twilioConfigFromSecrets(base);
    expect(config.sandbox).toBe(false);
    expect(config.accountSid).toBe('AC1');
    expect(config.whatsappFrom).toBe('+237600000000');
  });
  test('TWILIO_SANDBOX=true uses the sandbox number (default +14155238886)', () => {
    const config = twilioConfigFromSecrets({ ...base, ...sandboxOn });
    expect(config.sandbox).toBe(true);
    expect(config.whatsappFrom).toBe('+14155238886');
  });
  test('sandbox falls back to live credentials when no test pair is set', () => {
    const config = twilioConfigFromSecrets({ ...base, ...sandboxOn });
    expect(config.accountSid).toBe('AC1');
    expect(config.authToken).toBe('tok');
  });
  test('sandbox uses the TWILIO_TEST_* pair when provided', () => {
    const config = twilioConfigFromSecrets({
      ...base,
      ...sandboxOn,
      TWILIO_TEST_ACCOUNT_SID: { name: 'TWILIO_TEST_ACCOUNT_SID', valueString: 'ACtest' },
      TWILIO_TEST_AUTH_TOKEN: { name: 'TWILIO_TEST_AUTH_TOKEN', valueString: 'toktest' },
    });
    expect(config.accountSid).toBe('ACtest');
    expect(config.authToken).toBe('toktest');
    expect(config.whatsappFrom).toBe('+14155238886');
  });
  test('sandbox mode works without a production number', () => {
    const config = twilioConfigFromSecrets({
      TWILIO_ACCOUNT_SID: base.TWILIO_ACCOUNT_SID,
      TWILIO_AUTH_TOKEN: base.TWILIO_AUTH_TOKEN,
      ...sandboxOn,
    });
    expect(config.whatsappFrom).toBe('+14155238886');
  });
});
