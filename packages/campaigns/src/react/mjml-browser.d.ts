// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
declare module 'mjml-browser' {
  interface MjmlResult {
    html: string;
    errors: { line: number; message: string; tagName: string }[];
  }
  export default function mjml2html(
    mjml: string,
    options?: { validationLevel?: 'strict' | 'soft' | 'skip' }
  ): MjmlResult;
}
