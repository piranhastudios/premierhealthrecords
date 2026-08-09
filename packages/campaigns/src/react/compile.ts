// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
// mjml-browser ships no types; the ambient declaration must travel with this
// file so downstream tsc runs (apps compiling our src via paths) resolve it.
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./mjml-browser.d.ts" />
import mjml2html from 'mjml-browser';
import type { BrandKit } from '../fhir/template';

/**
 * Email template block model. The design JSON stored on the template Basic is
 * `{ blocks: TemplateBlock[] }`; compilation goes blocks → MJML →
 * client-friendly HTML via mjml-browser (client-side, at save time — bots only
 * ever do merge-field string substitution on the compiled HTML).
 */

/**
 * Blocks may carry their own `color` (chosen from the brand palette); when
 * unset they inherit the brand's primary color / default text color.
 */
/**
 * One cell of a grid block. Every part is optional, so a cell can be a plain
 * caption, a linked image, or a full card (image + heading + text + button).
 */
export interface GridCell {
  imageSrc?: string;
  /** Makes the image clickable. */
  imageHref?: string;
  heading?: string;
  text?: string;
  /** Renders a button when both label and link are set. */
  buttonText?: string;
  buttonHref?: string;
  /** Draws the cell as a card: background, padding and rounded corners. */
  card?: boolean;
  /** Card background (defaults to white when `card` is set). */
  backgroundColor?: string;
  /** Text color for the heading and body of this cell. */
  color?: string;
}

export type TemplateBlock =
  | { id: string; type: 'heading'; text: string; color?: string }
  | { id: string; type: 'text'; text: string; color?: string }
  | { id: string; type: 'image'; src: string; alt?: string; href?: string }
  | { id: string; type: 'button'; text: string; href: string; color?: string }
  | { id: string; type: 'divider'; color?: string }
  | { id: string; type: 'spacer'; height: number }
  | { id: string; type: 'columns'; left: string; right: string }
  /** N-column grid (2-4). Each cell can hold text and/or an image. */
  | { id: string; type: 'grid'; columns: number; cells: GridCell[] }
  /** Custom HTML injected into a visually-built template (MJML `mj-raw`). */
  | { id: string; type: 'html'; html: string }
  | { id: string; type: 'footer' };

/** Block types that expose a color picker in the editor. */
export const COLORABLE_BLOCK_TYPES = new Set(['heading', 'text', 'button', 'divider']);

/** Column counts offered for a grid block. */
export const GRID_COLUMN_OPTIONS = [2, 3, 4];

export interface TemplateDesign {
  /**
   * How this template is authored. `visual` compiles the blocks below; `html`
   * uses hand-written HTML (the locked footer is still appended on compile).
   */
  mode?: 'visual' | 'html';
  blocks: TemplateBlock[];
  /** Raw HTML body, used when mode is `html`. */
  html?: string;
  /** Page background behind the email card. */
  backgroundColor?: string;
  /** Background of the email content card itself. */
  contentBackgroundColor?: string;
}

/** Default page / content backgrounds when the design doesn't set them. */
export const DEFAULT_PAGE_BACKGROUND = '#f5f2ee';
export const DEFAULT_CONTENT_BACKGROUND = '#ffffff';

/**
 * Block types offered by the editor palette. 'footer' is locked (always
 * appended), and 'columns' is superseded by the richer 'grid' — existing
 * templates still render it, but new ones use grid.
 */
export const ADDABLE_BLOCK_TYPES = ['heading', 'text', 'image', 'button', 'divider', 'spacer', 'grid', 'html'] as const;

/**
 * Parses stored design JSON. Every field must be carried through — dropping
 * `mode` here silently reverted saved HTML templates to the visual editor.
 *
 * @param design - The stored design JSON, if any.
 * @returns The parsed design (empty visual design when absent/corrupt).
 */
export function parseDesign(design: string | undefined): TemplateDesign {
  if (!design) {
    return { blocks: [] };
  }
  try {
    const parsed = JSON.parse(design) as TemplateDesign;
    return {
      mode: parsed.mode ?? 'visual',
      blocks: parsed.blocks ?? [],
      html: parsed.html,
      backgroundColor: parsed.backgroundColor,
      contentBackgroundColor: parsed.contentBackgroundColor,
    };
  } catch {
    return { blocks: [] };
  }
}

function escapeHtml(value: string): string {
  // Merge-field braces survive; only structural characters are escaped.
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/** Blocks that need their own multi-column `mj-section` rather than inline content. */
const MULTI_COLUMN_TYPES = new Set(['columns', 'grid']);

/**
 * Renders a `columns` or `grid` block as a complete `mj-section`. MJML only
 * allows columns as direct children of a section, so these cannot live inside
 * the single-column run — they get their own section inside the same wrapper.
 *
 * @param block - The columns or grid block.
 * @param brand - The clinic brand kit (button colors in grid cells).
 * @returns Section MJML.
 */
function multiColumnSectionMjml(block: TemplateBlock, brand: BrandKit): string {
  const brandColor = brand.primaryColor ?? '#f47b20';
  if (block.type === 'columns') {
    return (
      `<mj-section padding="0">` +
      `<mj-column><mj-text font-size="15px" padding="8px 24px">${escapeHtml(block.left)}</mj-text></mj-column>` +
      `<mj-column><mj-text font-size="15px" padding="8px 24px">${escapeHtml(block.right)}</mj-text></mj-column>` +
      `</mj-section>`
    );
  }
  if (block.type === 'grid') {
    // One mj-column per cell — MJML stacks them on narrow screens automatically.
    const cells = block.cells.slice(0, block.columns).map((cell) => gridCellMjml(cell, brandColor)).join('');
    return `<mj-section padding="0">${cells}</mj-section>`;
  }
  return '';
}

/**
 * Renders a single grid cell as an `mj-column`: optional (optionally linked)
 * image, heading, body text and button, with card styling when requested.
 *
 * @param cell - The cell content.
 * @param brandColor - Fallback button color.
 * @returns Column MJML.
 */
function gridCellMjml(cell: GridCell, brandColor: string): string {
  let attrs = '';
  if (cell.card) {
    attrs = ` background-color="${cell.backgroundColor ?? '#ffffff'}" border-radius="10px" padding="12px"`;
  } else if (cell.backgroundColor) {
    attrs = ` background-color="${cell.backgroundColor}" padding="12px"`;
  }
  const textColor = cell.color ? ` color="${cell.color}"` : '';
  const image = cell.imageSrc
    ? `<mj-image src="${cell.imageSrc}"${cell.imageHref ? ` href="${cell.imageHref}"` : ''} border-radius="8px" padding="4px 8px" />`
    : '';
  const heading = cell.heading
    ? `<mj-text font-size="16px" font-weight="700" padding="8px 8px 2px"${textColor}>${escapeHtml(cell.heading)}</mj-text>`
    : '';
  const text = cell.text
    ? `<mj-text font-size="14px" line-height="1.5" padding="4px 8px"${textColor}>${escapeHtml(cell.text)}</mj-text>`
    : '';
  const button =
    cell.buttonText && cell.buttonHref
      ? `<mj-button href="${cell.buttonHref}" background-color="${brandColor}" border-radius="8px" font-size="13px" padding="8px" inner-padding="8px 16px">${escapeHtml(cell.buttonText)}</mj-button>`
      : '';
  return `<mj-column${attrs}>${image}${heading}${text}${button}</mj-column>`;
}

function blockToMjml(block: TemplateBlock, brand: BrandKit): string {
  const brandColor = brand.primaryColor ?? '#f47b20';
  switch (block.type) {
    case 'heading':
      return `<mj-text font-size="24px" font-weight="700" padding="16px 24px 8px"${
        block.color ? ` color="${block.color}"` : ''
      }>${escapeHtml(block.text)}</mj-text>`;
    case 'text':
      return `<mj-text font-size="15px" line-height="1.6" padding="8px 24px"${
        block.color ? ` color="${block.color}"` : ''
      }>${escapeHtml(block.text)}</mj-text>`;
    case 'image':
      return `<mj-image src="${block.src}" alt="${escapeHtml(block.alt ?? '')}"${
        block.href ? ` href="${block.href}"` : ''
      } padding="8px 24px" />`;
    case 'button':
      return `<mj-button href="${block.href}" background-color="${block.color ?? brandColor}" border-radius="8px" padding="12px 24px">${escapeHtml(block.text)}</mj-button>`;
    case 'divider':
      return `<mj-divider border-width="1px" border-color="${block.color ?? '#e5e5e5'}" padding="12px 24px" />`;
    case 'spacer':
      return `<mj-spacer height="${block.height}px" />`;
    case 'html':
      // mj-raw passes the markup through untouched — the escape hatch for custom
      // code inside an otherwise visually-built template.
      return `<mj-raw>${block.html}</mj-raw>`;
    case 'footer':
      return footerMjml(brand);
    default:
      return '';
  }
}

/**
 * The locked footer: sender identity + unsubscribe link. Always rendered last,
 * whether or not the design includes a footer block — the footer cannot be
 * removed from a compiled template.
 * @param brand - The clinic brand kit.
 * @returns The footer MJML.
 */
function footerMjml(brand: BrandKit): string {
  const sender = escapeHtml(brand.senderName ?? 'Premier Health');
  const address = escapeHtml(brand.footerText ?? '');
  // `{{unsubscribe}}` is a reserved merge field: the executor swaps in a signed,
  // per-recipient link at send time. Operators never configure a URL.
  return (
    `<mj-divider border-width="1px" border-color="#e5e5e5" padding="24px 24px 12px" />` +
    `<mj-text font-size="12px" color="#868e96" padding="4px 24px">${sender}${address ? ` · ${address}` : ''}</mj-text>` +
    `<mj-text font-size="12px" color="#868e96" padding="0 24px 24px"><a href="{{unsubscribe}}" style="color:#868e96">Unsubscribe</a></mj-text>`
  );
}

/**
 * Compiles a template design to email-safe HTML via MJML.
 * @param design - The block design.
 * @param brand - The clinic brand kit (colors, sender identity, unsubscribe).
 * @returns The compiled HTML.
 */
export function compileDesign(design: TemplateDesign, brand: BrandKit): string {
  // Hand-written HTML mode: the author owns the body, but the compliance footer
  // (sender identity + unsubscribe) is still appended — it is never optional.
  if (design.mode === 'html') {
    return `${design.html ?? ''}\n${footerHtml(brand, design.backgroundColor ?? DEFAULT_PAGE_BACKGROUND)}`;
  }

  const result = mjml2html(designToMjml(design, brand), { validationLevel: 'soft' });
  return result.html;
}

/**
 * Builds the MJML document for a visual design. Exported so tests can assert
 * the document structure directly.
 *
 * Blocks are grouped into sections inside a single `mj-wrapper`: runs of normal
 * blocks become one single-column section, while `columns`/`grid` blocks each
 * get their own multi-column section (MJML requires columns to be direct
 * children of a section). The wrapper — not the individual sections — carries
 * the content background and rounded corners, so every block stays on the card.
 *
 * @param design - The template design.
 * @param brand - The clinic brand kit.
 * @param includeFooter - Whether to append the locked footer (false when converting a design to HTML mode).
 * @returns The MJML document.
 */
export function designToMjml(design: TemplateDesign, brand: BrandKit, includeFooter = true): string {
  const pageBackground = design.backgroundColor ?? DEFAULT_PAGE_BACKGROUND;
  const contentBackground = design.contentBackgroundColor ?? DEFAULT_CONTENT_BACKGROUND;
  const bodyBlocks = design.blocks.filter((b) => b.type !== 'footer');

  const sections: string[] = [];
  let run: TemplateBlock[] = [];
  const flushRun = (): void => {
    if (run.length > 0) {
      sections.push(`<mj-section padding="0"><mj-column>${run.map((b) => blockToMjml(b, brand)).join('')}</mj-column></mj-section>`);
      run = [];
    }
  };
  for (const block of bodyBlocks) {
    if (MULTI_COLUMN_TYPES.has(block.type)) {
      flushRun();
      sections.push(multiColumnSectionMjml(block, brand));
    } else {
      run.push(block);
    }
  }
  flushRun();
  // The footer always closes the card. It is omitted only when converting a
  // design into the HTML editor, where compileDesign appends it again on save.
  if (includeFooter) {
    sections.push(`<mj-section padding="0"><mj-column>${footerMjml(brand)}</mj-column></mj-section>`);
  }

  return (
    `<mjml><mj-head><mj-attributes><mj-all font-family="Helvetica, Arial, sans-serif" /></mj-attributes></mj-head>` +
    `<mj-body background-color="${pageBackground}">` +
    (brand.logoUrl
      ? `<mj-section padding="24px 0 0"><mj-column><mj-image src="${brand.logoUrl}" width="140px" /></mj-column></mj-section>`
      : '') +
    `<mj-wrapper background-color="${contentBackground}" border-radius="12px" padding="12px 0">` +
    sections.join('') +
    `</mj-wrapper>` +
    `</mj-body></mjml>`
  );
}

/**
 * Compiles a visual design to HTML *without* the locked footer — used to seed
 * the HTML editor when switching a visually-built template to HTML mode, so the
 * operator keeps their work and doesn't end up with two footers (compileDesign
 * appends one in HTML mode).
 *
 * @param design - The visual design to convert.
 * @param brand - The clinic brand kit.
 * @returns HTML for the body, footer excluded.
 */
export function compileDesignBody(design: TemplateDesign, brand: BrandKit): string {
  return mjml2html(designToMjml(design, brand, false), { validationLevel: 'soft' }).html;
}

/**
 * Plain-HTML equivalent of the locked footer, appended in hand-written HTML
 * mode where there is no MJML document to extend.
 * @param brand - The clinic brand kit.
 * @param background - Page background, so the footer blends with the email.
 * @returns Footer HTML.
 */
function footerHtml(brand: BrandKit, background: string): string {
  const sender = escapeHtml(brand.senderName ?? 'Premier Health');
  const address = escapeHtml(brand.footerText ?? '');
  return (
    `<div style="background:${background};padding:24px;text-align:center;font-family:Helvetica,Arial,sans-serif">` +
    `<hr style="border:none;border-top:1px solid #e5e5e5;margin:0 0 12px" />` +
    `<p style="margin:0 0 6px;font-size:12px;color:#868e96">${sender}${address ? ` · ${address}` : ''}</p>` +
    `<p style="margin:0;font-size:12px;color:#868e96"><a href="{{unsubscribe}}" style="color:#868e96">Unsubscribe</a></p>` +
    `</div>`
  );
}

/** Preset merge fields offered by the picker (label + expression). */
export const MERGE_FIELD_PRESETS: { label: string; field: string }[] = [
  { label: 'Patient first name', field: 'patient.name.given.first()' },
  { label: 'Patient family name', field: 'patient.name.family' },
  { label: 'Appointment start', field: 'resource.start' },
  { label: 'Clinic name', field: 'clinic.name' },
];
