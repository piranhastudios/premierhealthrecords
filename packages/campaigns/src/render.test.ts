// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { Patient } from '@medplum/fhirtypes';
import { extractMergeFields, parseMergeField, renderMergeFields } from './render';

const patient: Patient = {
  resourceType: 'Patient',
  id: 'p1',
  name: [{ given: ['Ada'], family: 'Portal' }],
};

describe('render', () => {
  test('extractMergeFields finds distinct fields', () => {
    const html = '<p>Hi {{patient.name.given.first()}}, see you at {{ resource.start }}. {{patient.name.given.first()}}</p>';
    expect(extractMergeFields(html)).toEqual(['patient.name.given.first()', 'resource.start']);
  });

  test('parseMergeField splits root and path', () => {
    expect(parseMergeField('patient.name.family')).toEqual({ root: 'patient', path: 'name.family' });
    expect(parseMergeField('unknown.thing')).toBeUndefined();
  });

  test('renderMergeFields substitutes values and blanks unresolvable fields', () => {
    const out = renderMergeFields('Hello {{patient.name.given.first()}} {{patient.name.family}}{{resource.start}}!', {
      patient,
    });
    expect(out).toBe('Hello Ada Portal!');
  });
});
