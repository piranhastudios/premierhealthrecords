// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  ColorInput,
  CopyButton,
  Group,
  Loader,
  NumberInput,
  SegmentedControl,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import type { WithId } from '@medplum/core';
import { normalizeErrorString } from '@medplum/core';
import { useMedplum } from '@medplum/react-hooks';
import type { Basic, Patient } from '@medplum/fhirtypes';
import { IconArrowDown, IconArrowUp, IconCopy, IconTrash } from '@tabler/icons-react';
import type { JSX } from 'react';
import { useEffect, useMemo, useState } from 'react';
import type { BrandKit } from '../fhir/template';
import { brandSwatches, getBrandKit, getTemplateContent, templateExtensions } from '../fhir/template';
import { renderMergeFields } from '../render';
import { AssistantPanel } from './ai/AssistantPanel';
import type { GridCell, TemplateBlock, TemplateDesign } from './compile';
import {
  ADDABLE_BLOCK_TYPES,
  COLORABLE_BLOCK_TYPES,
  compileDesign,
  compileDesignBody,
  DEFAULT_CONTENT_BACKGROUND,
  DEFAULT_PAGE_BACKGROUND,
  GRID_COLUMN_OPTIONS,
  MERGE_FIELD_PRESETS,
  parseDesign,
} from './compile';

const SAMPLE_PATIENT: Patient = {
  resourceType: 'Patient',
  name: [{ given: ['Ada'], family: 'Example' }],
};

let blockCounter = 0;
function newBlock(type: (typeof ADDABLE_BLOCK_TYPES)[number]): TemplateBlock {
  const id = `b-${Date.now().toString(36)}-${blockCounter++}`;
  switch (type) {
    case 'heading':
      return { id, type, text: 'Heading' };
    case 'text':
      return { id, type, text: 'Write something…' };
    case 'image':
      return { id, type, src: '' };
    case 'button':
      return { id, type, text: 'Book now', href: 'https://' };
    case 'divider':
      return { id, type };
    case 'spacer':
      return { id, type, height: 24 };
    case 'grid':
      return {
        id,
        type,
        columns: 3,
        cells: [{ heading: 'Item 1' }, { heading: 'Item 2' }, { heading: 'Item 3' }],
      };
    case 'html':
      return { id, type, html: '<!-- custom HTML -->' };
    default:
      return { id, type: 'text', text: '' };
  }
}

export interface TemplateEditorProps {
  templateId: string;
  /** Called after a successful save. */
  onSaved?: () => void;
  /** Shows the AI assistant panel (gate on the project `ai` feature). */
  aiEnabled?: boolean;
}

/**
 * Block-based email template editor: vertical block list with per-block forms,
 * merge-field copy list, and a live preview (compiled MJML → HTML rendered in
 * an iframe with sample data). Saving bumps the template version and stores
 * design JSON + compiled HTML on the Basic; the locked brand footer is always
 * appended at compile time and cannot be removed.
 *
 * @param props - The template Basic id and save callback.
 * @returns The editor.
 */
export function TemplateEditor(props: TemplateEditorProps): JSX.Element {
  const { templateId, onSaved, aiEnabled } = props;
  const medplum = useMedplum();
  const [template, setTemplate] = useState<WithId<Basic>>();
  const [brand, setBrand] = useState<BrandKit>({});
  const [blocks, setBlocks] = useState<TemplateBlock[]>([]);
  const [subject, setSubject] = useState('');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [selectedBlockId, setSelectedBlockId] = useState<string>();
  const [mode, setMode] = useState<'visual' | 'html'>('visual');
  const [rawHtml, setRawHtml] = useState('');
  const [pageBackground, setPageBackground] = useState(DEFAULT_PAGE_BACKGROUND);
  const [contentBackground, setContentBackground] = useState(DEFAULT_CONTENT_BACKGROUND);

  useEffect(() => {
    let active = true;
    Promise.all([medplum.readResource('Basic', templateId), getBrandKit(medplum)])
      .then(([resource, kit]) => {
        if (!active) {
          return;
        }
        setTemplate(resource);
        setBrand(kit?.kit ?? {});
        const content = getTemplateContent(resource);
        const design = parseDesign(content?.design);
        setBlocks(design.blocks);
        setMode(design.mode ?? 'visual');
        setRawHtml(design.html ?? content?.html ?? '');
        setPageBackground(design.backgroundColor ?? DEFAULT_PAGE_BACKGROUND);
        setContentBackground(design.contentBackgroundColor ?? DEFAULT_CONTENT_BACKGROUND);
        setSubject(content?.subject ?? '');
        setName(resource.identifier?.[0]?.value ?? '');
      })
      .catch((err) => setError(normalizeErrorString(err)));
    return () => {
      active = false;
    };
  }, [medplum, templateId]);

  const design = useMemo<TemplateDesign>(
    () => ({
      mode,
      blocks,
      html: rawHtml,
      backgroundColor: pageBackground,
      contentBackgroundColor: contentBackground,
    }),
    [mode, blocks, rawHtml, pageBackground, contentBackground]
  );

  const previewHtml = useMemo(() => {
    try {
      const compiled = compileDesign(design, brand);
      // Sample data only — the real unsubscribe link is generated per recipient.
      return renderMergeFields(compiled, { patient: SAMPLE_PATIENT, unsubscribeUrl: '#' });
    } catch (err) {
      return `<pre>${normalizeErrorString(err)}</pre>`;
    }
  }, [design, brand]);

  if (!template) {
    return error ? <Alert color="red">{error}</Alert> : <Loader />;
  }

  /**
   * Mode switching must never lose work. Going visual → HTML seeds the editor
   * with the compiled blocks (footer excluded — it is re-appended on compile)
   * unless the operator already has HTML they've edited. Going HTML → visual
   * keeps the HTML around, so the switch is reversible either way.
   * @param next - The mode being switched to.
   */
  const switchMode = (next: 'visual' | 'html'): void => {
    if (next === 'html' && !rawHtml.trim()) {
      try {
        setRawHtml(compileDesignBody({ ...design, mode: 'visual' }, brand));
      } catch (err) {
        setError(normalizeErrorString(err));
      }
    }
    setMode(next);
  };

  const updateBlock = (id: string, patch: Partial<TemplateBlock>): void =>
    setBlocks((prev) => prev.map((b) => (b.id === id ? ({ ...b, ...patch } as TemplateBlock) : b)));
  const moveBlock = (index: number, delta: number): void =>
    setBlocks((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) {
        return prev;
      }
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });

  const save = async (): Promise<void> => {
    setSaving(true);
    setError(undefined);
    try {
      const html = compileDesign(design, brand);
      const previous = getTemplateContent(template);
      const fresh = await medplum.readResource('Basic', templateId);
      const updated = await medplum.updateResource<Basic>({
        ...fresh,
        identifier: [{ ...(fresh.identifier?.[0] ?? {}), value: name || 'Untitled template' }],
        extension: [
          ...(fresh.extension ?? []).filter((e) => !e.url.includes('email-template')),
          ...templateExtensions({
            design: JSON.stringify(design),
            html,
            subject,
            version: (previous?.version ?? 0) + 1,
          }),
        ],
      });
      setTemplate(updated);
      onSaved?.();
    } catch (err) {
      setError(normalizeErrorString(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Stack gap="sm" style={{ height: '100%' }}>
      <Group justify="space-between">
        <Title order={4}>Email template</Title>
        <Button size="xs" onClick={save} loading={saving}>
          Save (v{(getTemplateContent(template)?.version ?? 0) + 1})
        </Button>
      </Group>
      {error && <Alert color="red">{error}</Alert>}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 12 }}>
        <Stack gap="sm" style={{ width: 420, overflowY: 'auto' }}>
          <TextInput label="Template name" value={name} onChange={(e) => setName(e.currentTarget.value)} />
          <TextInput
            label="Subject"
            description="Supports merge fields, e.g. {{patient.name.given.first()}}"
            value={subject}
            onChange={(e) => setSubject(e.currentTarget.value)}
          />

          <div>
            <SegmentedControl
              fullWidth
              size="xs"
              value={mode}
              onChange={(value) => switchMode(value as 'visual' | 'html')}
              data={[
                { value: 'visual', label: 'Visual' },
                { value: 'html', label: 'HTML' },
              ]}
            />
            <Text size="xs" c="dimmed" mt={4}>
              {mode === 'visual'
                ? 'Switching to HTML converts these blocks to editable HTML. Prefer an "html" block if you only need custom code in one place.'
                : 'This template sends the HTML below. Switch back to Visual to return to your blocks — your HTML is kept.'}
            </Text>
          </div>

          <Group grow>
            <ColorInput
              size="xs"
              format="hex"
              label="Page background"
              swatches={brandSwatches(brand)}
              value={pageBackground}
              onChange={setPageBackground}
            />
            <ColorInput
              size="xs"
              format="hex"
              label="Content background"
              swatches={brandSwatches(brand)}
              value={contentBackground}
              onChange={setContentBackground}
              disabled={mode === 'html'}
            />
          </Group>

          {mode === 'html' ? (
            <Textarea
              label="HTML"
              description="Hand-written email HTML. The unsubscribe footer is still appended automatically."
              autosize
              minRows={16}
              maxRows={30}
              styles={{ input: { fontFamily: 'monospace', fontSize: 12 } }}
              value={rawHtml}
              onChange={(e) => setRawHtml(e.currentTarget.value)}
            />
          ) : (
            <Group gap={6}>
              {ADDABLE_BLOCK_TYPES.map((type) => (
                <Button
                  key={type}
                  size="compact-xs"
                  variant="light"
                  onClick={() => setBlocks((prev) => [...prev, newBlock(type)])}
                >
                  + {type}
                </Button>
              ))}
            </Group>
          )}
          {mode === 'visual' &&
            blocks.map((block, index) => (
              <div
                key={block.id}
                onClick={() => setSelectedBlockId(block.id)}
                style={
                  selectedBlockId === block.id
                    ? { outline: '2px solid var(--mantine-primary-color-filled)', borderRadius: 8 }
                    : undefined
                }
              >
                <BlockCard
                  block={block}
                  swatches={brandSwatches(brand)}
                  onChange={(patch) => updateBlock(block.id, patch)}
                  onMoveUp={() => moveBlock(index, -1)}
                  onMoveDown={() => moveBlock(index, 1)}
                  onDelete={() => setBlocks((prev) => prev.filter((b) => b.id !== block.id))}
                />
              </div>
            ))}
          <Card withBorder padding="xs">
            <Group justify="space-between">
              <Badge variant="light" color="gray">
                footer (locked)
              </Badge>
              <Text size="xs" c="dimmed">
                Sender identity + unsubscribe — always appended
              </Text>
            </Group>
          </Card>
          {aiEnabled && (
            <AssistantPanel
              templateId={templateId}
              design={{ blocks }}
              subject={subject}
              selectedBlock={blocks.find((b) => b.id === selectedBlockId)}
              onApplyDesign={(design) => setBlocks(design.blocks)}
              onApplySubject={setSubject}
              onApplyBlockText={(text) => {
                if (selectedBlockId) {
                  updateBlock(selectedBlockId, { text } as Partial<TemplateBlock>);
                }
              }}
            />
          )}
          <Card withBorder padding="xs">
            <Text size="xs" fw={600} mb={4}>
              Merge fields (click to copy)
            </Text>
            <Group gap={6}>
              {MERGE_FIELD_PRESETS.map((preset) => (
                <CopyButton key={preset.field} value={`{{${preset.field}}}`}>
                  {({ copied, copy }) => (
                    <Tooltip label={copied ? 'Copied' : `{{${preset.field}}}`}>
                      <Button size="compact-xs" variant="default" leftSection={<IconCopy size={12} />} onClick={copy}>
                        {preset.label}
                      </Button>
                    </Tooltip>
                  )}
                </CopyButton>
              ))}
            </Group>
          </Card>
        </Stack>
        <Card withBorder style={{ flex: 1, minWidth: 0, padding: 0 }}>
          <iframe title="Template preview" srcDoc={previewHtml} style={{ width: '100%', height: '100%', border: 0 }} />
        </Card>
      </div>
    </Stack>
  );
}

interface BlockCardProps {
  block: TemplateBlock;
  /** Brand colors offered as swatches on the block's color picker. */
  swatches: string[];
  onChange: (patch: Partial<TemplateBlock>) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
}

/**
 * One editable block row: type badge, reorder/delete controls, per-type fields,
 * and (where it applies) a brand-palette color picker.
 * @param props - Block state and callbacks.
 * @returns The block card.
 */
function BlockCard(props: BlockCardProps): JSX.Element {
  const { block, swatches, onChange, onMoveUp, onMoveDown, onDelete } = props;
  const colorable = COLORABLE_BLOCK_TYPES.has(block.type);
  return (
    <Card withBorder padding="xs">
      <Group justify="space-between" mb={block.type === 'divider' ? 0 : 6}>
        <Badge variant="light">{block.type}</Badge>
        <Group gap={4}>
          <ActionIcon variant="subtle" size="sm" onClick={onMoveUp} aria-label="Move up">
            <IconArrowUp size={14} />
          </ActionIcon>
          <ActionIcon variant="subtle" size="sm" onClick={onMoveDown} aria-label="Move down">
            <IconArrowDown size={14} />
          </ActionIcon>
          <ActionIcon variant="subtle" color="red" size="sm" onClick={onDelete} aria-label="Delete block">
            <IconTrash size={14} />
          </ActionIcon>
        </Group>
      </Group>
      {(block.type === 'heading' || block.type === 'text') && (
        <TextInput value={block.text} onChange={(e) => onChange({ text: e.currentTarget.value })} />
      )}
      {block.type === 'image' && (
        <Group grow>
          <TextInput
            placeholder="Image URL"
            value={block.src}
            onChange={(e) => onChange({ src: e.currentTarget.value } as Partial<TemplateBlock>)}
          />
          <TextInput
            placeholder="Links to… (optional)"
            value={block.href ?? ''}
            onChange={(e) => onChange({ href: e.currentTarget.value || undefined } as Partial<TemplateBlock>)}
          />
        </Group>
      )}
      {block.type === 'button' && (
        <Group grow>
          <TextInput
            placeholder="Label"
            value={block.text}
            onChange={(e) => onChange({ text: e.currentTarget.value })}
          />
          <TextInput
            placeholder="Link URL"
            value={block.href}
            onChange={(e) => onChange({ href: e.currentTarget.value } as Partial<TemplateBlock>)}
          />
        </Group>
      )}
      {block.type === 'spacer' && (
        <NumberInput
          label="Height (px)"
          min={4}
          max={120}
          value={block.height}
          onChange={(v) => onChange({ height: typeof v === 'number' ? v : 24 } as Partial<TemplateBlock>)}
        />
      )}
      {block.type === 'columns' && (
        <Group grow>
          <TextInput value={block.left} onChange={(e) => onChange({ left: e.currentTarget.value } as Partial<TemplateBlock>)} />
          <TextInput value={block.right} onChange={(e) => onChange({ right: e.currentTarget.value } as Partial<TemplateBlock>)} />
        </Group>
      )}
      {block.type === 'html' && (
        <Textarea
          autosize
          minRows={3}
          maxRows={14}
          placeholder="<div>…</div>"
          description="Passed through untouched. Merge fields work here too."
          styles={{ input: { fontFamily: 'monospace', fontSize: 12 } }}
          value={block.html}
          onChange={(e) => onChange({ html: e.currentTarget.value } as Partial<TemplateBlock>)}
        />
      )}
      {block.type === 'grid' && (
        <Stack gap={6}>
          <SegmentedControl
            size="xs"
            value={String(block.columns)}
            onChange={(value) => {
              const columns = Number(value);
              // Grow/shrink the cell list to match the chosen column count.
              const cells: GridCell[] = Array.from(
                { length: columns },
                (_, i) => block.cells[i] ?? { heading: `Item ${i + 1}` }
              );
              onChange({ columns, cells } as Partial<TemplateBlock>);
            }}
            data={GRID_COLUMN_OPTIONS.map((n) => ({ value: String(n), label: `${n} columns` }))}
          />
          {block.cells.slice(0, block.columns).map((cell, cellIndex) => {
            const patchCell = (patch: Partial<GridCell>): void => {
              const cells = block.cells.map((c, i) => (i === cellIndex ? { ...c, ...patch } : c));
              onChange({ cells } as Partial<TemplateBlock>);
            };
            return (
              <Card key={cellIndex} withBorder padding="xs" radius="sm">
                <Stack gap={4}>
                  <Group justify="space-between">
                    <Text size="xs" fw={600} c="dimmed">
                      Cell {cellIndex + 1}
                    </Text>
                    <Switch
                      size="xs"
                      label="Card"
                      checked={Boolean(cell.card)}
                      onChange={(e) => patchCell({ card: e.currentTarget.checked || undefined })}
                    />
                  </Group>
                  <TextInput
                    size="xs"
                    placeholder="Heading"
                    value={cell.heading ?? ''}
                    onChange={(e) => patchCell({ heading: e.currentTarget.value || undefined })}
                  />
                  <TextInput
                    size="xs"
                    placeholder="Text"
                    value={cell.text ?? ''}
                    onChange={(e) => patchCell({ text: e.currentTarget.value || undefined })}
                  />
                  <Group gap={4} grow>
                    <TextInput
                      size="xs"
                      placeholder="Image URL"
                      value={cell.imageSrc ?? ''}
                      onChange={(e) => patchCell({ imageSrc: e.currentTarget.value || undefined })}
                    />
                    <TextInput
                      size="xs"
                      placeholder="Image links to…"
                      value={cell.imageHref ?? ''}
                      onChange={(e) => patchCell({ imageHref: e.currentTarget.value || undefined })}
                    />
                  </Group>
                  <Group gap={4} grow>
                    <TextInput
                      size="xs"
                      placeholder="Button label"
                      value={cell.buttonText ?? ''}
                      onChange={(e) => patchCell({ buttonText: e.currentTarget.value || undefined })}
                    />
                    <TextInput
                      size="xs"
                      placeholder="Button links to…"
                      value={cell.buttonHref ?? ''}
                      onChange={(e) => patchCell({ buttonHref: e.currentTarget.value || undefined })}
                    />
                  </Group>
                  {(cell.card || cell.backgroundColor) && (
                    <ColorInput
                      size="xs"
                      format="hex"
                      placeholder="Cell background"
                      swatches={swatches}
                      value={cell.backgroundColor ?? ''}
                      onChange={(value) => patchCell({ backgroundColor: value || undefined })}
                    />
                  )}
                </Stack>
              </Card>
            );
          })}
        </Stack>
      )}
      {colorable && (
        <ColorInput
          mt={6}
          size="xs"
          format="hex"
          label="Color"
          placeholder={block.type === 'button' ? 'Brand primary' : 'Default'}
          swatches={swatches}
          value={'color' in block ? (block.color ?? '') : ''}
          onChange={(value) => onChange({ color: value || undefined } as Partial<TemplateBlock>)}
        />
      )}
    </Card>
  );
}
