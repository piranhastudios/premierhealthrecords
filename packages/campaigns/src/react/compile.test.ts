// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
// mjml-browser compiles against the DOM, so this suite needs a browser env.
// @vitest-environment jsdom
import type { BrandKit } from '../fhir/template';
import { brandSwatches } from '../fhir/template';
import type { TemplateDesign } from './compile';
import { compileDesign, compileDesignBody, designToMjml, parseDesign } from './compile';

const brand: BrandKit = {
  primaryColor: '#f47b20',
  palette: ['#c8102e', '#fdb913'],
  senderName: 'Premier Health',
  footerText: 'Douala, Cameroon',
};

describe('brandSwatches', () => {
  test('primary first, then palette, de-duplicated', () => {
    expect(brandSwatches(brand)).toEqual(['#f47b20', '#c8102e', '#fdb913']);
    expect(brandSwatches({ primaryColor: '#f47b20', palette: ['#f47b20'] })).toEqual(['#f47b20']);
    expect(brandSwatches({})).toEqual([]);
  });
});

describe('compileDesign colors', () => {
  test('button falls back to the brand primary and honours an override', () => {
    const design: TemplateDesign = {
      blocks: [
        { id: 'b1', type: 'button', text: 'Default', href: 'https://a' },
        { id: 'b2', type: 'button', text: 'Override', href: 'https://b', color: '#c8102e' },
      ],
    };
    const html = compileDesign(design, brand);
    expect(html).toContain('#f47b20');
    expect(html).toContain('#c8102e');
  });

  test('heading, text and divider carry their block color', () => {
    const design: TemplateDesign = {
      blocks: [
        { id: 'h', type: 'heading', text: 'Hi', color: '#fdb913' },
        { id: 't', type: 'text', text: 'Body', color: '#c8102e' },
        { id: 'd', type: 'divider', color: '#123456' },
      ],
    };
    const html = compileDesign(design, brand);
    expect(html).toContain('#fdb913');
    expect(html).toContain('#c8102e');
    expect(html).toContain('#123456');
  });

  test('the locked footer is always present even with no blocks', () => {
    const html = compileDesign({ blocks: [] }, brand);
    expect(html).toContain('Unsubscribe');
    // The reserved merge field survives compilation for per-recipient substitution.
    expect(html).toContain('{{unsubscribe}}');
    expect(html).toContain('Premier Health');
  });

  test('merge-field placeholders survive compilation', () => {
    const html = compileDesign({ blocks: [{ id: 'h', type: 'heading', text: 'Hi {{patient.name.given.first()}}' }] }, brand);
    expect(html).toContain('{{patient.name.given.first()}}');
  });
});

describe('backgrounds', () => {
  test('defaults apply, and overrides reach the output', () => {
    expect(compileDesign({ blocks: [] }, brand)).toContain('#f5f2ee');
    const custom = compileDesign(
      { blocks: [], backgroundColor: '#101010', contentBackgroundColor: '#202020' },
      brand
    );
    expect(custom).toContain('#101010');
    expect(custom).toContain('#202020');
  });
});

describe('grid block', () => {
  test('renders one column per cell, capped at the column count', () => {
    const html = compileDesign(
      {
        blocks: [
          {
            id: 'g',
            type: 'grid',
            columns: 3,
            cells: [{ text: 'One' }, { text: 'Two' }, { text: 'Three' }, { text: 'Ignored' }],
          },
        ],
      },
      brand
    );
    expect(html).toContain('One');
    expect(html).toContain('Two');
    expect(html).toContain('Three');
    expect(html).not.toContain('Ignored');
  });

  test('a grid does not break the content card: every section stays inside one wrapper', () => {
    const mjml = designToMjml(
      {
        blocks: [
          { id: 'h', type: 'heading', text: 'Heading' },
          { id: 'g', type: 'grid', columns: 3, cells: [{ text: 'C1' }, { text: 'C2' }, { text: 'C3' }] },
          { id: 't', type: 'text', text: 'After the grid' },
        ],
        contentBackgroundColor: '#ffffff',
      },
      brand
    );

    // Exactly one wrapper carries the card background, and it is never closed
    // early — this is the regression: previously the grid emitted its own
    // background-less sections, dropping everything after it off the card.
    expect((mjml.match(/<mj-wrapper/g) ?? []).length).toBe(1);
    expect((mjml.match(/<\/mj-wrapper>/g) ?? []).length).toBe(1);

    const wrapper = mjml.slice(mjml.indexOf('<mj-wrapper'), mjml.indexOf('</mj-wrapper>'));
    // Heading, grid cells, trailing text and the footer all live in the wrapper.
    for (const content of ['Heading', 'C1', 'C3', 'After the grid', 'Unsubscribe']) {
      expect(wrapper).toContain(content);
    }
    // Sections themselves must not re-declare a background (the wrapper owns it).
    expect(wrapper).not.toContain('<mj-section background-color');
    // Balanced tags.
    expect((wrapper.match(/<mj-section/g) ?? []).length).toBe((wrapper.match(/<\/mj-section>/g) ?? []).length);
    expect((wrapper.match(/<mj-column/g) ?? []).length).toBe((wrapper.match(/<\/mj-column>/g) ?? []).length);
  });

  test('the compiled HTML keeps post-grid content on the card background', () => {
    const html = compileDesign(
      {
        blocks: [
          { id: 'g', type: 'grid', columns: 2, cells: [{ text: 'C1' }, { text: 'C2' }] },
          { id: 't', type: 'text', text: 'After the grid' },
        ],
        contentBackgroundColor: '#abcdef',
      },
      brand
    );
    const marker = html.indexOf('After the grid');
    expect(marker).toBeGreaterThan(-1);
    // The card background is declared before the trailing content renders.
    expect(html.slice(0, marker)).toContain('#abcdef');
  });

  test('cells can carry an image', () => {
    const html = compileDesign(
      {
        blocks: [
          { id: 'g', type: 'grid', columns: 2, cells: [{ imageSrc: 'https://img/a.png', text: 'A' }, { text: 'B' }] },
        ],
      },
      brand
    );
    expect(html).toContain('https://img/a.png');
  });

  test('cells support linked images, buttons and card styling', () => {
    const html = compileDesign(
      {
        blocks: [
          {
            id: 'g',
            type: 'grid',
            columns: 2,
            cells: [
              {
                imageSrc: 'https://img/a.png',
                imageHref: 'https://clinic/a',
                heading: 'Dental care',
                text: 'Book a check-up',
                buttonText: 'Book',
                buttonHref: 'https://clinic/book',
                card: true,
                backgroundColor: '#eeeeee',
              },
              { heading: 'Plain cell' },
            ],
          },
        ],
      },
      brand
    );
    // Linked image: the src appears inside an anchor to the image link.
    expect(html).toContain('https://img/a.png');
    expect(html).toContain('https://clinic/a');
    // Button with its own link.
    expect(html).toContain('https://clinic/book');
    expect(html).toContain('Book');
    // Card styling on the cell.
    expect(html).toContain('#eeeeee');
    expect(html).toContain('Dental care');
    expect(html).toContain('Plain cell');
  });

  test('a button needs both a label and a link to render', () => {
    const html = compileDesign(
      {
        blocks: [
          { id: 'g', type: 'grid', columns: 2, cells: [{ buttonText: 'No link' }, { buttonHref: 'https://x' }] },
        ],
      },
      brand
    );
    expect(html).not.toContain('No link');
    expect(html).not.toContain('https://x');
  });
});

describe('standalone image block', () => {
  test('can be linked', () => {
    const html = compileDesign(
      { blocks: [{ id: 'i', type: 'image', src: 'https://img/hero.png', href: 'https://clinic/offer' }] },
      brand
    );
    expect(html).toContain('https://img/hero.png');
    expect(html).toContain('https://clinic/offer');
  });
});

describe('parseDesign round-trip', () => {
  test('preserves mode, html and backgrounds — dropping mode reverted saved HTML templates to visual', () => {
    const stored: TemplateDesign = {
      mode: 'html',
      blocks: [{ id: 'h', type: 'heading', text: 'Kept' }],
      html: '<p>Hand written</p>',
      backgroundColor: '#111111',
      contentBackgroundColor: '#222222',
    };
    expect(parseDesign(JSON.stringify(stored))).toEqual(stored);
  });

  test('defaults to an empty visual design when absent or corrupt', () => {
    expect(parseDesign(undefined)).toEqual({ blocks: [] });
    expect(parseDesign('not json')).toEqual({ blocks: [] });
    expect(parseDesign(JSON.stringify({ blocks: [] })).mode).toBe('visual');
  });
});

describe('custom HTML block inside a visual template', () => {
  test('passes markup through untouched, alongside normal blocks', () => {
    const html = compileDesign(
      {
        blocks: [
          { id: 'h', type: 'heading', text: 'Heading' },
          { id: 'c', type: 'html', html: '<div class="promo" data-x="1">Custom &amp; raw</div>' },
          { id: 't', type: 'text', text: 'After' },
        ],
      },
      brand
    );
    expect(html).toContain('class="promo"');
    expect(html).toContain('data-x="1"');
    // Not HTML-escaped the way block text is.
    expect(html).not.toContain('&lt;div class="promo"');
    expect(html).toContain('Heading');
    expect(html).toContain('After');
  });
});

describe('switching visual -> HTML is lossless', () => {
  test('compileDesignBody keeps the content but omits the footer, so it is not duplicated', () => {
    const design: TemplateDesign = {
      blocks: [
        { id: 'h', type: 'heading', text: 'Keep me' },
        { id: 'g', type: 'grid', columns: 2, cells: [{ text: 'C1' }, { text: 'C2' }] },
      ],
    };
    const body = compileDesignBody(design, brand);
    expect(body).toContain('Keep me');
    expect(body).toContain('C1');
    expect(body).not.toContain('Unsubscribe');

    // Seeding the HTML editor with that body then compiling in html mode yields
    // exactly one footer.
    const final = compileDesign({ mode: 'html', blocks: design.blocks, html: body }, brand);
    expect(final).toContain('Keep me');
    expect((final.match(/Unsubscribe/g) ?? []).length).toBe(1);
  });
});

describe('html authoring mode', () => {
  test('uses the hand-written body and still appends the locked footer', () => {
    const html = compileDesign(
      { mode: 'html', blocks: [], html: '<h1>Hand written</h1>', backgroundColor: '#123456' },
      brand
    );
    expect(html).toContain('<h1>Hand written</h1>');
    expect(html).toContain('Unsubscribe');
    expect(html).toContain('{{unsubscribe}}');
    expect(html).toContain('Premier Health');
    // No MJML wrapper in this mode.
    expect(html).not.toContain('<mjml');
  });
});
