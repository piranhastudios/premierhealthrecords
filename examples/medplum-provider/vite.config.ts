// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import react from '@vitejs/plugin-react';
import dns from 'dns';
import { existsSync } from 'fs';
import path from 'path';
import type { UserConfig } from 'vite';
import { defineConfig } from 'vitest/config';

dns.setDefaultResultOrder('verbatim');

// Resolve aliases to local packages when working within the monorepo
const alias: NonNullable<UserConfig['resolve']>['alias'] = Object.fromEntries(
  Object.entries({
    '@medplum/core': path.resolve(__dirname, '../../packages/core/src'),
    '@medplum/dosespot-react': path.resolve(__dirname, '../../packages/dosespot-react/src'),
    '@medplum/scriptsure-react': path.resolve(__dirname, '../../packages/scriptsure-react/src'),
    '@medplum/react$': path.resolve(__dirname, '../../packages/react/src'),
    '@medplum/react/styles.css': path.resolve(__dirname, '../../packages/react/dist/esm/index.css'),
    '@medplum/react-hooks': path.resolve(__dirname, '../../packages/react-hooks/src'),
    '@medplum/health-gorilla-core': path.resolve(__dirname, '../../packages/health-gorilla-core/src'),
    '@medplum/health-gorilla-react': path.resolve(__dirname, '../../packages/health-gorilla-react/src'),
  }).filter(([, relPath]) => existsSync(relPath))
);

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: 'localhost',
    port: 3000,
  },
  preview: {
    host: 'localhost',
    port: 3000,
  },
  resolve: {
    alias,
    // Prevent a second React copy (e.g. packages/react-hooks/node_modules/react)
    // from being loaded when aliasing monorepo packages to their sources.
    dedupe: ['react', 'react-dom'],
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test.setup.ts',
    // @testing-library/react is hoisted to the repo root and natively loads the
    // root react-dom, so force all react imports to the same root copy to avoid
    // "Cannot read properties of null (reading 'useState')" dual-React errors.
    alias: {
      react: path.resolve(__dirname, '../../node_modules/react'),
      'react-dom': path.resolve(__dirname, '../../node_modules/react-dom'),
    },
  },
});
