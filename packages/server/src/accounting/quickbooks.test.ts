// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { Patient, Project } from '@medplum/fhirtypes';
import type { QuickBooksConfig } from './quickbooks';
import {
  buildCustomerDisplayName,
  escapeQboQueryValue,
  exchangeAuthCode,
  getQuickBooksConfig,
  QBO_CUSTOMER_ID_SYSTEM,
  QBO_OAUTH_TOKEN_URL,
  QBO_SANDBOX_URL,
  QuickBooksApiError,
  QuickBooksProvider,
} from './quickbooks';

const originalFetch = global.fetch;

type FetchMock = jest.Mock<Promise<Response>, Parameters<typeof fetch>>;

// The mocks below always pass string URLs/bodies, so these accessors are safe.
function callUrl(fetchMock: FetchMock, index = 0): string {
  return fetchMock.mock.calls[index][0] as string;
}

function callBody(fetchMock: FetchMock, index = 0): string {
  return fetchMock.mock.calls[index][1]?.body as string;
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function tokenResponse(overrides?: Record<string, unknown>): Response {
  return jsonResponse(200, {
    access_token: 'new-access-token',
    refresh_token: 'rotated-refresh-token',
    expires_in: 3600,
    x_refresh_token_expires_in: 8726400,
    ...overrides,
  });
}

function testConfig(overrides?: Partial<QuickBooksConfig>): QuickBooksConfig {
  return {
    clientId: 'client-id',
    clientSecret: 'client-secret',
    realmId: 'realm-1',
    refreshToken: 'old-refresh-token',
    baseUrl: QBO_SANDBOX_URL,
    ...overrides,
  };
}

// A config whose cached access token is still valid (no refresh needed).
function freshTokenConfig(): QuickBooksConfig {
  return testConfig({
    accessToken: 'cached-access-token',
    accessTokenExpiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  });
}

describe('getQuickBooksConfig', () => {
  const project: Project = {
    resourceType: 'Project',
    id: 'p1',
    secret: [
      { name: 'QUICKBOOKS_CLIENT_ID', valueString: 'cid' },
      { name: 'QUICKBOOKS_CLIENT_SECRET', valueString: 'csecret' },
      { name: 'QUICKBOOKS_REALM_ID', valueString: 'realm' },
      { name: 'QUICKBOOKS_REFRESH_TOKEN', valueString: 'rtoken' },
    ],
  };

  test('resolves project secrets with sandbox default base URL', () => {
    const config = getQuickBooksConfig(project);
    expect(config).toMatchObject({
      clientId: 'cid',
      clientSecret: 'csecret',
      realmId: 'realm',
      refreshToken: 'rtoken',
      baseUrl: QBO_SANDBOX_URL,
    });
  });

  test('falls back to env vars', () => {
    process.env.QUICKBOOKS_REALM_ID = 'env-realm';
    process.env.QUICKBOOKS_REFRESH_TOKEN = 'env-rtoken';
    try {
      const config = getQuickBooksConfig({
        resourceType: 'Project',
        id: 'p2',
        secret: [
          { name: 'QUICKBOOKS_CLIENT_ID', valueString: 'cid' },
          { name: 'QUICKBOOKS_CLIENT_SECRET', valueString: 'csecret' },
        ],
      });
      expect(config.realmId).toBe('env-realm');
      expect(config.refreshToken).toBe('env-rtoken');
    } finally {
      delete process.env.QUICKBOOKS_REALM_ID;
      delete process.env.QUICKBOOKS_REFRESH_TOKEN;
    }
  });

  test('throws when not connected', () => {
    expect(() =>
      getQuickBooksConfig({
        resourceType: 'Project',
        id: 'p3',
        secret: [
          { name: 'QUICKBOOKS_CLIENT_ID', valueString: 'cid' },
          { name: 'QUICKBOOKS_CLIENT_SECRET', valueString: 'csecret' },
        ],
      })
    ).toThrow(/not connected/);
  });

  test('throws when app credentials missing', () => {
    expect(() => getQuickBooksConfig({ resourceType: 'Project', id: 'p4' })).toThrow(/QUICKBOOKS_CLIENT_ID/);
  });
});

describe('QuickBooksProvider token management', () => {
  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('refreshes when no access token and detects rotated refresh_token', async () => {
    const fetchMock = jest
      .fn<Promise<Response>, Parameters<typeof fetch>>()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse(200, { QueryResponse: { Item: [] } }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const provider = new QuickBooksProvider(testConfig());
    await provider.listItems();

    // First call is the OAuth token endpoint with Basic auth + refresh_token grant.
    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0];
    expect(tokenUrl).toBe(QBO_OAUTH_TOKEN_URL);
    expect((tokenInit?.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from('client-id:client-secret').toString('base64')}`
    );
    const tokenBody = callBody(fetchMock, 0);
    expect(tokenBody).toContain('grant_type=refresh_token');
    expect(tokenBody).toContain('refresh_token=old-refresh-token');

    // The rotated token set is exposed for the caller to persist.
    const rotated = provider.getRotatedTokens();
    expect(rotated?.refreshToken).toBe('rotated-refresh-token');
    expect(rotated?.accessToken).toBe('new-access-token');
    expect(Date.parse(rotated?.accessTokenExpiresAt as string)).toBeGreaterThan(Date.now());

    // The API call then uses the new access token.
    const apiUrl = callUrl(fetchMock, 1);
    expect(apiUrl).toContain(`/v3/company/realm-1/query`);
    expect(apiUrl).toContain('minorversion=75');
    expect((fetchMock.mock.calls[1][1]?.headers as Record<string, string>).Authorization).toBe(
      'Bearer new-access-token'
    );
  });

  test('does not refresh when the cached access token is still valid', async () => {
    const fetchMock = jest
      .fn<Promise<Response>, Parameters<typeof fetch>>()
      .mockResolvedValueOnce(jsonResponse(200, { QueryResponse: {} }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const provider = new QuickBooksProvider(freshTokenConfig());
    await provider.listItems();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0][1]?.headers as Record<string, string>).Authorization).toBe(
      'Bearer cached-access-token'
    );
    expect(provider.getRotatedTokens()).toBeUndefined();
  });

  test('refreshes when the cached access token expires within 2 minutes', async () => {
    const fetchMock = jest
      .fn<Promise<Response>, Parameters<typeof fetch>>()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse(200, { QueryResponse: {} }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const provider = new QuickBooksProvider(
      testConfig({
        accessToken: 'nearly-expired',
        accessTokenExpiresAt: new Date(Date.now() + 60 * 1000).toISOString(),
      })
    );
    await provider.listItems();

    expect(fetchMock.mock.calls[0][0]).toBe(QBO_OAUTH_TOKEN_URL);
    expect(provider.getRotatedTokens()?.refreshToken).toBe('rotated-refresh-token');
  });

  test('401 triggers exactly one refresh and retry', async () => {
    const fetchMock = jest
      .fn<Promise<Response>, Parameters<typeof fetch>>()
      .mockResolvedValueOnce(jsonResponse(401, { fault: 'token expired' }))
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse(200, { QueryResponse: { Item: [{ Id: '1', Name: 'Consult' }] } }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const provider = new QuickBooksProvider(freshTokenConfig());
    const items = await provider.listItems();

    expect(items).toEqual([{ Id: '1', Name: 'Consult' }]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1][0]).toBe(QBO_OAUTH_TOKEN_URL);
    expect((fetchMock.mock.calls[2][1]?.headers as Record<string, string>).Authorization).toBe(
      'Bearer new-access-token'
    );
    expect(provider.getRotatedTokens()?.refreshToken).toBe('rotated-refresh-token');
  });

  test('a second 401 after the retry fails without another refresh', async () => {
    const fetchMock = jest
      .fn<Promise<Response>, Parameters<typeof fetch>>()
      .mockResolvedValueOnce(jsonResponse(401, {}))
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse(401, {}));
    global.fetch = fetchMock as unknown as typeof fetch;

    const provider = new QuickBooksProvider(freshTokenConfig());
    await expect(provider.listItems()).rejects.toThrow(QuickBooksApiError);
    // request, refresh, retry — and no second refresh attempt.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  test('token failure message is redacted — no token material leaks', async () => {
    // A partial success (access token present, refresh token missing) must not
    // surface the live access token in the thrown error.
    const fetchMock = jest.fn<Promise<Response>, Parameters<typeof fetch>>().mockResolvedValueOnce(
      tokenResponse({
        refresh_token: undefined,
        error: 'invalid_request',
        error_description: 'refresh token missing',
      })
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const provider = new QuickBooksProvider(testConfig());
    const error = (await provider.listItems().catch((e) => e)) as QuickBooksApiError;
    expect(error).toBeInstanceOf(QuickBooksApiError);
    expect(error.message).toContain('invalid_request');
    expect(error.message).toContain('refresh token missing');
    expect(error.message).not.toContain('new-access-token');
  });

  test('4xx is non-retryable and 5xx is retryable', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce(jsonResponse(400, { Fault: {} })) as unknown as typeof fetch;
    const provider = new QuickBooksProvider(freshTokenConfig());
    await expect(provider.listItems()).rejects.toMatchObject({ status: 400, retryable: false });

    global.fetch = jest.fn().mockResolvedValueOnce(jsonResponse(503, {})) as unknown as typeof fetch;
    const provider2 = new QuickBooksProvider(freshTokenConfig());
    await expect(provider2.listItems()).rejects.toMatchObject({ status: 503, retryable: true });
  });
});

describe('exchangeAuthCode', () => {
  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('posts the authorization_code grant with the redirect URI', async () => {
    const fetchMock = jest.fn<Promise<Response>, Parameters<typeof fetch>>().mockResolvedValueOnce(tokenResponse());
    global.fetch = fetchMock as unknown as typeof fetch;

    const tokens = await exchangeAuthCode(
      { clientId: 'client-id', clientSecret: 'client-secret' },
      'auth-code',
      'https://example.com/api/accounting/quickbooks/callback'
    );

    expect(tokens.refreshToken).toBe('rotated-refresh-token');
    const body = callBody(fetchMock, 0);
    expect(body).toContain('grant_type=authorization_code');
    expect(body).toContain('code=auth-code');
    expect(body).toContain(encodeURIComponent('https://example.com/api/accounting/quickbooks/callback'));
  });
});

describe('ensureCustomer', () => {
  afterEach(() => {
    global.fetch = originalFetch;
  });

  const patient: Patient = {
    resourceType: 'Patient',
    id: 'abcd1234-ef56-7890',
    name: [{ given: ['Ama'], family: "N'Guessan" }],
    telecom: [{ system: 'email', value: 'ama@example.com' }],
  };

  test('returns the stored identifier without calling QBO', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const provider = new QuickBooksProvider(freshTokenConfig());
    const result = await provider.ensureCustomer({
      ...patient,
      identifier: [{ system: QBO_CUSTOMER_ID_SYSTEM, value: '42' }],
    });

    expect(result).toEqual({ customerId: '42', created: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('query hit: returns the existing customer without creating', async () => {
    const fetchMock = jest
      .fn<Promise<Response>, Parameters<typeof fetch>>()
      .mockResolvedValueOnce(jsonResponse(200, { QueryResponse: { Customer: [{ Id: '77' }] } }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const provider = new QuickBooksProvider(freshTokenConfig());
    const result = await provider.ensureCustomer(patient);

    expect(result).toEqual({ customerId: '77', created: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // DisplayName is disambiguated with a Patient id suffix, and quotes are escaped.
    const queryUrl = decodeURIComponent(callUrl(fetchMock, 0));
    expect(queryUrl).toContain("DisplayName = 'Ama N\\'Guessan (abcd1234)'");
  });

  test('query miss: creates the customer', async () => {
    const fetchMock = jest
      .fn<Promise<Response>, Parameters<typeof fetch>>()
      .mockResolvedValueOnce(jsonResponse(200, { QueryResponse: {} }))
      .mockResolvedValueOnce(jsonResponse(200, { Customer: { Id: '88' } }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const provider = new QuickBooksProvider(freshTokenConfig());
    const result = await provider.ensureCustomer(patient);

    expect(result).toEqual({ customerId: '88', created: true });
    expect(callUrl(fetchMock, 1)).toContain('/v3/company/realm-1/customer');
    const body = JSON.parse(callBody(fetchMock, 1));
    expect(body).toMatchObject({
      DisplayName: "Ama N'Guessan (abcd1234)",
      GivenName: 'Ama',
      FamilyName: "N'Guessan",
      PrimaryEmailAddr: { Address: 'ama@example.com' },
    });
  });
});

describe('upsertInvoice', () => {
  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('builds SalesItemLineDetail lines with major-unit amounts', async () => {
    const fetchMock = jest
      .fn<Promise<Response>, Parameters<typeof fetch>>()
      .mockResolvedValueOnce(jsonResponse(200, { Invoice: { Id: '501' } }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const provider = new QuickBooksProvider(freshTokenConfig());
    const result = await provider.upsertInvoice({
      customerId: '77',
      docNumber: 'inv-1',
      lines: [
        { itemId: '10', amount: 25000, description: 'Consultation' },
        { itemId: '11', amount: 1500.5, description: 'Lab test' },
      ],
    });

    expect(result.invoiceId).toBe('501');
    const body = JSON.parse(callBody(fetchMock, 0));
    expect(body.CustomerRef).toEqual({ value: '77' });
    expect(body.DocNumber).toBe('inv-1');
    // QBO amounts are decimal MAJOR units: a 25,000 XAF consultation stays 25000.
    expect(body.Line).toEqual([
      {
        DetailType: 'SalesItemLineDetail',
        Amount: 25000,
        Description: 'Consultation',
        SalesItemLineDetail: { ItemRef: { value: '10' } },
      },
      {
        DetailType: 'SalesItemLineDetail',
        Amount: 1500.5,
        Description: 'Lab test',
        SalesItemLineDetail: { ItemRef: { value: '11' } },
      },
    ]);
  });

  test('update path reads the current SyncToken and sends a sparse update', async () => {
    const fetchMock = jest
      .fn<Promise<Response>, Parameters<typeof fetch>>()
      .mockResolvedValueOnce(jsonResponse(200, { Invoice: { Id: '501', SyncToken: '3' } }))
      .mockResolvedValueOnce(jsonResponse(200, { Invoice: { Id: '501' } }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const provider = new QuickBooksProvider(freshTokenConfig());
    await provider.upsertInvoice({
      customerId: '77',
      existingInvoiceId: '501',
      lines: [{ itemId: '10', amount: 25000 }],
    });

    expect(callUrl(fetchMock, 0)).toContain('/invoice/501');
    expect(fetchMock.mock.calls[0][1]?.method).toBe('GET');
    const body = JSON.parse(callBody(fetchMock, 1));
    expect(body).toMatchObject({ Id: '501', SyncToken: '3', sparse: true });
  });
});

describe('recordPayment', () => {
  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('applies the payment to the invoice via LinkedTxn', async () => {
    const fetchMock = jest
      .fn<Promise<Response>, Parameters<typeof fetch>>()
      .mockResolvedValueOnce(jsonResponse(200, { Payment: { Id: '900' } }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const provider = new QuickBooksProvider(freshTokenConfig());
    const result = await provider.recordPayment({
      customerId: '77',
      qboInvoiceId: '501',
      amount: 25000,
      paymentRefNum: 'recon-1',
    });

    expect(result.paymentId).toBe('900');
    expect(callUrl(fetchMock, 0)).toContain('/v3/company/realm-1/payment');
    const body = JSON.parse(callBody(fetchMock, 0));
    expect(body).toEqual({
      CustomerRef: { value: '77' },
      TotalAmt: 25000,
      PaymentRefNum: 'recon-1',
      Line: [
        {
          Amount: 25000,
          LinkedTxn: [{ TxnId: '501', TxnType: 'Invoice' }],
        },
      ],
    });
  });
});

describe('listItems', () => {
  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('pages with STARTPOSITION/MAXRESULTS until a short page', async () => {
    const page1 = Array.from({ length: 1000 }, (_, i) => ({ Id: String(i + 1), Name: `Item ${i + 1}` }));
    const page2 = [{ Id: '1001', Name: 'Item 1001' }];
    const fetchMock = jest
      .fn<Promise<Response>, Parameters<typeof fetch>>()
      .mockResolvedValueOnce(jsonResponse(200, { QueryResponse: { Item: page1 } }))
      .mockResolvedValueOnce(jsonResponse(200, { QueryResponse: { Item: page2 } }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const provider = new QuickBooksProvider(freshTokenConfig());
    const items = await provider.listItems();

    expect(items).toHaveLength(1001);
    expect(items[0].Id).toBe('1');
    expect(items[1000].Id).toBe('1001');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(decodeURIComponent(callUrl(fetchMock, 0))).toContain('select * from Item STARTPOSITION 1 MAXRESULTS 1000');
    expect(decodeURIComponent(callUrl(fetchMock, 1))).toContain(
      'select * from Item STARTPOSITION 1001 MAXRESULTS 1000'
    );
  });

  test('a single short page needs exactly one query', async () => {
    const fetchMock = jest
      .fn<Promise<Response>, Parameters<typeof fetch>>()
      .mockResolvedValueOnce(jsonResponse(200, { QueryResponse: { Item: [{ Id: '1', Name: 'Consult' }] } }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const provider = new QuickBooksProvider(freshTokenConfig());
    await expect(provider.listItems()).resolves.toEqual([{ Id: '1', Name: 'Consult' }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('getOrCreateDefaultServiceItem', () => {
  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('returns the existing item when found', async () => {
    const fetchMock = jest
      .fn<Promise<Response>, Parameters<typeof fetch>>()
      .mockResolvedValueOnce(
        jsonResponse(200, { QueryResponse: { Item: [{ Id: '55', Name: 'Healthcare Services' }] } })
      );
    global.fetch = fetchMock as unknown as typeof fetch;

    const provider = new QuickBooksProvider(freshTokenConfig());
    await expect(provider.getOrCreateDefaultServiceItem()).resolves.toBe('55');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('creates the item against the first Income account', async () => {
    const fetchMock = jest
      .fn<Promise<Response>, Parameters<typeof fetch>>()
      .mockResolvedValueOnce(jsonResponse(200, { QueryResponse: {} }))
      .mockResolvedValueOnce(jsonResponse(200, { QueryResponse: { Account: [{ Id: '30' }] } }))
      .mockResolvedValueOnce(jsonResponse(200, { Item: { Id: '56' } }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const provider = new QuickBooksProvider(freshTokenConfig());
    await expect(provider.getOrCreateDefaultServiceItem()).resolves.toBe('56');

    const body = JSON.parse(callBody(fetchMock, 2));
    expect(body).toEqual({
      Name: 'Healthcare Services',
      Type: 'Service',
      IncomeAccountRef: { value: '30' },
    });
  });

  test('fails clearly when no Income account exists', async () => {
    const fetchMock = jest
      .fn<Promise<Response>, Parameters<typeof fetch>>()
      .mockResolvedValueOnce(jsonResponse(200, { QueryResponse: {} }))
      .mockResolvedValueOnce(jsonResponse(200, { QueryResponse: {} }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const provider = new QuickBooksProvider(freshTokenConfig());
    await expect(provider.getOrCreateDefaultServiceItem()).rejects.toThrow(/no Income account/);
  });
});

describe('helpers', () => {
  test('escapeQboQueryValue escapes single quotes', () => {
    expect(escapeQboQueryValue("N'Guessan")).toBe("N\\'Guessan");
  });

  test('escapeQboQueryValue escapes backslashes before quotes', () => {
    expect(escapeQboQueryValue('a\\b')).toBe('a\\\\b');
    // A literal `\'` must not survive as an escaped-escape + bare quote.
    expect(escapeQboQueryValue("O\\'Brien")).toBe("O\\\\\\'Brien");
  });

  test('buildCustomerDisplayName handles missing names', () => {
    expect(buildCustomerDisplayName({ resourceType: 'Patient', id: 'abcdefgh-rest' })).toBe('Patient (abcdefgh)');
  });
});
