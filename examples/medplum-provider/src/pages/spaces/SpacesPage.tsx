// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Badge, Center, Paper, Stack, Text, Title } from '@mantine/core';
import type { Communication, Reference } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react';
import { IconSparkles } from '@tabler/icons-react';
import type { JSX } from 'react';
import { useNavigate, useParams } from 'react-router';
import { SpacesInbox } from '../../components/spaces/SpacesInbox';
import classes from './SpacesPage.module.css';

/**
 * SpacesPage component that handles routing for AI conversation spaces.
 * Follows the same pattern as MessagesPage by delegating all logic to SpaceInbox.
 * @returns A React component that displays the AI conversation interface.
 */
export function SpacesPage(): JSX.Element {
  const medplum = useMedplum();
  const { topicId } = useParams();
  const navigate = useNavigate();

  const project = medplum.getProject();
  const features = project?.features ?? [];
  const isEnabled = features.includes('bots') && features.includes('ai');

  const handleNewTopic = (newTopic: Communication): void => {
    navigate(`/Spaces/Communication/${newTopic.id}`)?.catch(console.error);
  };

  const onSelectedItem = (selectedTopic: Communication): string => {
    return `/Spaces/Communication/${selectedTopic.id}`;
  };

  const topicRef: Reference<Communication> | undefined = topicId
    ? { reference: `Communication/${topicId}` }
    : undefined;

  const handleNewConversation = (): void => {
    navigate('/Spaces/Communication')?.catch(console.error);
  };

  return (
    <div className={classes.container}>
      <div className={isEnabled ? classes.fill : classes.blurred}>
        <SpacesInbox
          topic={topicRef}
          onNewTopic={handleNewTopic}
          onSelectedItem={onSelectedItem}
          onAdd={handleNewConversation}
        />
      </div>
      {!isEnabled && (
        <div className={classes.overlay}>
          <Center h="100%">
            <Paper shadow="md" p="xl" radius="md" withBorder style={{ maxWidth: 420, textAlign: 'center' }}>
              <Stack align="center" gap="sm">
                <IconSparkles size={48} color="var(--mantine-color-brand-6)" />
                <Badge color="brandGold" variant="light" size="lg">
                  Coming soon
                </Badge>
                <Title order={3}>AI Spaces is coming soon</Title>
                <Text c="dimmed">
                  Spaces will let you chat with an AI assistant over your patients&apos; records — asking questions,
                  drafting notes, and surfacing insights. We&apos;re bringing it to Premier Health soon.
                </Text>
              </Stack>
            </Paper>
          </Center>
        </div>
      )}
    </div>
  );
}
