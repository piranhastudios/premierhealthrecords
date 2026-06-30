// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import {
  ActionIcon,
  Button,
  Divider,
  Popover,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { showNotification } from '@mantine/notifications';
import { normalizeErrorString } from '@medplum/core';
import type { Basic } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react-hooks';
import { IconTemplate } from '@tabler/icons-react';
import type { JSX } from 'react';
import { useCallback, useEffect, useState } from 'react';
import type { SelectedTemplate, WhatsAppTemplate } from './constants';
import { parseWhatsAppTemplate, renderTemplatePreview, TEMPLATE_TYPE_SYSTEM } from './constants';

export interface TemplatePickerProps {
  readonly onSend: (template: SelectedTemplate) => void;
  readonly disabled?: boolean;
}

// Lists Twilio-approved WhatsApp templates (mirrored as `Basic` resources), collects
// any variables, and emits a SelectedTemplate for the reply box to send.
export function TemplatePicker(props: TemplatePickerProps): JSX.Element {
  const medplum = useMedplum();
  const [opened, setOpened] = useState(false);
  const [templates, setTemplates] = useState<WhatsAppTemplate[] | undefined>(undefined);
  const [selected, setSelected] = useState<WhatsAppTemplate | undefined>(undefined);
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!opened || templates) {
      return;
    }
    medplum
      .searchResources('Basic', { code: `${TEMPLATE_TYPE_SYSTEM}|whatsapp-template`, _count: '50' })
      .then((results) =>
        setTemplates(results.map((b: Basic) => parseWhatsAppTemplate(b)).filter((t): t is WhatsAppTemplate => !!t))
      )
      .catch((err) => showNotification({ color: 'red', message: normalizeErrorString(err) }));
  }, [opened, templates, medplum]);

  const reset = useCallback(() => {
    setSelected(undefined);
    setValues({});
  }, []);

  const handleSend = useCallback(() => {
    if (!selected) {
      return;
    }
    const vars: Record<string, string> = {};
    for (const variable of selected.variables) {
      vars[variable.index] = values[variable.index] ?? '';
    }
    props.onSend({ sid: selected.contentSid, vars, preview: renderTemplatePreview(selected.bodyPreview, vars) });
    setOpened(false);
    reset();
  }, [selected, values, props, reset]);

  const allFilled = selected?.variables.every((v) => (values[v.index] ?? '').trim().length > 0) ?? false;

  return (
    <Popover
      opened={opened}
      onChange={(o) => {
        setOpened(o);
        if (!o) {
          reset();
        }
      }}
      position="top-start"
      withArrow
      shadow="md"
      withinPortal
      width={320}
    >
      <Popover.Target>
        <Tooltip label="Send approved template" position="top" openDelay={400}>
          <ActionIcon
            onClick={() => setOpened((o) => !o)}
            disabled={props.disabled}
            size="1.75rem"
            radius="xl"
            variant="light"
            color="teal"
            aria-label="Send approved WhatsApp template"
          >
            <IconTemplate size="1.1rem" stroke={1.5} />
          </ActionIcon>
        </Tooltip>
      </Popover.Target>
      <Popover.Dropdown p="xs">
        {!selected ? (
          <Stack gap={4}>
            <Text fw={600} size="sm" px={4}>
              Approved templates
            </Text>
            <Divider />
            <ScrollArea.Autosize mah={260}>
              <Stack gap={2}>
                {templates === undefined && (
                  <Text size="xs" c="dimmed" p="sm">
                    Loading…
                  </Text>
                )}
                {templates?.length === 0 && (
                  <Text size="xs" c="dimmed" p="sm">
                    No approved templates found.
                  </Text>
                )}
                {templates?.map((template) => (
                  <UnstyledButton
                    key={template.id}
                    p={6}
                    style={{ borderRadius: 6 }}
                    onClick={() => {
                      setSelected(template);
                      setValues({});
                    }}
                  >
                    <Text size="sm" fw={500}>
                      {template.name}
                      {template.language ? ` · ${template.language}` : ''}
                    </Text>
                    <Text size="xs" c="dimmed" lineClamp={2}>
                      {template.bodyPreview}
                    </Text>
                  </UnstyledButton>
                ))}
              </Stack>
            </ScrollArea.Autosize>
          </Stack>
        ) : (
          <Stack gap="xs">
            <Text fw={600} size="sm">
              {selected.name}
            </Text>
            {selected.variables.map((variable) => (
              <TextInput
                key={variable.index}
                size="xs"
                label={variable.label}
                value={values[variable.index] ?? ''}
                onChange={(e) => setValues((prev) => ({ ...prev, [variable.index]: e.currentTarget.value }))}
              />
            ))}
            <Text size="xs" c="dimmed">
              {renderTemplatePreview(selected.bodyPreview, values)}
            </Text>
            <Button size="xs" onClick={handleSend} disabled={!allFilled}>
              Send template
            </Button>
            <Button size="xs" variant="subtle" color="gray" onClick={reset}>
              Back
            </Button>
          </Stack>
        )}
      </Popover.Dropdown>
    </Popover>
  );
}
