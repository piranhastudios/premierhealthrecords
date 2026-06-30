// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Provider-agnostic inbound-email normalization. Each adapter maps a provider's
 * webhook payload into a single {@link NormalizedInboundEmail} shape so the
 * inbound-email bot has exactly one code path. Adapters are defensive: providers
 * differ in casing and envelope shape, so fields are extracted, not assumed.
 */

export type InboundEmailProvider = 'resend' | 'mailgun' | 'sendgrid' | 'ses' | 'generic';

export interface NormalizedAttachment {
  filename: string;
  contentType: string;
  // base64-encoded content, when the provider inlines attachments.
  contentBase64?: string;
  // URL to fetch the attachment, when the provider hosts it.
  url?: string;
}

export interface NormalizedInboundEmail {
  from: string;
  to: string[];
  subject: string;
  text?: string;
  html?: string;
  messageId: string;
  inReplyTo?: string;
  references: string[];
  attachments: NormalizedAttachment[];
  rawHeaders: Record<string, string>;
}

type HeaderBag = Record<string, string | string[] | undefined> | { name: string; value: string }[] | undefined;

// Case-insensitive header lookup across the shapes providers use.
export function extractHeader(headers: HeaderBag, name: string): string | undefined {
  const target = name.toLowerCase();
  if (!headers) {
    return undefined;
  }
  if (Array.isArray(headers)) {
    const found = headers.find((h) => h.name?.toLowerCase() === target);
    return found?.value;
  }
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) {
      return Array.isArray(value) ? value[0] : value;
    }
  }
  return undefined;
}

function headersToRecord(headers: HeaderBag): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) {
    return out;
  }
  if (Array.isArray(headers)) {
    for (const { name, value } of headers) {
      if (name) {
        out[name] = value;
      }
    }
    return out;
  }
  for (const [key, value] of Object.entries(headers)) {
    if (value !== undefined) {
      out[key] = Array.isArray(value) ? value.join(', ') : value;
    }
  }
  return out;
}

// Split an RFC-5322 References / In-Reply-To value into individual message-ids.
export function splitMessageIds(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Pull the bare address out of a `Display Name <addr@host>` value.
export function parseAddress(value: string | undefined): string {
  if (!value) {
    return '';
  }
  const match = value.match(/<([^>]+)>/);
  return (match ? match[1] : value).trim().toLowerCase();
}

function toArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => parseAddress(String(v))).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((v) => parseAddress(v))
      .filter(Boolean);
  }
  return [];
}

// The payload already matches our normalized shape (used by tests / simple proxies).
export function fromGeneric(payload: Record<string, any>): NormalizedInboundEmail {
  return {
    from: parseAddress(payload.from),
    to: toArray(payload.to),
    subject: payload.subject ?? '',
    text: payload.text,
    html: payload.html,
    messageId: payload.messageId ?? payload.message_id ?? '',
    inReplyTo: payload.inReplyTo ?? payload.in_reply_to,
    references: Array.isArray(payload.references) ? payload.references : splitMessageIds(payload.references),
    attachments: Array.isArray(payload.attachments) ? payload.attachments : [],
    rawHeaders: payload.rawHeaders ?? {},
  };
}

// Resend inbound email webhook (`{ type, data: {...} }`).
export function fromResend(payload: Record<string, any>): NormalizedInboundEmail {
  const data = payload.data ?? payload;
  const headers = data.headers as HeaderBag;
  const messageId = data.message_id ?? extractHeader(headers, 'Message-ID') ?? '';
  return {
    from: parseAddress(typeof data.from === 'object' ? data.from?.address : data.from),
    to: toArray(data.to?.map?.((t: any) => (typeof t === 'object' ? t.address : t)) ?? data.to),
    subject: data.subject ?? '',
    text: data.text,
    html: data.html,
    messageId,
    inReplyTo: data.in_reply_to ?? extractHeader(headers, 'In-Reply-To'),
    references: splitMessageIds(data.references ?? extractHeader(headers, 'References')),
    attachments: (data.attachments ?? []).map(mapInlineAttachment),
    rawHeaders: headersToRecord(headers),
  };
}

// Mailgun Routes store/forward (form-encoded fields).
export function fromMailgun(payload: Record<string, any>): NormalizedInboundEmail {
  return {
    from: parseAddress(payload.sender ?? payload.from),
    to: toArray(payload.recipient ?? payload.to),
    subject: payload.subject ?? '',
    text: payload['body-plain'] ?? payload['stripped-text'],
    html: payload['body-html'] ?? payload['stripped-html'],
    messageId: payload['Message-Id'] ?? payload['message-id'] ?? '',
    inReplyTo: payload['In-Reply-To'],
    references: splitMessageIds(payload.References),
    attachments: [],
    rawHeaders: safeJsonRecord(payload['message-headers']),
  };
}

// SendGrid Inbound Parse (multipart form fields).
export function fromSendgrid(payload: Record<string, any>): NormalizedInboundEmail {
  const headers = parseRawHeaders(payload.headers);
  return {
    from: parseAddress(payload.from),
    to: toArray(payload.to),
    subject: payload.subject ?? '',
    text: payload.text,
    html: payload.html,
    messageId: extractHeader(headers, 'Message-ID') ?? '',
    inReplyTo: extractHeader(headers, 'In-Reply-To'),
    references: splitMessageIds(extractHeader(headers, 'References')),
    attachments: [],
    rawHeaders: headers,
  };
}

// AWS SES inbound (already-unwrapped SNS `mail`/`content` notification).
export function fromSes(payload: Record<string, any>): NormalizedInboundEmail {
  const mail = payload.mail ?? payload;
  const common = mail.commonHeaders ?? {};
  const headers = mail.headers as HeaderBag;
  return {
    from: parseAddress(Array.isArray(common.from) ? common.from[0] : common.from),
    to: toArray(common.to),
    subject: common.subject ?? '',
    text: payload.text,
    html: payload.html,
    messageId: common.messageId ?? extractHeader(headers, 'Message-ID') ?? '',
    inReplyTo: extractHeader(headers, 'In-Reply-To'),
    references: splitMessageIds(extractHeader(headers, 'References')),
    attachments: [],
    rawHeaders: headersToRecord(headers),
  };
}

const ADAPTERS: Record<InboundEmailProvider, (payload: Record<string, any>) => NormalizedInboundEmail> = {
  resend: fromResend,
  mailgun: fromMailgun,
  sendgrid: fromSendgrid,
  ses: fromSes,
  generic: fromGeneric,
};

// Normalize a raw provider webhook payload into the canonical shape.
export function normalizeInboundEmail(
  provider: InboundEmailProvider,
  payload: Record<string, any>
): NormalizedInboundEmail {
  const adapter = ADAPTERS[provider] ?? fromGeneric;
  return adapter(payload);
}

function mapInlineAttachment(att: any): NormalizedAttachment {
  return {
    filename: att.filename ?? att.name ?? 'attachment',
    contentType: att.content_type ?? att.contentType ?? 'application/octet-stream',
    contentBase64: att.content ?? att.contentBase64,
    url: att.url,
  };
}

function parseRawHeaders(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'string') {
    return {};
  }
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx > 0) {
      out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
  }
  return out;
}

function safeJsonRecord(raw: unknown): Record<string, string> {
  if (typeof raw !== 'string') {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const out: Record<string, string> = {};
      for (const entry of parsed) {
        if (Array.isArray(entry) && entry.length >= 2) {
          out[String(entry[0])] = String(entry[1]);
        }
      }
      return out;
    }
  } catch {
    // ignore malformed header blobs
  }
  return {};
}
