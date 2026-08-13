// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Canonical systems, URLs, and codes for the campaign engine. Every consumer
 * (bots, admin app, provider app) imports these from here — never redefine.
 */

const PHC = 'https://premierhealth.cm/fhir';

/** PlanDefinition.type discriminator — campaign vs (untyped) care template. */
export const PLAN_TYPE_SYSTEM = `${PHC}/CodeSystem/plan-type`;
export const PLAN_TYPE_CAMPAIGN = 'campaign';

/** Extension holding the working campaign graph JSON on the PlanDefinition. */
export const CAMPAIGN_GRAPH_EXTENSION = `${PHC}/StructureDefinition/campaign-graph`;
/** Extensions on the activation snapshot Basic. */
export const CAMPAIGN_VERSION_EXTENSION = `${PHC}/StructureDefinition/campaign-version`;
export const CAMPAIGN_TEMPLATES_EXTENSION = `${PHC}/StructureDefinition/campaign-compiled-templates`;

/** Basic.code values (system `basic-resource-type`). */
export const BASIC_TYPE_SYSTEM = `${PHC}/CodeSystem/basic-resource-type`;
export const BASIC_CAMPAIGN_SNAPSHOT = 'campaign-snapshot';
export const BASIC_EMAIL_TEMPLATE = 'email-template';
export const BASIC_BRAND_KIT = 'brand-kit';

/** Email template Basic extensions. */
export const TEMPLATE_DESIGN_EXTENSION = `${PHC}/StructureDefinition/email-template-design`;
export const TEMPLATE_HTML_EXTENSION = `${PHC}/StructureDefinition/email-template-html`;
export const TEMPLATE_SUBJECT_EXTENSION = `${PHC}/StructureDefinition/email-template-subject`;
export const TEMPLATE_VERSION_EXTENSION = `${PHC}/StructureDefinition/email-template-version`;
/** Brand kit Basic extension (JSON config). */
export const BRAND_KIT_EXTENSION = `${PHC}/StructureDefinition/brand-kit-config`;

/** Enrolment Task coding + identifier system. */
export const TASK_TYPE_SYSTEM = `${PHC}/CodeSystem/task-type`;
export const TASK_CAMPAIGN_ENROLMENT = 'campaign-enrolment';
export const ENROLMENT_IDENTIFIER_SYSTEM = `${PHC}/identifiers/campaign-enrolment`;
/** Task.businessStatus system — code is the current graph node id. */
export const CAMPAIGN_NODE_SYSTEM = `${PHC}/CodeSystem/campaign-node`;
export const ENROLMENT_RETRY_EXTENSION = `${PHC}/StructureDefinition/campaign-retry-count`;
/** Task.input type codes. */
export const ENROLMENT_INPUT_SNAPSHOT = 'snapshot';
export const ENROLMENT_INPUT_TRIGGER_CONTEXT = 'trigger-context';

/** Communication category (send classification). */
export const COMMUNICATION_CATEGORY_SYSTEM = `${PHC}/CodeSystem/communication-category`;
/** Resend message id identifier system on Communication. */
export const RESEND_IDENTIFIER_SYSTEM = 'https://resend.com/emails';
/** Repeated extension on Communication carrying delivery events. */
export const EMAIL_EVENT_EXTENSION = `${PHC}/StructureDefinition/email-event`;

/** Consent scopes. */
export const CONSENT_SCOPE_SYSTEM = `${PHC}/CodeSystem/consent-scope`;
export type ConsentScope = 'marketing' | 'care-communication';
export const CONSENT_SCOPE_MARKETING: ConsentScope = 'marketing';
export const CONSENT_SCOPE_CARE: ConsentScope = 'care-communication';

/** Patient meta tag applied when an address hard-bounces or complains. */
export const PATIENT_TAG_SYSTEM = `${PHC}/CodeSystem/patient-tag`;
export const PATIENT_TAG_SUPPRESSED = 'email-suppressed';

/** Group.code for campaign audiences. */
export const GROUP_TYPE_SYSTEM = `${PHC}/CodeSystem/group-type`;
export const GROUP_CAMPAIGN_AUDIENCE = 'campaign-audience';

/** AuditEvent type for AI generations (Phase A). */
export const AUDIT_EVENT_TYPE_SYSTEM = `${PHC}/CodeSystem/audit-event-type`;
export const AUDIT_AI_GENERATION = 'ai-generation';

/** Default timezone for quiet-hours evaluation. */
export const DEFAULT_TIMEZONE = 'Africa/Douala';

/** Send retry backoff schedule (minutes) before parking the enrolment on-hold. */
export const RETRY_BACKOFF_MINUTES = [5, 30, 120];
