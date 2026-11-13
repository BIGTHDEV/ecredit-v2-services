/* eslint-env jest */
const fs = require('fs');
const path = require('path');
const handlebars = require('handlebars');

describe.each(['request-approval', 'request-backward', 'request-draft', 'request-final', 'request-temporary'])('%s reminder banner', (template) => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'templates', `${template}.hbs`), 'utf8');
  const render = handlebars.compile(source);

  test('renders the reminder banner only when explicitly enabled', () => {
    for (const isReminder of [undefined, false, true]) {
      const html = render({ dear: 'Recipient', requestNo: 'REQ-001', isReminder });
      expect(html.includes('<p class="reminder-banner">Reminder!!</p>')).toBe(isReminder === true);
      expect((html.match(/Reminder!!/g) || []).length).toBe(isReminder === true ? 1 : 0);
      expect(html).toContain(template === 'request-draft' ? 'Dear Credit Team,' : 'Dear Recipient,');
      expect(html).toContain('REQ-001');
    }
  });

  if (template === 'request-temporary') {
    test('renders intended recipient details only in the non-production testing footer', () => {
      const html = render({
        showEmailDebugInfo: true,
        emailDebugInfo: {
          subject: '[DEV e-Credit] - Credit adjustment expiry reminder',
          to: ['requester@example.com'],
          cc: ['super@example.com'],
        },
      });
      expect(html).toContain('Show for testing only.');
      expect(html).toContain('requester@example.com');
      expect(html).toContain('super@example.com');
      expect(render({ showEmailDebugInfo: false })).not.toContain('Show for testing only.');
    });
  }

  test('keeps reminder styling in a dedicated CSS rule, not an inline span', () => {
    expect(source).toMatch(/\.reminder-banner\s*\{[^}]*color:\s*red;[^}]*font-family:\s*Verdana,\s*sans-serif;[^}]*font-size:\s*20pt;[^}]*font-weight:\s*bolder;/);
    expect(source).not.toContain('font-weight:bolder;font-size:20pt;');
  });
});

test('keeps Final and Rejected email subtitles in their brand headers', () => {
  const sourceFor = (template) => fs.readFileSync(path.join(__dirname, '..', 'templates', `${template}.hbs`), 'utf8');
  const finalHeader = sourceFor('request-final').match(/<tr class="brand-header">([\s\S]*?)<\/tr>/)?.[1];
  const rejectedHeader = sourceFor('request-rejected').match(/<tr class="brand-header">([\s\S]*?)<\/tr>/)?.[1];

  expect(finalHeader).toContain('<p class="brand-subtitle">Credit request summary and final approval details</p>');
  expect(finalHeader).not.toContain('finalConfirmedDetails.permanentYes');
  expect(rejectedHeader).toContain('<p class="brand-subtitle">Credit request summary and rejection details</p>');
});

describe('Permanent Adjustment email values', () => {
  const completedDate = '2030-12-31';
  const permanentAdjustmentRow = (template, model) => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'templates', `${template}.hbs`), 'utf8');
    const html = handlebars.compile(source)(model);
    return html.match(/<td>Permanent Adjustment<\/td>([\s\S]*?)<\/tr>/)?.[1] || '';
  };

  test.each([
    ['request-final', {
      creditTeamRecommendation: { permanentYes: true },
      finalApprovalChanges: { permanentYes: false },
      finalActionedStep: { permanentYes: true },
    }],
    ['request-rejected', {
      creditTeamRecommendation: { permanentYes: true },
      approvalChanges: { permanentYes: false },
      lastActionedStep: { permanentYes: true },
    }],
  ])('%s shows checkmarks in the comparison instead of dates', (template, model) => {
    expect(permanentAdjustmentRow(template, model).match(/<span class="status-yes">&#10003;<\/span>/g)).toHaveLength(2);
  });

  test('request-completed keeps the Permanent Adjustment date', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'templates', 'request-completed.hbs'), 'utf8');
    const html = handlebars.compile(source)({
      finalConfirmedDetails: { permanentYes: true, validFrom: completedDate },
    });
    expect(html).toContain(`<td class="value">${completedDate}</td>`);
  });

  test('request-temporary shows Effective and Expiry dates for enabled adjustment types', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'templates', 'request-temporary.hbs'), 'utf8');
    const html = handlebars.compile(source)({
      finalConfirmedDetails: {
        temporaryYes: true, permanentYes: true, validFrom: '01 Sep 2026', validTo: '31 Dec 2026',
      },
    });
    expect(html).toContain('<td class="label">Temporary Effective Date</td>');
    expect(html).toContain('<td class="label">Temporary Expiry Date</td>');
    expect(html).toContain('<td class="label">Permanent Effective Date</td>');
    expect(html).toContain('<td class="label">Permanent Expiry Date</td>');
    expect(html).toContain('31 Dec 2026');
    expect(html).not.toContain('Completed');
  });
});
