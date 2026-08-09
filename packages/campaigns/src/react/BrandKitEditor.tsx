// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { ActionIcon, Button, Card, ColorInput, ColorSwatch, Group, Stack, Text, TextInput, Title, Tooltip } from '@mantine/core';
import { normalizeErrorString } from '@medplum/core';
import { useMedplum } from '@medplum/react-hooks';
import type { Basic } from '@medplum/fhirtypes';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { BRAND_KIT_EXTENSION } from '../constants';
import type { BrandKit } from '../fhir/template';
import { BRAND_KIT_CODE, DEFAULT_BRAND_COLORS, brandSwatches, getBrandKit } from '../fhir/template';

export interface BrandKitEditorProps {
  onSaved?: () => void;
  onError?: (message: string) => void;
}

/**
 * Per-clinic brand kit: logo, brand colors, sender identity, footer text and
 * unsubscribe URL. Stored as a single `brand-kit` Basic per project; the
 * template compiler reads it for the header logo, button colors and the locked
 * footer, and the block editor offers the colors as swatches.
 *
 * @param props - Save / error callbacks.
 * @returns The brand kit editor card.
 */
export function BrandKitEditor(props: BrandKitEditorProps): JSX.Element {
  const { onSaved, onError } = props;
  const medplum = useMedplum();
  const [resource, setResource] = useState<Basic>();
  const [kit, setKit] = useState<BrandKit>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getBrandKit(medplum)
      .then((result) => {
        if (result) {
          setResource(result.resource);
          setKit(result.kit);
        }
      })
      .catch(console.error);
  }, [medplum]);

  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      const extension = [{ url: BRAND_KIT_EXTENSION, valueString: JSON.stringify(kit) }];
      if (resource?.id) {
        const fresh = await medplum.readResource('Basic', resource.id);
        setResource(await medplum.updateResource<Basic>({ ...fresh, extension }));
      } else {
        setResource(await medplum.createResource<Basic>({ resourceType: 'Basic', code: BRAND_KIT_CODE, extension }));
      }
      onSaved?.();
    } catch (err) {
      onError?.(normalizeErrorString(err));
    } finally {
      setSaving(false);
    }
  };

  const set = (patch: Partial<BrandKit>): void => setKit((prev) => ({ ...prev, ...patch }));
  const palette = kit.palette ?? [];
  const setPaletteColor = (index: number, value: string): void =>
    set({ palette: palette.map((c, i) => (i === index ? value : c)) });

  return (
    <Card withBorder>
      <Stack gap="xs">
        <Group justify="space-between">
          <Title order={5}>Brand kit</Title>
          <Button size="compact-xs" onClick={save} loading={saving}>
            Save
          </Button>
        </Group>

        <Group grow align="flex-start">
          <ColorInput
            label="Primary color"
            description="Default button color"
            format="hex"
            swatches={DEFAULT_BRAND_COLORS}
            value={kit.primaryColor ?? ''}
            onChange={(value) => set({ primaryColor: value })}
          />
          <TextInput label="Sender name" value={kit.senderName ?? ''} onChange={(e) => set({ senderName: e.currentTarget.value })} />
        </Group>

        <div>
          <Group justify="space-between" mb={4}>
            <Text size="sm" fw={500}>
              Additional brand colors
            </Text>
            <Button
              size="compact-xs"
              variant="light"
              leftSection={<IconPlus size={12} />}
              onClick={() => set({ palette: [...palette, DEFAULT_BRAND_COLORS[palette.length % DEFAULT_BRAND_COLORS.length]] })}
            >
              Add color
            </Button>
          </Group>
          <Text size="xs" c="dimmed" mb={6}>
            Offered as swatches when colouring headings, text, buttons and dividers.
          </Text>
          <Stack gap={6}>
            {palette.map((color, index) => (
              <Group key={index} gap="xs" wrap="nowrap">
                <ColorInput
                  format="hex"
                  swatches={DEFAULT_BRAND_COLORS}
                  value={color}
                  onChange={(value) => setPaletteColor(index, value)}
                  style={{ flex: 1 }}
                />
                <ActionIcon
                  variant="subtle"
                  color="red"
                  onClick={() => set({ palette: palette.filter((_, i) => i !== index) })}
                  aria-label="Remove color"
                >
                  <IconTrash size={14} />
                </ActionIcon>
              </Group>
            ))}
            {palette.length === 0 && (
              <Text size="xs" c="dimmed">
                No additional colors — templates use the primary color only.
              </Text>
            )}
          </Stack>
        </div>

        {brandSwatches(kit).length > 0 && (
          <Group gap={6} align="center">
            <Text size="xs" c="dimmed">
              Palette:
            </Text>
            {brandSwatches(kit).map((color) => (
              <Tooltip key={color} label={color}>
                <ColorSwatch color={color} size={18} />
              </Tooltip>
            ))}
          </Group>
        )}

        <TextInput label="Logo URL" value={kit.logoUrl ?? ''} onChange={(e) => set({ logoUrl: e.currentTarget.value })} />
        <TextInput
          label="Footer text (address / registration)"
          value={kit.footerText ?? ''}
          onChange={(e) => set({ footerText: e.currentTarget.value })}
        />
        <Text size="xs" c="dimmed">
          The unsubscribe link is added to every template automatically — a signed, per-recipient link that revokes
          marketing consent on click. Nothing to configure.
        </Text>
      </Stack>
    </Card>
  );
}
