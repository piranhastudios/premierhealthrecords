// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Node-only entry (`@medplum/campaigns/node`). Kept separate from the main
 * entry so `node:crypto` never reaches the browser bundles of the admin and
 * provider apps — only the bots import this.
 */
export * from './unsubscribe';
