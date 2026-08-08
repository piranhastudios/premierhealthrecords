# Front Desk / Receptionist AccessPolicy

Source of truth for the front-desk (receptionist) role: registration, scheduling,
visit creation, and payment collection. Fixes the "forbidden" errors front desk hit
when editing Patient `gender`, `maritalStatus`, and `communication` (the old runtime
policy had hidden/readonly fields on Patient), and makes "create a visit with an
associated practitioner" work end to end (Practitioner/PlanDefinition read +
Task/RequestGroup/CarePlan/ServiceRequest write, which `PlanDefinition/$apply`
creates under the caller's own policy).

## What the policy grants

- **Read/write** (no `readonly`, no `hiddenFields`/`readonlyFields` — Patient is fully
  editable, including `gender`, `maritalStatus`, `communication`): Patient,
  RelatedPerson, Coverage, Appointment, Slot, Encounter, ClinicalImpression, Task,
  RequestGroup, CarePlan, ServiceRequest, ChargeItem, Invoice, PaymentReconciliation,
  QuestionnaireResponse, Communication, DocumentReference, Binary, Basic.
  - Basic write is required by `Patient/$verify-qr` (it burns a single-use nonce by
    creating a Basic resource).
  - RequestGroup + CarePlan are required because `PlanDefinition/$apply` always
    creates one of each; ServiceRequest + Task are created per plan action.
  - Binary + DocumentReference cover attachment uploads (patient photo, scanned
    ID/consent documents).
- **Read-only** (`"readonly": true`): Practitioner, PractitionerRole, Schedule,
  PlanDefinition, ActivityDefinition, Questionnaire, ChargeItemDefinition,
  Organization, HealthcareService, Location, ValueSet, CodeSystem,
  StructureDefinition, SearchParameter, Bot, Observation, DiagnosticReport,
  Condition, AllergyIntolerance, MedicationRequest, UserConfiguration, ProjectMembership.
  - Observation/DiagnosticReport are deliberately read-only: front desk can view but
    not record clinical data (nurses take vitals). Condition/AllergyIntolerance/MedicationRequest
    likewise: visible on the chart sidebar, not editable (the sidebar summary
    loads the med list; without read it errors "Forbidden").
  - Bot read is required for the user to trigger `Bot/$execute` (the server first
    reads the Bot under the caller's policy).
  - UserConfiguration/ProjectMembership read keep the app shell (menus, profile)
    working under the scoped policy.
- **Not granted**: Project, User, AccessPolicy, Subscription, Consent. Server-side
  subscription processing does not run under the caller's policy, so Subscription
  access is not needed.

## Upload / update the policy (idempotent)

Uses a FHIR conditional update (`PUT AccessPolicy?name=...`): creates the policy the
first time, updates it in place on every subsequent run. Run from this directory
against the production project (sign in first with a project-admin account):

```bash
npx medplum login --base-url https://api.premierhealthcentres.com

npx medplum put 'AccessPolicy?name=Front Desk / Receptionist' "$(cat front-desk-access-policy.json)"
```

Notes:

- The CLI `put` command takes the body as a **string argument**, not an `@file`
  reference — hence `"$(cat ...)"`.
- Quote the URL. The CLI passes it through `new URL(...)`, which percent-encodes the
  spaces, and the server decodes them, so the literal name works. If your shell or
  proxy mangles it, use the pre-encoded form:
  `'AccessPolicy?name=Front%20Desk%20%2F%20Receptionist'`.
- Verify afterwards:

```bash
npx medplum get 'AccessPolicy?name=Front Desk / Receptionist'
```

Exactly one result should come back (if runtime edits ever produced duplicates with
the same name, delete the extras first — conditional update fails on multiple
matches).

## Attach to the receptionist membership (admin app)

1. Open <https://admin.premierhealthcentres.com> and go to **Project** -> **Users**.
2. Click the receptionist user to open their **ProjectMembership**.
3. Set **Access Policy** to `Front Desk / Receptionist` (reference the AccessPolicy
   uploaded above) and save.
4. Repeat for every front-desk user (or clinic-specific receptionist account).
5. Have the user sign out and back in — the policy is rebuilt at login.

## Smoke test (as a front-desk user)

1. Register a patient at **/Patient/new** (the "New Patient" links): the phone row is
   pre-rendered with the dialing-code selector, submitting without a phone number is
   rejected by the server, and the optional Insurance step creates a Coverage.
2. Edit a Patient: change gender, marital status, and language (communication) — save
   must succeed.
2. Schedule page: pick a practitioner's schedule, create a visit with a care template
   (PlanDefinition) — appointment, encounter, tasks, and charge items must all be
   created without "forbidden" errors.
3. Payments tab: view invoices and record a payment.
4. Confirm denials still hold: creating an Observation or editing a Practitioner must
   fail.
