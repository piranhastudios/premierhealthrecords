// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { Basic, Communication } from '@medplum/fhirtypes';
import {
  channelToMedium,
  EXT_TEMPLATE_BODY_PREVIEW,
  EXT_TEMPLATE_NAME,
  EXT_TEMPLATE_VARIABLE,
  EXT_WHATSAPP_WINDOW,
  getThreadChannel,
  getWhatsappWindowExpiresAt,
  isWhatsappWindowOpen,
  parseWhatsAppTemplate,
  renderTemplatePreview,
  TWILIO_CONTENT_SYSTEM,
  whatsappTemplateExtension,
} from './constants';

describe('ChannelReply constants', () => {
  test('channelToMedium / getThreadChannel round-trip', () => {
    const whatsapp: Communication = {
      resourceType: 'Communication',
      status: 'in-progress',
      medium: [channelToMedium('whatsapp')],
    };
    const email: Communication = {
      resourceType: 'Communication',
      status: 'in-progress',
      medium: [channelToMedium('email')],
    };
    expect(getThreadChannel(whatsapp)).toBe('whatsapp');
    expect(getThreadChannel(email)).toBe('email');
    expect(getThreadChannel({ resourceType: 'Communication', status: 'in-progress' })).toBeUndefined();
  });

  test('whatsapp window open/closed', () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const openHeader: Communication = {
      resourceType: 'Communication',
      status: 'in-progress',
      extension: [{ url: EXT_WHATSAPP_WINDOW, extension: [{ url: 'expiresAt', valueInstant: future }] }],
    };
    const closedHeader: Communication = {
      resourceType: 'Communication',
      status: 'in-progress',
      extension: [{ url: EXT_WHATSAPP_WINDOW, extension: [{ url: 'expiresAt', valueInstant: past }] }],
    };
    expect(isWhatsappWindowOpen(openHeader)).toBe(true);
    expect(isWhatsappWindowOpen(closedHeader)).toBe(false);
    expect(getWhatsappWindowExpiresAt(openHeader)).toBe(future);
    expect(isWhatsappWindowOpen(undefined)).toBe(false);
  });

  test('whatsappTemplateExtension serializes vars', () => {
    const ext = whatsappTemplateExtension({ sid: 'HX1', vars: { '1': 'Jane' } });
    expect(ext.extension?.find((e) => e.url === 'sid')?.valueString).toBe('HX1');
    expect(ext.extension?.find((e) => e.url === 'vars')?.valueString).toBe('{"1":"Jane"}');
  });

  test('parseWhatsAppTemplate and renderTemplatePreview', () => {
    const basic: Basic = {
      resourceType: 'Basic',
      id: 't1',
      code: {},
      identifier: [{ system: TWILIO_CONTENT_SYSTEM, value: 'HX9' }],
      extension: [
        { url: EXT_TEMPLATE_NAME, valueString: 'Appointment reminder' },
        { url: EXT_TEMPLATE_BODY_PREVIEW, valueString: 'Hi {{1}}, your appt is {{2}}' },
        { url: EXT_TEMPLATE_VARIABLE, valueString: 'Patient name' },
        { url: EXT_TEMPLATE_VARIABLE, valueString: 'Date' },
      ],
    };
    const template = parseWhatsAppTemplate(basic);
    expect(template?.contentSid).toBe('HX9');
    expect(template?.variables).toEqual([
      { index: '1', label: 'Patient name' },
      { index: '2', label: 'Date' },
    ]);
    expect(renderTemplatePreview(template?.bodyPreview ?? '', { '1': 'Jane', '2': 'Monday' })).toBe(
      'Hi Jane, your appt is Monday'
    );
    expect(parseWhatsAppTemplate({ resourceType: 'Basic', code: {} } as Basic)).toBeUndefined();
  });
});
