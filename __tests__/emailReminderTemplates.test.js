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
      expect(html).toContain('Dear Recipient,');
      expect(html).toContain('REQ-001');
    }
  });

  test('keeps reminder styling in a dedicated CSS rule, not an inline span', () => {
    expect(source).toMatch(/\.reminder-banner\s*\{[^}]*color:\s*red;[^}]*font-family:\s*Verdana,\s*sans-serif;[^}]*font-size:\s*20pt;[^}]*font-weight:\s*bolder;/);
    expect(source).not.toContain('font-weight:bolder;font-size:20pt;');
  });
});
