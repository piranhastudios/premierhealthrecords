// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { getReferenceString } from '@medplum/core';
import { useDoseSpotNotifications } from '@medplum/dosespot-react';
import { AppShell, Loading, Logo, useMedplum, useMedplumProfile } from '@medplum/react';
import {
  IconApps,
  IconBook2,
  IconCalendarEvent,
  IconClipboardCheck,
  IconLayoutDashboard,
  IconMail,
  IconPill,
  IconPrinter,
  IconSettingsAutomation,
  IconUserPlus,
  IconUsers,
} from '@tabler/icons-react';
import type { JSX } from 'react';
import { Suspense, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useSearchParams } from 'react-router';
import { TaskDetailsModal } from './components/tasks/TaskDetailsModal';
import { hasScriptSureIdentifier } from './components/utils';
import { useDoseSpotAccess } from './hooks/useDoseSpotAccess';
import './index.css';

const SETUP_DISMISSED_KEY = 'medplum-provider-setup-completed';

import { DashboardPage } from './pages/dashboard/DashboardPage';
import { DocsPage } from './pages/docs/DocsPage';
import { EncounterChartPage } from './pages/encounter/EncounterChartPage';
import { EncounterModal } from './pages/encounter/EncounterModal';
import { FaxPage } from './pages/fax/FaxPage';
import { GetStartedPage } from './pages/getstarted/GetStartedPage';
import { DoseSpotFavoritesPage } from './pages/integrations/DoseSpotFavoritesPage';
import { DoseSpotNotificationsPage } from './pages/integrations/DoseSpotNotificationsPage';
import { IntegrationsPage } from './pages/integrations/IntegrationsPage';
import { ScriptSurePage } from './pages/integrations/ScriptSurePage';
import { MessagesPage } from './pages/messages/MessagesPage';
import { CommunicationTab } from './pages/patient/CommunicationTab';
import { CoveragePage } from './pages/patient/CoveragePage';
import { DoseSpotTab } from './pages/patient/DoseSpotTab';
import { EditTab } from './pages/patient/EditTab';
import { ExportTab } from './pages/patient/ExportTab';
import { LabsPage } from './pages/patient/LabsPage';
import { MedicationsPage } from './pages/patient/MedicationsPage';
import { OverviewTab } from './pages/patient/overview/OverviewTab';
import { PatientPage } from './pages/patient/PatientPage';
import { PatientSearchPage } from './pages/patient/PatientSearchPage';
import { PaymentsTab } from './pages/patient/PaymentsTab';
import { ScriptSureTab } from './pages/patient/ScriptSureTab';
import { TasksTab } from './pages/patient/TasksTab';
import { TimelineTab } from './pages/patient/TimelineTab';
import { ResourceCreatePage } from './pages/resource/ResourceCreatePage';
import { ResourceDetailPage } from './pages/resource/ResourceDetailPage';
import { ResourceEditPage } from './pages/resource/ResourceEditPage';
import { ResourceHistoryPage } from './pages/resource/ResourceHistoryPage';
import { ResourcePage } from './pages/resource/ResourcePage';
import { SchedulePage } from './pages/schedule/SchedulePage';
import { ScheduleSettingsPage } from './pages/schedule/ScheduleSettingsPage';
import { SearchPage } from './pages/SearchPage';
import { SetPasswordPage } from './pages/SetPasswordPage';
import { SignInPage } from './pages/SignInPage';
import { SpacesPage } from './pages/spaces/SpacesPage';
import { TasksPage } from './pages/tasks/TasksPage';
import { TelehealthPage } from './pages/telehealth/TelehealthPage';

export function App(): JSX.Element | null {
  const medplum = useMedplum();
  const profile = useMedplumProfile();
  const doseSpotCount = useDoseSpotNotifications();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [setupDismissed, setSetupDismissed] = useState(() => localStorage.getItem(SETUP_DISMISSED_KEY) === 'true');
  const { hasAccess: hasDoseSpot } = useDoseSpotAccess();
  const membership = medplum.getProjectMembership();
  const hasScriptSure = hasScriptSureIdentifier(membership);

  const handleDismissSetup = (): void => {
    localStorage.setItem(SETUP_DISMISSED_KEY, 'true');
    setSetupDismissed(true);
  };

  if (medplum.isLoading()) {
    return null;
  }

  // Telemedicine join page renders standalone (no app chrome) so a patient can
  // join a video visit from a shared link without an account.
  if (location.pathname.startsWith('/telehealth/')) {
    return (
      <Routes>
        <Route path="/telehealth/:appointmentId" element={<TelehealthPage />} />
      </Routes>
    );
  }

  // Emailed invite / password-reset links also render standalone — the person
  // following the link is usually not signed in, and app chrome would be noise.
  if (location.pathname.startsWith('/setpassword/')) {
    return (
      <Routes>
        <Route path="/setpassword/:id/:secret" element={<SetPasswordPage />} />
      </Routes>
    );
  }

  return (
    <AppShell
      logo={<Logo size={24} />}
      pathname={location.pathname}
      searchParams={searchParams}
      layoutVersion="v2"
      showLayoutVersionToggle={false}
      userMenuLinks={[
        {
          icon: <IconBook2 size={14} stroke={1.5} />,
          label: 'Docs',
          href: '/docs',
        },
      ]}
      menus={
        profile
          ? [
              {
                links: [
                  { icon: <IconLayoutDashboard />, label: 'Dashboard', href: '/dashboard' },
                  { icon: <IconBook2 />, label: 'Spaces', href: '/Spaces/Communication' },
                  {
                    icon: <IconUsers />,
                    label: 'Patients',
                    href: '/Patient?_count=20&_fields=name,email,gender&_sort=-_lastUpdated',
                  },
                  { icon: <IconCalendarEvent />, label: 'Schedule', href: `/Calendar/Schedule` },
                  {
                    icon: <IconMail />,
                    label: 'Messages',
                    href: `/Communication?status=in-progress`,
                    notificationCount: {
                      resourceType: 'Communication',
                      countCriteria:
                        'status=in-progress&_has:Communication:part-of:_id:not=null&identifier:not=ai-message-topic&_summary=count',
                      subscriptionCriteria: `Communication?status=in-progress&_has:Communication:part-of:_id:not=null&identifier:not=ai-message-topic`,
                    },
                  },
                  {
                    icon: <IconClipboardCheck />,
                    label: 'Tasks',
                    href: `/Task?owner=${getReferenceString(profile)}&_sort=-_lastUpdated&status=requested,ready,received,accepted,in-progress,draft`,
                    notificationCount: {
                      resourceType: 'Task',
                      countCriteria: `owner=${getReferenceString(profile)}&status=requested,ready,received,accepted,in-progress,draft&_summary=count`,
                      subscriptionCriteria: `Task?owner=${getReferenceString(profile)}&status=requested,ready,received,accepted,in-progress,draft`,
                    },
                  },
                  { icon: <IconPrinter />, label: 'Faxes', href: '/Fax/Communication' },
                ],
              },
              {
                title: 'Quick Links',
                links: [
                  ...(!setupDismissed
                    ? [
                        {
                          icon: <IconSettingsAutomation />,
                          label: 'Get Started',
                          href: '/getstarted',
                          onDismiss: handleDismissSetup,
                        },
                      ]
                    : []),
                  { icon: <IconUserPlus />, label: 'New Patient', href: '/Patient/new' },
                  { icon: <IconApps />, label: 'Integrations', href: '/integrations' },
                  ...(hasDoseSpot
                    ? [
                        {
                          icon: <IconPill />,
                          label: 'DoseSpot',
                          href: '/dosespot',
                          alert: true,
                          count: doseSpotCount ?? 0,
                        },
                      ]
                    : []),
                  ...(hasScriptSure
                    ? [
                        {
                          icon: <IconPill />,
                          label: 'ScriptSure',
                          href: '/scriptsure',
                        },
                      ]
                    : []),
                ],
              },
            ]
          : undefined
      }
      resourceTypeSearchDisabled={true}
      spotlightPatientsOnly={true}
    >
      <Suspense fallback={<Loading />}>
        <Routes>
          {profile ? (
            <>
              <Route path="/docs" element={<DocsPage />} />
              <Route path="/getstarted" element={<GetStartedPage />} />
              <Route path="/Spaces/Communication" element={<SpacesPage />}>
                <Route index element={<SpacesPage />} />
                <Route path=":topicId" element={<SpacesPage />} />
              </Route>
              <Route path="/" element={<Navigate to={setupDismissed ? '/dashboard' : '/getstarted'} replace />} />
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/Patient/new" element={<ResourceCreatePage />} />
              <Route path="/Patient/:patientId" element={<PatientPage />}>
                <Route path="Encounter/new" element={<EncounterModal />} />
                <Route path="Encounter/:encounterId" element={<EncounterChartPage />}>
                  <Route path="Task/:taskId" element={<TaskDetailsModal />} />
                </Route>
                <Route path="edit" element={<EditTab />} />
                <Route path="Communication" element={<CommunicationTab />} />
                <Route path="Communication/:messageId" element={<CommunicationTab />} />
                <Route path="Task" element={<TasksTab />} />
                <Route path="Task/:taskId" element={<TasksTab />} />
                {hasDoseSpot && <Route path="dosespot" element={<DoseSpotTab />} />}
                {hasScriptSure && <Route path="scriptsure" element={<ScriptSureTab />} />}
                <Route path="overview" element={<OverviewTab />} />
                <Route path="timeline" element={<TimelineTab />} />
                <Route path="payments" element={<PaymentsTab />} />
                <Route path="export" element={<ExportTab />} />
                <Route path="ServiceRequest" element={<LabsPage />} />
                <Route path="ServiceRequest/:serviceRequestId" element={<LabsPage />} />
                <Route path="MedicationRequest" element={<MedicationsPage />} />
                <Route path=":resourceType" element={<PatientSearchPage />} />
                <Route path="Coverage" element={<CoveragePage />} />
                <Route path="Coverage/:coverageId" element={<CoveragePage />} />
                <Route path="Coverage/:coverageId/CoverageEligibilityRequest/:requestId" element={<CoveragePage />} />
                <Route path=":resourceType/new" element={<ResourceCreatePage />} />
                <Route path=":resourceType/:id" element={<ResourcePage />}>
                  <Route path="" element={<ResourceDetailPage />} />
                  <Route path="edit" element={<ResourceEditPage />} />
                  <Route path="history" element={<ResourceHistoryPage />} />
                </Route>
                <Route path="" element={<OverviewTab />} />
              </Route>
              <Route path="/Communication" element={<MessagesPage />}>
                <Route index element={<MessagesPage />} />
                <Route path=":messageId" element={<MessagesPage />} />
              </Route>
              <Route path="/Task" element={<TasksPage />} />
              <Route path="/Task/:taskId" element={<TasksPage />} />
              <Route path="/Fax/Communication" element={<FaxPage />} />
              <Route path="/Fax/Communication/:faxId" element={<FaxPage />} />
              {/* /onboarding retired: registration is the profile-driven /Patient/new. */}
              <Route path="/onboarding" element={<Navigate to="/Patient/new" replace />} />
              <Route path="/Calendar/Schedule" element={<SchedulePage />} />
              <Route path="/Calendar/Schedule/:id" element={<SchedulePage />} />
              <Route path="/Calendar/Schedule/:id/settings" element={<ScheduleSettingsPage />} />
              <Route path="/signin" element={<SignInPage />} />
              {hasDoseSpot && <Route path="/dosespot" element={<DoseSpotNotificationsPage />} />}
              {hasScriptSure && <Route path="/scriptsure" element={<ScriptSurePage />} />}
              <Route path="/integrations" element={<IntegrationsPage />} />
              <Route path="/:resourceType" element={<SearchPage />} />
              <Route path="/:resourceType/new" element={<ResourceCreatePage />} />
              <Route path="/:resourceType/:id" element={<ResourcePage />}>
                <Route path="" element={<ResourceDetailPage />} />
                <Route path="edit" element={<ResourceEditPage />} />
                <Route path="history" element={<ResourceHistoryPage />} />
              </Route>
              {hasDoseSpot && <Route path="/integrations/dosespot" element={<DoseSpotFavoritesPage />} />}
            </>
          ) : (
            <>
              <Route path="/signin" element={<SignInPage />} />
              <Route path="*" element={<Navigate to="/signin" replace />} />
            </>
          )}
        </Routes>
      </Suspense>
    </AppShell>
  );
}
