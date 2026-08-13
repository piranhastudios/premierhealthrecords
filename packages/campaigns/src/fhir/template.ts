// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { MedplumClient, WithId } from '@medplum/core';
import { getExtension } from '@medplum/core';
import type { Basic } from '@medplum/fhirtypes';
import {
  BASIC_BRAND_KIT,
  BASIC_EMAIL_TEMPLATE,
  BASIC_TYPE_SYSTEM,
  BRAND_KIT_EXTENSION,
  TEMPLATE_DESIGN_EXTENSION,
  TEMPLATE_HTML_EXTENSION,
  TEMPLATE_SUBJECT_EXTENSION,
  TEMPLATE_VERSION_EXTENSION,
} from '../constants';

/** Parsed content of an email-template Basic. */
export interface TemplateContent {
  /** Block-editor design JSON (opaque to the engine). */
  design?: string;
  /** Compiled HTML with merge-field placeholders. */
  html: string;
  subject: string;
  version: number;
}

/** Per-clinic brand configuration stored on the brand-kit Basic. */
export interface BrandKit {
  logoUrl?: string;
  /** Default color — used for buttons and any block that doesn't override it. */
  primaryColor?: string;
  /**
   * Additional brand colors. Offered as swatches wherever a block color is
   * picked, so operators stay on-brand instead of typing arbitrary hex codes.
   */
  palette?: string[];
  senderName?: string;
  senderAddress?: string;
  footerText?: string;
}

/** Premier Health house palette — the starting point for a new brand kit. */
export const DEFAULT_BRAND_COLORS = ['#f47b20', '#c8102e', '#fdb913'];

/**
 * All brand colors as swatches: the primary first, then the extra palette,
 * de-duplicated.
 * @param brand - The clinic brand kit.
 * @returns Hex colors for swatch pickers.
 */
export function brandSwatches(brand: BrandKit): string[] {
  return [...new Set([brand.primaryColor, ...(brand.palette ?? [])].filter((c): c is string => Boolean(c)))];
}

/**
 * Parses the content of an email-template Basic.
 * @param template - The template resource.
 * @returns The parsed content, or undefined when the template has no compiled HTML.
 */
export function getTemplateContent(template: Basic): TemplateContent | undefined {
  const html = getExtension(template, TEMPLATE_HTML_EXTENSION)?.valueString;
  if (!html) {
    return undefined;
  }
  return {
    design: getExtension(template, TEMPLATE_DESIGN_EXTENSION)?.valueString,
    html,
    subject: getExtension(template, TEMPLATE_SUBJECT_EXTENSION)?.valueString ?? '',
    version: getExtension(template, TEMPLATE_VERSION_EXTENSION)?.valueInteger ?? 1,
  };
}

/**
 * Builds the extension array for saving an email template.
 * @param content - The template content to store.
 * @returns Extensions for the Basic resource.
 */
export function templateExtensions(content: TemplateContent): NonNullable<Basic['extension']> {
  return [
    ...(content.design ? [{ url: TEMPLATE_DESIGN_EXTENSION, valueString: content.design }] : []),
    { url: TEMPLATE_HTML_EXTENSION, valueString: content.html },
    { url: TEMPLATE_SUBJECT_EXTENSION, valueString: content.subject },
    { url: TEMPLATE_VERSION_EXTENSION, valueInteger: content.version },
  ];
}

/** The Basic.code for email templates. */
export const EMAIL_TEMPLATE_CODE = {
  coding: [{ system: BASIC_TYPE_SYSTEM, code: BASIC_EMAIL_TEMPLATE, display: 'Email template' }],
};

/** The Basic.code for the brand kit. */
export const BRAND_KIT_CODE = {
  coding: [{ system: BASIC_TYPE_SYSTEM, code: BASIC_BRAND_KIT, display: 'Brand kit' }],
};

/**
 * Lists the project's email templates, newest first.
 * @param medplum - The Medplum client.
 * @returns Email-template Basics.
 */
export async function searchTemplates(medplum: MedplumClient): Promise<WithId<Basic>[]> {
  return medplum.searchResources('Basic', [
    ['code', BASIC_EMAIL_TEMPLATE],
    ['_sort', '-_lastUpdated'],
    ['_count', '100'],
  ]);
}

/**
 * Reads the project's brand kit, if configured.
 * @param medplum - The Medplum client.
 * @returns The brand kit config, with the holding resource.
 */
export async function getBrandKit(
  medplum: MedplumClient
): Promise<{ resource: WithId<Basic>; kit: BrandKit } | undefined> {
  const resource = await medplum.searchOne('Basic', [['code', BASIC_BRAND_KIT]]);
  if (!resource) {
    return undefined;
  }
  const value = getExtension(resource, BRAND_KIT_EXTENSION)?.valueString;
  try {
    return { resource, kit: value ? (JSON.parse(value) as BrandKit) : {} };
  } catch {
    return { resource, kit: {} };
  }
}
