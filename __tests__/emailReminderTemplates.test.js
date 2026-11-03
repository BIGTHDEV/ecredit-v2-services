/* eslint-env jest */
const fs = require('fs');
const path = require('path');
const handlebars = require('handlebars');

describe.each(['request-approval', 'request-backward', 'request-draft', 'request-final'])('%s reminder banner', (template) => {
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

  test('keeps reminder styling in a dedicated CSS rule, not an inline span', () => {
    expect(source).toMatch(/\.reminder-banner\s*\{[^}]*color:\s*red;[^}]*font-family:\s*Verdana,\s*sans-serif;[^}]*font-size:\s*20pt;[^}]*font-weight:\s*bolder;/);
    expect(source).not.toContain('font-weight:bolder;font-size:20pt;');
  });
});

describe('Permanent Adjustment email values', () => {
  const completedDate = '2030-12-31';
  const valuesFor = (template, model) => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'templates', `${template}.hbs`), 'utf8');
    const html = handlebars.compile(source)(model);
    return [...html.matchAll(/<td class="label">Permanent Adjustment<\/td>\s*<td class="value">([\s\S]*?)<\/td>/g)]
      .map(([, value]) => value.trim());
  };

  test.each([
    ['request-approval', {
      suggestedCreditDetails: { permanentYes: true, validFrom: completedDate },
      lastActionedStep: { permanentYes: true, validFrom: completedDate },
    }, 2],
    ['request-final', {
      suggestedCreditDetails: { permanentYes: true, validFrom: completedDate },
      finalActionedStep: { permanentYes: true, validFrom: completedDate },
    }, 2],
    ['request-rejected', {
      suggestedCreditDetails: { permanentYes: true, validFrom: completedDate },
      lastActionedStep: { permanentYes: true, validFrom: completedDate },
    }, 2],
  ])('%s shows a checkmark instead of the date', (template, model, expectedRows) => {
    expect(valuesFor(template, model)).toEqual(
      Array(expectedRows).fill('<span class="status-yes">&#10003;</span>'),
    );
  });

  test('request-completed keeps the Permanent Adjustment date', () => {
    expect(valuesFor('request-completed', {
      finalConfirmedDetails: { permanentYes: true, validFrom: completedDate },
    })).toEqual([completedDate]);
  });
});
