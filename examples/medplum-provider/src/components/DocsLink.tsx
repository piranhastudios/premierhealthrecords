// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { AnchorProps } from '@mantine/core';
import { Anchor } from '@mantine/core';
import type { JSX } from 'react';

interface DocsLinkProps extends Omit<AnchorProps, 'href'> {
  path: string;
  children: React.ReactNode;
}

// A hyperlink to the in-app Provider docs page.
export function DocsLink(props: DocsLinkProps): JSX.Element {
  const anchor = props.path.replace(/^\//, '');
  return (
    <Anchor href={`/docs#${anchor}`}>
      {props.children}
    </Anchor>
  );
}
