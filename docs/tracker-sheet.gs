/**
 * Distribution tracker: receives rows from Growth (src/lib/tracker/sheet-sync.ts)
 * and upserts them into the first sheet of this spreadsheet.
 *
 * Setup (once):
 *   1. Extensions → Apps Script. Replace the code with this file. Save.
 *   2. Project Settings → Script properties → add SECRET = a long random string.
 *   3. Deploy → New deployment → type "Web app". Execute as: Me.
 *      Who has access: Anyone. Deploy, authorize, copy the web app URL.
 *   4. Put the URL and the secret in Growth's prod env as TRACKER_WEBHOOK_URL
 *      and TRACKER_WEBHOOK_SECRET.
 *
 * Rows are matched on Email + Product. Growth owns the facts (emails sent,
 * last reply, date). For Status and Next step, Growth writes its value into
 * "Growth status" / "Growth next step" too, and only replaces your Status or
 * Next step while it still equals what Growth last wrote. Once you change
 * one by hand (Call booked, Paying, ...), Growth leaves it alone. Rows you add
 * yourself (no Email, or another product) are never touched.
 */

var HEADERS = [
  'Name', 'Company', 'Product', 'Type', 'Source', 'Connected?', 'Headline $', 'Status', 'Next step', 'Date',
  'Email', 'Emails sent', 'Reply type', 'Last reply', 'Growth status', 'Growth next step',
];
// Growth always overwrites these.
var FACTS = ['Emails sent', 'Reply type', 'Last reply'];
// Growth fills these only when empty, so your corrections stick.
var FILL_ONLY = ['Name', 'Company', 'Product', 'Type', 'Source', 'Email'];

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    var body = JSON.parse(e.postData.contents);
    var secret = PropertiesService.getScriptProperties().getProperty('SECRET');
    if (!secret || body.secret !== secret) return reply({ ok: false, error: 'bad secret' });
    lock.waitLock(30000);
    return reply(upsert(body.rows || []));
  } catch (err) {
    return reply({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function upsert(rows) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  if (header.join('') === '') header = [];
  HEADERS.forEach(function (h) { if (header.indexOf(h) < 0) header.push(h); });
  sheet.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
  sheet.setFrozenRows(1);
  var col = {};
  header.forEach(function (h, i) { col[h] = i; });

  var n = sheet.getLastRow() - 1;
  var data = n > 0 ? sheet.getRange(2, 1, n, header.length).getValues() : [];
  var index = {};
  data.forEach(function (r, i) {
    var email = String(r[col['Email']]).trim().toLowerCase();
    if (email) index[email + '|' + r[col['Product']]] = i;
  });

  var updated = 0, appended = 0;
  rows.forEach(function (row) {
    var key = String(row['Email']).toLowerCase() + '|' + row['Product'];
    var i = index[key];
    if (i === undefined) {
      var fresh = header.map(function (h) { return row[h] !== undefined ? row[h] : ''; });
      fresh[col['Growth status']] = row['Status'];
      fresh[col['Growth next step']] = row['Next step'];
      index[key] = data.push(fresh) - 1;
      appended++;
      return;
    }
    var r = data[i];
    var before = r.join('\u0001');
    FILL_ONLY.forEach(function (h) { if (r[col[h]] === '') r[col[h]] = row[h]; });
    FACTS.forEach(function (h) { r[col[h]] = row[h]; });
    var statusIsGrowths = r[col['Status']] === '' || r[col['Status']] === r[col['Growth status']];
    if (statusIsGrowths) {
      r[col['Status']] = row['Status'];
      r[col['Date']] = row['Date'];
    }
    if (r[col['Next step']] === '' || r[col['Next step']] === r[col['Growth next step']]) r[col['Next step']] = row['Next step'];
    r[col['Growth status']] = row['Status'];
    r[col['Growth next step']] = row['Next step'];
    if (r.join('\u0001') !== before) updated++;
  });

  if (data.length) {
    // Dates as text, so the sheet doesn't reinterpret them in its own locale.
    sheet.getRange(2, col['Date'] + 1, data.length, 1).setNumberFormat('@');
    sheet.getRange(2, 1, data.length, header.length).setValues(data);
  }
  return { ok: true, updated: updated, appended: appended };
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
