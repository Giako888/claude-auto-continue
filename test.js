const assert = require('assert');
const { parseResetTime } = require('./parser');
const ref = new Date('2026-10-03T10:00:00Z');
let t = parseResetTime('5-hour limit reached ∙ resets 3pm (Europe/Rome)', ref);
assert.strictEqual(t.toISOString(), '2026-10-03T13:00:00.000Z');
t = parseResetTime('5-hour limit reached ∙ resets 10:30am (Europe/Rome)', ref); // 08:30Z già passato -> domani
assert.strictEqual(t.toISOString(), '2026-10-04T08:30:00.000Z');
t = parseResetTime('Claude usage limit reached. Your limit will reset at 3pm (Europe/Rome).', ref);
assert.strictEqual(t.toISOString(), '2026-10-03T13:00:00.000Z');
t = parseResetTime('Claude AI usage limit reached|1790000000', ref);
assert.strictEqual(t.getTime(), 1790000000000);
t = parseResetTime('limit reached ∙ resets Oct 5, 9am (Europe/Rome)', ref);
assert.strictEqual(t.toISOString(), '2026-10-05T07:00:00.000Z');
assert.strictEqual(parseResetTime('ciao a tutti', ref), null);
console.log('ok');
