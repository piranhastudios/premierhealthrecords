// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Button, Drawer, Loader, Modal, ScrollArea, Text } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { getReferenceString, isOk } from '@medplum/core';
import type { OperationOutcome } from '@medplum/fhirtypes';
import {
  createPharmaciesSection,
  Document,
  getDefaultSections,
  OperationOutcomeAlert,
  PatientSummary,
  PatientTimeline,
  useMedplum,
} from '@medplum/react';
import { IconTimeline } from '@tabler/icons-react';
import type { JSX } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Location } from 'react-router';
import { Outlet, useLocation, useNavigate } from 'react-router';
import { NewLabOrder } from '../../components/labs/NewLabOrder';
import { usePharmacyDialog } from '../../components/pharmacy/usePharmacyDialog';
import { useDoseSpotAccess } from '../../hooks/useDoseSpotAccess';
import { usePatient } from '../../hooks/usePatient';
import classes from './PatientPage.module.css';
import type { PatientPageTabInfo } from './PatientPage.utils';
import { formatPatientPageTabUrl, getPatientPageTabs } from './PatientPage.utils';
import { PatientTabsNavigation } from './PatientTabsNavigation';

function getTabFromLocation(location: Location, tabs: PatientPageTabInfo[]): PatientPageTabInfo | undefined {
  const tabId = location.pathname.split('/')[3] ?? '';
  // If tabId is empty, find the tab with empty url (timeline)
  if (!tabId) {
    return tabs.find((t) => t.url === '');
  }
  return tabs.find((t) => t.id === tabId || t.url.toLowerCase().startsWith(tabId.toLowerCase()));
}

export function PatientPage(): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const medplum = useMedplum();
  const membership = medplum.getProjectMembership();
  const [outcome, setOutcome] = useState<OperationOutcome>();
  const patient = usePatient({ setOutcome });
  const [isLabsModalOpen, setIsLabsModalOpen] = useState(false);
  const [timelineOpened, timelineHandlers] = useDisclosure(false);
  const PharmacyDialogComponent = usePharmacyDialog();
  const { hasAccess: hasDoseSpotAccess } = useDoseSpotAccess();
  const tabs = getPatientPageTabs(membership, { hasDoseSpotAccess });
  const [currentTab, setCurrentTab] = useState<string>(() => {
    return (getTabFromLocation(location, tabs) ?? tabs[0]).id;
  });

  /**
   * Handles a tab change event.
   * @param newTabName - The new tab name.
   */
  const onTabChange = useCallback(
    (newTabName: string | null): void => {
      if (!patient?.id) {
        console.error('Not within a patient context');
        return;
      }
      const tab = newTabName ? tabs.find((t) => t.id === newTabName) : tabs[0];
      if (tab) {
        setCurrentTab(tab.id);
        navigate(formatPatientPageTabUrl(patient.id, tab))?.catch(console.error);
      }
    },
    [navigate, patient?.id, tabs]
  );

  // Rectify the active tab UI with the current URL. This is necessary because the active tab can be changed
  // in ways other than clicking on a tab in the navigation bar.
  useEffect(() => {
    const newTab = getTabFromLocation(location, tabs);
    if (newTab && newTab.id !== currentTab) {
      setCurrentTab(newTab.id);
    }
  }, [currentTab, location, tabs]);

  const handleCloseLabsModal = useCallback(() => {
    setIsLabsModalOpen(false);
  }, []);

  const sections = useMemo(
    () =>
      getDefaultSections(() => setIsLabsModalOpen(true))
        // US-specific demographics not collected in Cameroon (see intake localization).
        .filter((s) => s.key !== 'sexualOrientation' && s.key !== 'smokingStatus')
        .map((s) => (s.key === 'pharmacies' ? createPharmaciesSection(PharmacyDialogComponent) : s)),
    [setIsLabsModalOpen, PharmacyDialogComponent]
  );

  if (outcome && !isOk(outcome)) {
    return (
      <Document>
        <OperationOutcomeAlert outcome={outcome} />
      </Document>
    );
  }

  const patientId = patient?.id;
  if (!patientId) {
    return (
      <Document>
        <Loader />
      </Document>
    );
  }

  return (
    <>
      <div key={getReferenceString(patient)} className={classes.container}>
        <div className={classes.sidebar}>
          <ScrollArea className={classes.scrollArea}>
            <PatientSummary
              patient={patient}
              onClickResource={(resource) =>
                navigate(`/Patient/${patientId}/${resource.resourceType}/${resource.id}`)?.catch(console.error)
              }
              sections={sections}
            />
          </ScrollArea>
        </div>

        <div className={classes.content}>
          <PatientTabsNavigation
            tabs={tabs}
            currentTab={currentTab}
            onTabChange={onTabChange}
            action={
              <Button
                variant="default"
                size="xs"
                leftSection={<IconTimeline size={16} />}
                onClick={timelineHandlers.open}
              >
                Timeline
              </Button>
            }
          />
          <div className={classes.contentBody}>
            <Outlet />
          </div>
        </div>
      </div>
      <Modal opened={isLabsModalOpen} onClose={handleCloseLabsModal} size="md" centered title="New lab order">
        <NewLabOrder patient={patient} onCreated={handleCloseLabsModal} />
      </Modal>
      <Drawer
        opened={timelineOpened}
        onClose={timelineHandlers.close}
        position="right"
        size="xl"
        title={
          <Text size="xl" fw={700}>
            Timeline
          </Text>
        }
        h="100%"
        scrollAreaComponent={ScrollArea.Autosize}
      >
        {/* Remount per patient so the timeline never shows a previous patient's feed. */}
        <PatientTimeline key={patientId} patient={patient} />
      </Drawer>
    </>
  );
}
