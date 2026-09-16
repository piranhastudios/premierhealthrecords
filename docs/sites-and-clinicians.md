# Sites, clinicians and bookable diaries

How places and people become bookable, in every environment. The data model and
the reasoning behind it live in the header of `scripts/seed-cameroon-sites.mjs`;
this page is the operational side.

## The one command

The seed is the source of truth and is idempotent — safe to re-run any time:

    # Dev project (Douala (dev))
    node scripts/seed-cameroon-sites.mjs --base https://app.premierhealthcentres.com/api \
      --project c4c16ab3-e93d-47b3-a106-2030dcf79f1a

    # Live project (Douala)
    node scripts/seed-cameroon-sites.mjs --base https://app.premierhealthcentres.com/api \
      --project 161452d9-43b7-5c29-aa7b-c85680fa45c6

It upserts, per environment: Organization → Locations (sites) → HealthcareServices
(service lines × sites, with prices) → Practitioners → one PractitionerRole and one
Schedule per (clinician × site). Matching is by identifier slug, so re-running never
duplicates, and staff edits to Schedules (scheduling parameters, toggled service
types) survive.

- **Add a site**: one entry in `SITES`, re-run.
- **Add a doctor**: one entry in `CLINICIANS`, re-run.
- **Add a nurse**: one entry in `NURSES`, re-run.

## Nurses and video visits

The patient app's "Video visit with a nurse" (and the onboarding intro appointment)
finds nurses by `PractitionerRole.code` text **`Nurse`** — keep that text stable.
`NURSES` currently holds one deliberately generic **Nurse Team** (slug `nurse-team`,
specialty Nursing, telehealth only). Before live users book, replace it with one
entry per real nurse; the app copes with one or many (one nurse → straight to their
diary, several → the clinician search filtered to Nursing).

Seed entries are records, not logins. Invite the person in the admin app when they
need to sign in — matching is by identifier, so a later invite attaches to the same
Practitioner.

## What the admin app can and cannot do today

Everything the seed creates is an ordinary FHIR resource, so the admin app *can*
edit any of it — but creating a new site or diary by hand means wiring identifiers,
the `Africa/Douala` timezone extension, SchedulingParameters, and serviceType
entries that embed a HealthcareService reference extension. Getting one of those
wrong breaks `$find`/`$book` silently, which is exactly why the seed exists.

Until there is a proper "Sites & staff" screen in the provider app, the supported
workflow for going live in Douala is:

1. Edit the lists in `scripts/seed-cameroon-sites.mjs` (sites, clinicians, nurses,
   prices, opening hours).
2. Re-run the seed against **dev**, check booking in the apps against `Douala (dev)`.
3. Re-run against the **live** project id.

Day-to-day adjustments that *are* safe in the apps: per-clinician availability
overrides (Schedule-level scheduling parameters in the provider app) and toggling
which services a schedule offers — the seed never clobbers either.
