// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

/* global process */
/* global console */

import esbuild from 'esbuild';
import { writeFileSync } from 'fs';

const baseOptions = {
  bundle: true,
  platform: 'browser',
  loader: { '.ts': 'ts', '.tsx': 'tsx' },
  logLevel: 'info',
  resolveExtensions: ['.ts', '.tsx'],
  target: 'es2021',
  tsconfig: 'tsconfig.json',
  minifyWhitespace: true,
  minifyIdentifiers: false,
  minifySyntax: true,
  sourcemap: true,
  external: [
    '@mantine/core',
    '@mantine/hooks',
    '@medplum/core',
    '@medplum/fhirtypes',
    '@medplum/mock',
    '@medplum/react',
    '@medplum/react-hooks',
    '@tabler/icons-react',
    '@xyflow/react',
    'mjml-browser',
    'react',
    'react-dom',
    'react/jsx-runtime',
  ],
};

// Three entries: '.' (pure engine, no React — consumed by bots and apps),
// './react' (builder/editor components — apps only), and './node' (helpers that
// need node:crypto — bots only, kept out of the browser bundles).
const entries = [
  { entry: './src/index.ts', name: 'index', platform: 'browser' },
  { entry: './src/react/index.ts', name: 'react', platform: 'browser' },
  { entry: './src/node/index.ts', name: 'node', platform: 'node' },
];

async function build() {
  for (const { entry, name, platform } of entries) {
    const options = { ...baseOptions, platform, entryPoints: [entry] };
    await esbuild.build({ ...options, format: 'cjs', outfile: `./dist/cjs/${name}.cjs` });
    await esbuild.build({ ...options, format: 'esm', outfile: `./dist/esm/${name}.mjs` });
  }
  writeFileSync('./dist/cjs/package.json', '{"type": "commonjs"}');
  writeFileSync('./dist/esm/package.json', '{"type": "module"}');
  // The api-extractor rollup covers the '.' entry (index.d.ts). The other
  // entries re-export their tsc-emitted declarations from dist/types.
  for (const name of ['react', 'node']) {
    writeFileSync(`./dist/cjs/${name}.d.ts`, `export * from '../types/${name}/index';\n`);
    writeFileSync(`./dist/esm/${name}.d.ts`, `export * from '../types/${name}/index';\n`);
  }
}

build().catch((error) => {
  console.error('Build failed:', JSON.stringify(error, null, 2));
  process.exit(1);
});
