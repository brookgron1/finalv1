function doGet(e) {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Nha Trang Escape Room • Booking')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ===== CRYPT-TIC booking config =====
const SPREADSHEET_ID = '1vHuPgM4QSc78tTHD_iXLn8Yr7Nom0DhnhfakDph7TCs';
const BOOKINGS_SHEET_NAME = 'Bookings';

const SLOT_MINUTES = 60;
const BUFFER_MINUTES = 15; // 15 minute gap between bookings
const LEAD_MINUTES = 15;   // same-day minimum notice (minutes)
const TZ = 'Asia/Ho_Chi_Minh';

// Optional: sync APPROVED bookings to Google Calendar
const SYNC_TO_CALENDAR = true; // set false if you don't want calendar events
const CALENDAR_ID = 'primary'; // or a specific calendar id


// Pricing rules
const PRICE_ARRIVAL_PER_PERSON = 400000; // cash at door
const PRICE_VIETQR_PREPAID_PER_PERSON = 350000; // VietQR prepay
const DEPOSIT_ONLY_AMOUNT_VND = 350000; // deposit-only option (holds slot)
const MIN_CHARGE_PLAYERS = 4;

// Card payments (PayPal) — last resort
const PAYPAL_ME_URL = 'https://paypal.me/NhatrangEscapeRoom';

// Contact links
const CONTACT_LINKS = {
  tel: 'tel:+84393690550',
  sms: 'sms:+84393690550',
  whatsapp: 'https://wa.me/84393690550',
  zalo: 'https://zalo.me/0393690550',
  kakao: 'http://dn.kakao.com',
  facebook: 'https://www.facebook.com/share/1Ag46D1hyd/',
  maps: ''
};
const CARD_DEPOSIT_USD = 16; // deposit only
const CARD_PREPAID_PER_PERSON_USD = 16; // per person if prepaid by card

const OPEN_HOUR = 11;
const CLOSE_HOUR = 23;

function getBookingsSheet_(){
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sh = ss.getSheetByName(BOOKINGS_SHEET_NAME);
  if (!sh) sh = ss.insertSheet(BOOKINGS_SHEET_NAME);

  if (sh.getLastRow() === 0){
    sh.appendRow([
      'CreatedAt',
      'BookingId',
      'StartISO',
      'Date',
      'Time',
      'Players',
      'Name',
      'Phone',
      'Email',
      'Note',
      'Lang',
      'Status',
      'EventId'
    ]);
  }
  // ensure EventId column exists (for calendar sync)
  const headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(String);
  if (headers.indexOf('EventId') === -1){
    sh.getRange(1, sh.getLastColumn()+1).setValue('EventId');
  }

  return sh;
}

function parseStart_(dateStr, timeStr){
  // Interpret date/time as Vietnam time.
  return new Date(`${dateStr}T${timeStr}:00+07:00`);
}

function normalizeTime_(timeStr){
  const m = String(timeStr || '').match(/^(\d{2}):(\d{2})$/);
  if (!m) throw new Error('Bad time');
  return `${m[1]}:${m[2]}`;
}

function assertWithinHours_(timeStr){
  const [hh, mm] = timeStr.split(':').map(Number);
  if (mm !== 0) throw new Error('Only full hours allowed');
  if (hh < OPEN_HOUR || hh > CLOSE_HOUR) throw new Error('Outside booking hours');
}

function generateId_(){
  return 'VN-' + Utilities.getUuid().slice(0,8).toUpperCase();
}

function isSameDayVN_(dateStr){
  const todayVN = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  return String(dateStr) === todayVN;
}

function slotTaken_(start){
  // Only APPROVED blocks.
  const sh = getBookingsSheet_();
  const last = sh.getLastRow();
  if (last <= 1) return false;

  const values = sh.getRange(2, 1, last - 1, 13).getValues();
  const windowMs = (SLOT_MINUTES + BUFFER_MINUTES) * 60 * 1000;
  const startMs = start.getTime();

  for (let i = 0; i < values.length; i++){
    const row = values[i];
    const status = String(row[11] || '').toUpperCase();
    if (status !== 'APPROVED') continue;

    const iso = row[2];
    if (!iso) continue;
    const existing = new Date(iso);
    if (isNaN(existing.getTime())) continue;

    const diff = Math.abs(existing.getTime() - startMs);
    if (diff < windowMs) return true;
  }
  return false;
}

function computePricing_(optionValue){
  if (String(optionValue) === 'deposit'){
    return {
      mode: 'deposit',
      playersSelected: 0,
      chargedPlayers: 0,
      vietqrPrepaidVnd: DEPOSIT_ONLY_AMOUNT_VND,
      arrivalVnd: PRICE_ARRIVAL_PER_PERSON * MIN_CHARGE_PLAYERS,
      cardDepositUsd: CARD_DEPOSIT_USD,
      cardPrepaidUsd: CARD_PREPAID_PER_PERSON_USD * MIN_CHARGE_PLAYERS
    };
  }

  const playersSelected = Math.max(0, parseInt(optionValue, 10) || 0);
  const chargedPlayers = Math.max(playersSelected, MIN_CHARGE_PLAYERS);

  return {
    mode: 'players',
    playersSelected,
    chargedPlayers,
    vietqrPrepaidVnd: PRICE_VIETQR_PREPAID_PER_PERSON * chargedPlayers,
    arrivalVnd: PRICE_ARRIVAL_PER_PERSON * chargedPlayers,
    cardDepositUsd: CARD_DEPOSIT_USD,
    cardPrepaidUsd: CARD_PREPAID_PER_PERSON_USD * chargedPlayers
  };
}

// Client calls this to render prices & PayPal link
function apiGetConfig(){
  return {
    ok: true,
    priceArrival: PRICE_ARRIVAL_PER_PERSON,
    priceVietqrPrepaid: PRICE_VIETQR_PREPAID_PER_PERSON,
    depositOnly: DEPOSIT_ONLY_AMOUNT_VND,
    minChargePlayers: MIN_CHARGE_PLAYERS,
    openHour: OPEN_HOUR,
    closeHour: CLOSE_HOUR,
    slotMinutes: SLOT_MINUTES,
    bufferMinutes: BUFFER_MINUTES,
    leadMinutes: LEAD_MINUTES,
    paypalUrl: PAYPAL_ME_URL,
    links: CONTACT_LINKS,
    cardDepositUsd: CARD_DEPOSIT_USD,
    cardPrepaidPerPersonUsd: CARD_PREPAID_PER_PERSON_USD
  };
}

/**
 * Return availability for a given date.
 */
function apiGetAvailability(dateStr){
  const times = [];
  const sameDay = isSameDayVN_(dateStr);

  for (let h = OPEN_HOUR; h <= CLOSE_HOUR; h++){
    const hh = ('0' + h).slice(-2);
    const time = `${hh}:00`;
    const start = parseStart_(dateStr, time);

    // Same-day rule only
    let isTooSoon = false;
    if (sameDay){
      const now = new Date();
      const minStartMs = now.getTime() + (LEAD_MINUTES * 60 * 1000);
      isTooSoon = (start.getTime() <= minStartMs);
    }

    const available = !isTooSoon && !slotTaken_(start);
    times.push({ time, available });
  }

  return { ok:true, date:dateStr, times, bufferMinutes: BUFFER_MINUTES, leadMinutes: LEAD_MINUTES };
}

/**
 * Booking request endpoint.
 * payload: {date,time,option,name,phone,email,note,lang}
 */
function apiRequestBooking(payload){
  const date = String(payload.date || '');
  const time = normalizeTime_(payload.time);
  assertWithinHours_(time);

  const option = String(payload.option || '');
  const pricing = computePricing_(option);

  const name = String(payload.name || '').trim();
  const phone = String(payload.phone || '').trim();
  const email = String(payload.email || '').trim();
  const note = String(payload.note || '').trim();
  const lang = String(payload.lang || 'en');

  if (!date || !time || !option || !name || !phone){
    return { ok:false, error:'MISSING_FIELDS' };
  }

  const start = parseStart_(date, time);
  if (isNaN(start.getTime())) return { ok:false, error:'BAD_DATETIME' };

  if (isSameDayVN_(date)){
    const now = new Date();
    const minStartMs = now.getTime() + (LEAD_MINUTES * 60 * 1000);
    if (start.getTime() <= minStartMs){
      return { ok:false, error:'TOO_SOON', leadMinutes: LEAD_MINUTES };
    }
  }

  if (slotTaken_(start)){
    return { ok:false, error:'SLOT_TAKEN', bufferMinutes: BUFFER_MINUTES };
  }

  const bookingId = generateId_();
  const sh = getBookingsSheet_();
  const createdAt = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss');
  const startISO = Utilities.formatDate(start, TZ, "yyyy-MM-dd'T'HH:mm:ssXXX");

  const playersCell = (pricing.mode === 'deposit') ? 'DEPOSIT' : pricing.playersSelected;

  const pricingNote =
    `Option=${option}; ` +
    `ChargedPlayers=${pricing.mode === 'deposit' ? 0 : pricing.chargedPlayers}; ` +
    `VietQR_Prepaid_VND=${pricing.vietqrPrepaidVnd}; ` +
    `Arrival_VND=${pricing.arrivalVnd}; ` +
    `Card_Deposit_USD=${pricing.cardDepositUsd}; ` +
    `Card_Prepaid_USD=${pricing.cardPrepaidUsd}`;

  const finalNote = note ? `${note}\n${pricingNote}` : pricingNote;

  sh.appendRow([
    createdAt,
    bookingId,
    startISO,
    date,
    time,
    playersCell,
    name,
    phone,
    email,
    finalNote,
    lang,
    'PENDING',
    ''
  ]);

  return { ok:true, bookingId, status:'PENDING', pricing };
}


/**
 * Calendar sync (optional)
 * How approval works:
 * - You approve a booking by setting Status = APPROVED in the Bookings sheet.
 * - Only APPROVED bookings block the schedule (availability hides them).
 *
 * To sync to Google Calendar:
 * - Apps Script → Triggers → Add Trigger
 * - Choose function: onEdit
 * - Event source: From spreadsheet
 * - Event type: On edit
 */
function onEdit(e){
  try{
    if (!SYNC_TO_CALENDAR) return;
    const range = e && e.range;
    if (!range) return;
    const sh = range.getSheet();
    if (sh.getName() !== BOOKINGS_SHEET_NAME) return;

    // Status column is 12 (L)
    if (range.getRow() < 2) return;
    if (range.getColumn() !== 12) return;

    const status = String(range.getValue() || '').toUpperCase();
    if (status !== 'APPROVED') return;

    syncRowToCalendar_(sh, range.getRow());
  }catch(err){
    // ignore
  }
}

function syncRowToCalendar_(sh, row){
  if (!SYNC_TO_CALENDAR) return;
  const rowVals = sh.getRange(row, 1, 1, 13).getValues()[0];
  const bookingId = rowVals[1];
  const startISO = rowVals[2];
  const people = rowVals[5];
  const name = rowVals[6];
  const phone = rowVals[7];
  const email = rowVals[8];
  const note = rowVals[9];
  const status = String(rowVals[11] || '').toUpperCase();
  const eventId = rowVals[12];

  if (status !== 'APPROVED') return;
  if (!startISO) return;

  const cal = CalendarApp.getCalendarById(CALENDAR_ID);
  if (!cal) return;

  if (eventId){
    const existing = cal.getEventById(eventId);
    if (existing) return;
  }

  const start = new Date(startISO);
  const end = new Date(start.getTime() + SLOT_MINUTES * 60 * 1000);

  const title = `Nha Trang Escape Room — Booking (${people}p)`;
  const desc = [
    `BookingId: ${bookingId}`,
    `Name: ${name}`,
    `Phone: ${phone}`,
    email ? `Email: ${email}` : '',
    note ? `Note: ${note}` : '',
    `Buffer: ${BUFFER_MINUTES} min (handled in availability)`
  ].filter(Boolean).join('\n');

  const ev = cal.createEvent(title, start, end, { description: desc });
  sh.getRange(row, 13).setValue(ev.getId());
}

/** Run manually to sync any APPROVED rows missing EventId. */
function syncAllApprovedToCalendar(){
  if (!SYNC_TO_CALENDAR) return {ok:false, error:'SYNC_DISABLED'};
  const sh = getBookingsSheet_();
  const last = sh.getLastRow();
  if (last <= 1) return {ok:true, synced:0};
  const values = sh.getRange(2, 1, last-1, 13).getValues();
  let synced = 0;
  for (let i=0;i<values.length;i++){
    const status = String(values[i][11] || '').toUpperCase();
    const eventId = values[i][12];
    if (status === 'APPROVED' && !eventId){
      syncRowToCalendar_(sh, i+2);
      synced++;
    }
  }
  return {ok:true, synced};
}
