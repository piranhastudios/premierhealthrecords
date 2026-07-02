# Premier Health — Demo Walkthrough

A step-by-step script for demoing the system: a patient arrives, is **checked in at the front desk**,
**sent to the nurse for vitals**, and then **messaged on WhatsApp/email** — with replies landing live
in the staff inbox. Follow it top to bottom in the provider app at
`https://app.premierhealthcentres.com`.

> **Who you log in as:** run the demo as **`admin@example.com`** (super admin). That's where your
> patients and the messaging live today, so everything works in one place. The `frontdesk@example.com`
> and `nurse@example.com` logins exist (password `medplum_user`) and we *narrate* their roles below —
> if you'd rather perform the demo as those two separate logins with enforced permissions, I can move
> everything into their project first (5-minute change; ask me). The steps themselves are identical.

---

## Before you start (one-time, ~5 min)
1. **Paste the webhook URLs** (so the patient can message you back):
   - Twilio Console → Messaging → *Try it out → Send a WhatsApp message → Sandbox settings*:
     - *When a message comes in* (POST) → `https://app.premierhealthcentres.com/api/webhook/5242cb3b-3ff5-457a-b663-41cf0c2a1269`
     - *Status callback URL* → `https://app.premierhealthcentres.com/api/webhook/14fbce55-d35f-4c4f-9b1c-6f3aab13bc1e`
   - Resend → Webhooks → add `https://app.premierhealthcentres.com/api/webhook/6dd1330b-d0db-4c3f-9817-106e7622aa5d`, event **`email.received`**.
2. **Join the WhatsApp sandbox**: from the phone you'll demo with, send the sandbox **join code** to
   `+14155238886` (shown on the Twilio Sandbox page).
3. **Pick your demo patient**: you'll set their phone to *your* sandbox phone and email to an inbox you
   control (done in Part A) — only joined numbers can receive sandbox WhatsApp.

---

## Part A — Front desk: patient arrives & check-in
*Role: Front Desk.*
1. From the left nav, open **Patients**. Either pick an existing patient or click **New Patient** and
   enter a name + date of birth.
2. On the patient's chart, set their contact details so we can message them later:
   - **Phone** = your sandbox-joined WhatsApp number in full international form (e.g. `+447700900123`).
   - **Email** = an inbox you can open.
3. **Start the visit**: click **New Encounter** (the visit), pick a visit type/template if prompted,
   and save. This is the "checked in / arrived" moment — the patient is now in the building and on the
   board for the nurse.
   - *Talking point:* the front desk owns demographics, scheduling, insurance (Coverage), and check-in
     — not clinical data.

## Part B — Nurse: record vitals
*Role: Nurse.*
1. Open the same patient's chart (or the encounter you just created).
2. In the right-hand **patient summary**, find the **Vitals** section and click the **`+`**.
3. Enter a few vitals — e.g. **Blood pressure** `120/80`, **Heart rate** `72`, **Temperature** `36.8°C`
   — and save. Each becomes a clinical Observation on the patient's record.
   - *Talking point:* the nurse records clinical Observations and works the encounter; they can read
     demographics but the roles are separated.

## Part C — Reach the patient on WhatsApp
*Role: any staff, from the inbox.*
1. Open **Messages** (the inbox). *(Note: the red "WebSocket subscriptions not enabled" error is now
   gone — realtime is on.)*
2. Click **New**, choose your demo patient, set **Channel = WhatsApp**, and start the thread.
3. Type a message (e.g. *"Hi, this is Premier Health — your vitals look great. Reply here if you have
   any questions."*) and send.
   - ✅ It arrives on your phone via WhatsApp (from `+14155238886`), and in the inbox the message gets a
     **delivery tick**.
4. **Reply from your phone** on WhatsApp.
   - ✅ Your reply appears **live in the open inbox** — no refresh. The 24-hour reply window banner shows
     as open.

## Part D — Reach the patient by email
1. Click **New** again, same patient, **Channel = Email**, and send a message.
   - ✅ The patient gets an email from `phc@piranha-studios.co.uk`.
2. **Reply to that email.**
   - ✅ The reply threads back into the same conversation in the inbox, live.

## Part E — Nice extras to show
- **Delivery receipts:** point out the tick state on sent WhatsApp messages (sent → delivered).
- **24-hour window:** WhatsApp only allows free-form replies within 24h of the patient's last message;
  when it's closed, the reply box switches to **approved templates** only. *(Templates need Meta
  approval before they appear — ask to wire a sample one.)*
- **Triage:** message the sandbox from a number that isn't on any patient → a thread appears in an
  **"Unassigned"** queue with a follow-up Task, so staff can link it to the right patient.

---

## Talking points / what was built
- Two-way patient messaging on **WhatsApp (Twilio)** and **email (Resend)**, all inside the existing
  staff inbox — no separate app for patients.
- **Realtime**: inbound messages push to the open inbox instantly.
- **Channel-aware** reply box: WhatsApp 24h-window indicator + approved-template picker; email threading.
- **Safety**: delivery receipts, idempotent inbound (no duplicates), loop-prevention, and a triage queue
  for unknown senders.
- A **sandbox/production switch** (`TWILIO_SANDBOX`) so you can demo on the sandbox today and flip to a
  real WhatsApp Business number later without code changes.

---

## Appendix — for whoever runs the environment
- **Where things live:** bots, the outbound Subscription, your patients, and the secrets are in the
  **`Super Admin` project** (so demo as the super admin). The scoped `nurse`/`frontdesk` accounts are
  in the empty `FHIR R4` project until you decide to consolidate.
- **Deployed bots:** `premierhealth-outbound-dispatch`, `-twilio-whatsapp-inbound`,
  `-twilio-status-callback`, `-inbound-email`. Open any one in the app to see its execution log
  (great for live debugging during the demo).
- **If a WhatsApp send fails:** most common cause is the patient's phone hasn't **joined the sandbox**,
  or isn't in `+<country><number>` form. The outbound bot records the reason on a `delivery-failed`
  Task.
- **Security:** change the super-admin **default password** (`admin@example.com` / `medplum_admin`) —
  it's a live exposure on a public server.
- Full provisioning details (secrets, features, webhook wiring) are in `SETUP.md`.
