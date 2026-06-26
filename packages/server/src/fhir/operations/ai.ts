// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { allOk, badRequest, forbidden, isOk, normalizeErrorString, OperationOutcomeError } from '@medplum/core';
import type { FhirRequest, FhirResponse } from '@medplum/fhir-router';
import type { OperationDefinition, ParametersParameter, Project } from '@medplum/fhirtypes';
import type { Response as ExpressResponse, Request } from 'express';
import { importPKCS8, SignJWT } from 'jose';
import { getAuthenticatedContext } from '../../context';
import { sendOutcome } from '../outcomes';
import { sendFhirResponse } from '../response';
import { parseInputParameters } from './utils/parameters';

const operation: OperationDefinition = {
  resourceType: 'OperationDefinition',
  id: 'ai',
  url: 'https://medplum.com/fhir/OperationDefinition/ai',
  name: 'ai',
  status: 'active',
  kind: 'operation',
  code: 'ai',
  resource: ['Parameters'],
  system: false,
  type: false,
  instance: false,
  parameter: [
    {
      name: 'messages',
      use: 'in',
      min: 1,
      max: '1',
      type: 'string',
      documentation: 'JSON string containing the conversation messages array',
    },
    {
      name: 'model',
      use: 'in',
      min: 1,
      max: '1',
      type: 'string',
      documentation:
        'Vertex AI model to use, publisher-qualified (e.g., google/gemini-2.5-flash, google/gemini-2.5-pro)',
    },
    {
      name: 'tools',
      use: 'in',
      min: 0,
      max: '1',
      type: 'string',
      documentation: 'JSON string containing the tools array (optional)',
    },
    {
      name: 'content',
      use: 'out',
      min: 0,
      max: '1',
      type: 'string',
      documentation: 'AI response content',
    },
    {
      name: 'tool_calls',
      use: 'out',
      min: 0,
      max: '1',
      type: 'string',
      documentation: 'JSON string containing tool calls array',
    },
  ],
};

type AIOperationParameters = {
  messages: string;
  model: string;
  tools?: string;
};

/**
 * Resolved Vertex AI connection: the OpenAI-compatible chat completions endpoint
 * plus the service account used to mint a short-lived access token at call time.
 */
type VertexClient = {
  endpoint: string;
  serviceAccount: GcpServiceAccount;
};

const DEFAULT_VERTEX_REGION = 'us-central1';
const GCP_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GCP_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

export const aiOperationHandler = async (req: Request, res: ExpressResponse): Promise<void> => {
  const fhirRequest: FhirRequest = {
    method: 'POST',
    url: req.url,
    pathname: '',
    params: {},
    query: Object.create(null),
    body: req.body ?? {},
    headers: req.headers,
  };
  const acceptsStreaming = req.header('Accept')?.includes('text/event-stream');
  const result = await aiOperation(fhirRequest, res, acceptsStreaming);

  // If streaming, response already sent
  if (!result) {
    return;
  }

  // Non-streaming response
  if (result.length === 1) {
    if (!isOk(result[0])) {
      throw new OperationOutcomeError(result[0]);
    }
    sendOutcome(res, result[0]);
    return;
  }

  await sendFhirResponse(req, res, result[0], result[1], result[2]);
};

/**
 * Implements FHIR AI operation, backed by Vertex AI.
 * Supports both regular and streaming responses based on Accept header.
 * @param req - The incoming request.
 * @param res - Optional Express response for streaming support.
 * @param acceptsStreaming - Whether the client accepts streaming.
 * @returns The server response. For streaming, returns undefined after response is sent.
 */
export async function aiOperation(
  req: FhirRequest,
  res?: ExpressResponse,
  acceptsStreaming: boolean = false
): Promise<FhirResponse | undefined> {
  const ctx = getAuthenticatedContext();
  if (!ctx.project.features?.includes('ai')) {
    return [forbidden];
  }

  let vertex: VertexClient;
  try {
    vertex = getVertexClient(ctx.project);
  } catch (error) {
    return [badRequest(normalizeErrorString(error))];
  }

  const params = parseInputParameters<AIOperationParameters>(operation, req);
  let messages: any[];
  try {
    messages = JSON.parse(params.messages);
  } catch (error) {
    return [badRequest(normalizeErrorString(error))];
  }

  if (!Array.isArray(messages)) {
    return [badRequest('Messages must be an array')];
  }

  let tools: any[] | undefined;
  if (params.tools) {
    try {
      tools = JSON.parse(params.tools);
    } catch (error) {
      return [badRequest(normalizeErrorString(error))];
    }
  }

  if (acceptsStreaming) {
    if (!res) {
      return [badRequest('Streaming requires Express response object')];
    }

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    await streamAIToClient(messages, vertex, params.model, tools, res);
    res.end();

    // Return undefined for streaming - response already sent
    return undefined;
  }

  try {
    const result = (await callAI(messages, vertex, params.model, tools)) as {
      content: string | null;
      tool_calls: any[];
    };
    return buildParametersResponse(result);
  } catch (error) {
    return [badRequest('Failed to call Vertex AI: ' + (error as Error).message)];
  }
}

/**
 * Resolves the Vertex AI client (endpoint + access token) from project secrets.
 *
 * Required project secrets:
 * - GCP_SERVICE_ACCOUNT_KEY: the full service account JSON key (string).
 *
 * Optional project secrets:
 * - GCP_PROJECT_ID: overrides the project_id from the service account key.
 * - GCP_REGION: Vertex AI region (defaults to us-central1).
 * @param project - The current project, holding the configured secrets.
 * @returns The resolved Vertex client (endpoint + service account). The access token
 * is minted lazily at call time so config validation never performs network I/O.
 */
export function getVertexClient(project: Project): VertexClient {
  const rawKey = project.secret?.find((s) => s.name === 'GCP_SERVICE_ACCOUNT_KEY')?.valueString;
  if (!rawKey) {
    throw new Error('Vertex AI service account (GCP_SERVICE_ACCOUNT_KEY) not configured in project secrets');
  }

  let serviceAccount: GcpServiceAccount;
  try {
    serviceAccount = JSON.parse(rawKey);
  } catch {
    throw new Error('GCP_SERVICE_ACCOUNT_KEY is not valid JSON');
  }
  if (!serviceAccount.client_email || !serviceAccount.private_key) {
    throw new Error('GCP_SERVICE_ACCOUNT_KEY is missing client_email or private_key');
  }

  const projectId = project.secret?.find((s) => s.name === 'GCP_PROJECT_ID')?.valueString ?? serviceAccount.project_id;
  if (!projectId) {
    throw new Error('GCP project id not configured (set GCP_PROJECT_ID or include project_id in the key)');
  }
  const region = project.secret?.find((s) => s.name === 'GCP_REGION')?.valueString ?? DEFAULT_VERTEX_REGION;

  const endpoint =
    `https://${region}-aiplatform.googleapis.com/v1/projects/${projectId}` +
    `/locations/${region}/endpoints/openapi/chat/completions`;

  return { endpoint, serviceAccount };
}

type GcpServiceAccount = {
  client_email: string;
  private_key: string;
  project_id?: string;
  token_uri?: string;
};

type CachedToken = { token: string; expiresAt: number };
const tokenCache = new Map<string, CachedToken>();

/**
 * Mints (and caches) a short-lived GCP OAuth2 access token for a service account
 * using the JWT-bearer grant. The token authorizes Vertex AI requests.
 * @param serviceAccount - Parsed service account key.
 * @returns A valid cloud-platform access token.
 */
export async function getGcpAccessToken(serviceAccount: GcpServiceAccount): Promise<string> {
  const cached = tokenCache.get(serviceAccount.client_email);
  // Refresh ~60s before expiry to avoid edge-of-expiry failures.
  if (cached && cached.expiresAt - 60_000 > Date.now()) {
    return cached.token;
  }

  const tokenUri = serviceAccount.token_uri ?? GCP_TOKEN_URL;
  const now = Math.floor(Date.now() / 1000);
  const privateKey = await importPKCS8(serviceAccount.private_key, 'RS256');
  const assertion = await new SignJWT({ scope: GCP_SCOPE })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(serviceAccount.client_email)
    .setSubject(serviceAccount.client_email)
    .setAudience(tokenUri)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(privateKey);

  const response = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Failed to obtain GCP access token: ${response.status} ${response.statusText} ${errorText}`);
  }

  const data = (await response.json()) as { access_token: string; expires_in: number };
  tokenCache.set(serviceAccount.client_email, {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  });
  return data.access_token;
}

/**
 * Streams AI response from Vertex AI directly to the client via SSE.
 * This function bridges the upstream stream to the Express response without collecting.
 * Note: Tool calls are not supported in streaming mode.
 * @param messages - The conversation messages
 * @param vertex - Resolved Vertex client (endpoint + access token)
 * @param model - Model to use
 * @param tools - Optional tools array (ignored in streaming mode)
 * @param res - Express response to write SSE data to
 */
export async function streamAIToClient(
  messages: any[],
  vertex: VertexClient,
  model: string,
  tools: any[] | undefined,
  res: ExpressResponse
): Promise<void> {
  const ctx = getAuthenticatedContext();
  const response = (await callAI(messages, vertex, model, tools, true)) as Response;
  if (!response.body) {
    throw new Error('No response body available for streaming');
  }

  // Stream the upstream response directly to client using TextDecoderStream
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();

  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        res.write('data: [DONE]\n\n');
        break;
      }

      buffer += value;
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();

          if (data === '[DONE]') {
            continue;
          }

          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices[0]?.delta;

            if (!delta?.content) {
              continue;
            }

            res.write(`data: ${JSON.stringify({ content: delta.content })}\n\n`);
            res.flush();
          } catch (e) {
            // Skip malformed JSON
            ctx.logger.error('Error parsing SSE data:', { error: e });
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Builds a FHIR Parameters response from AI result.
 * @param result - The AI response
 * @param result.content - The text content from the AI
 * @param result.tool_calls - Array of tool calls from the AI
 * @returns FHIR response
 */
function buildParametersResponse(result: { content: string | null; tool_calls: any[] }): FhirResponse {
  const parameters: ParametersParameter[] = [];

  if (result.content) {
    parameters.push({
      name: 'content',
      valueString: result.content,
    });
  }

  if (result.tool_calls?.length) {
    const toolCallsWithParsedArgs = result.tool_calls.map((tc) => ({
      id: tc.id,
      type: tc.type,
      function: {
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments),
      },
    }));

    parameters.push({
      name: 'tool_calls',
      valueString: JSON.stringify(toolCallsWithParsedArgs),
    });
  }

  return [
    allOk,
    {
      resourceType: 'Parameters',
      parameter: parameters,
    },
  ];
}

/**
 * Calls Vertex AI's OpenAI-compatible Chat Completions endpoint with optional streaming.
 * The request/response shape mirrors the OpenAI Chat Completions API, so existing
 * streaming and tool-call handling is preserved.
 * @param messages - The conversation messages
 * @param vertex - Resolved Vertex client (endpoint + access token)
 * @param model - Model to use (publisher-qualified, e.g. google/gemini-2.5-flash)
 * @param tools - Optional tools array
 * @param stream - Whether to enable streaming
 * @returns For non-streaming: parsed response with content and tool calls. For streaming: raw Response object.
 */
export async function callAI(
  messages: any[],
  vertex: VertexClient,
  model: string,
  tools?: any[],
  stream = false
): Promise<{ content: string | null; tool_calls: any[] } | Response> {
  const requestBody: any = {
    model: model,
    messages: messages,
  };

  if (stream) {
    requestBody.stream = true;
  } else if (tools && tools.length > 0) {
    requestBody.tools = tools;
    requestBody.tool_choice = 'auto';
  }

  const accessToken = await getGcpAccessToken(vertex.serviceAccount);
  const response = await fetch(vertex.endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  // For streaming, return raw response
  if (stream) {
    return response;
  }

  // For non-streaming, parse and return structured data
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const error = new Error(
      `Vertex AI error: ${response.status} ${response.statusText} - ${errorData?.error?.message || 'Unknown error'}`
    );
    (error as Error & { statusCode: number }).statusCode = response.status;
    throw error;
  }

  const completion = await response.json();
  const message = completion.choices[0].message;

  return {
    content: message.content,
    tool_calls: message.tool_calls || [],
  };
}
