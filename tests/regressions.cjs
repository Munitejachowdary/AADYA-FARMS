const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../public/ledger/ledger-core.js');

function fixture() {
  return { customers: [{ id: 'a', name: 'Muni', routeId: 'route1', createdAt: '2026-01-01' }, { id: 'b', name: 'Ravi', routeId: 'route2' }], payments: [], supplyPauses: [], farmers: [], farmerCollections: [], farmerPayments: [],
    entries: [
      { id: 'before', customerId: 'a', date: '2026-08-31', item: 'Milk', quantity: 100, unit: 'L', rate: 80, amount: 8000 },
      { id: 'first', customerId: 'a', date: '2026-09-01', item: 'Milk', quantity: 750, unit: 'ml', rate: 80, amount: 60 },
      { id: 'last', customerId: 'a', date: '2026-09-10', item: 'Milk', quantity: .5, unit: 'L', rate: 90, amount: 45 },
      { id: 'curd', customerId: 'a', date: '2026-09-10', item: 'Curd', quantity: 1, unit: 'pack', rate: 20, amount: 20 },
      { id: 'other', customerId: 'a', date: '2026-09-05', item: 'Other', quantity: 1, unit: 'pack', rate: 50, amount: 50 },
      { id: 'after', customerId: 'a', date: '2026-09-11', item: 'Milk', quantity: 10, unit: 'L', rate: 80, amount: 800 },
      { id: 'different', customerId: 'b', date: '2026-09-01', item: 'Milk', quantity: 20, unit: 'L', rate: 80, amount: 1600 }
    ] };
}

test('adding after an edit ignores a stale hidden id and preserves the edited customer', () => {
  const data = fixture();
  core.saveCustomer(data, { name: 'Muni updated', phone: '919000000000', defaultQty: 1 }, 'a', 'unused', '2026-09-19');
  core.saveCustomer(data, { id: 'a', name: 'Teja', defaultQty: .5 }, null, 'c', '2026-09-19');
  core.saveCustomer(data, { id: 'a', name: 'Sita', defaultQty: 1 }, null, 'd', '2026-09-19');
  assert.deepEqual(data.customers.map(customer => customer.id), ['a', 'b', 'c', 'd']);
  assert.equal(data.customers[0].name, 'Muni updated');
  assert.equal(data.customers[0].createdAt, '2026-01-01');
});

test('payment history filters by customer/month and deleting exactly one payment restores the amount due', () => {
  const data = fixture();
  core.addPayment(data, { customerId: 'a', date: '2026-09-10', amount: 100, notes: 'UPI' }, 'p1');
  core.addPayment(data, { customerId: 'b', date: '2026-09-10', amount: 40, notes: 'Cash' }, 'p2');
  core.addPayment(data, { customerId: 'a', date: '2026-08-31', amount: 900 }, 'p3');
  assert.deepEqual(core.paymentRecords(data, 'a', '2026-09').map(row => row.id), ['p1']);
  const before = core.periodSummary(data, 'a', '2026-09-01', '2026-09-10');
  assert.equal(before.charges, 175); assert.equal(before.due, 75);
  assert.equal(core.removePayment(data, 'p1'), true);
  assert.equal(core.periodSummary(data, 'a', '2026-09-01', '2026-09-10').due, 175);
  assert.deepEqual(data.payments.map(row => row.id), ['p2', 'p3']);
});

test('a later payment can be allocated to and clear the previous month bill', () => {
  const data = fixture();
  core.addPayment(data, { customerId: 'a', date: '2026-10-05', billMonth: '2026-09', amount: 175, notes: 'Paid after month end' }, 'oct-payment');
  assert.equal(data.payments[0].date, '2026-10-05');
  assert.equal(data.payments[0].billMonth, '2026-09');
  assert.deepEqual(core.paymentRecords(data, 'a', '2026-09').map(row => row.id), ['oct-payment']);
  assert.equal(core.paymentRecords(data, 'a', '2026-10').length, 0);
  assert.throws(() => core.setPaymentBillMonth(data, 'oct-payment', 'not-a-month'));
  core.setPaymentBillMonth(data, 'oct-payment', '2026-08');
  assert.deepEqual(core.paymentRecords(data, 'a', '2026-08').map(row => row.id), ['oct-payment']);
  core.setPaymentBillMonth(data, 'oct-payment', '2026-09');
  const september = core.periodSummary(data, 'a', '2026-09-01', '2026-09-30');
  assert.equal(september.payments, 175);
  assert.deepEqual(september.paymentRows.map(row => row.id), ['oct-payment']);
});

test('date boundaries, ml conversion, mixed rates, curd, other and overpayment are represented accurately', () => {
  const data = fixture();
  core.addPayment(data, { customerId: 'a', date: '2026-09-01', amount: 200 }, 'p1');
  core.addPayment(data, { customerId: 'a', date: '2026-09-11', amount: 1000 }, 'excluded');
  const model = core.periodSummary(data, 'a', '2026-09-01', '2026-09-10');
  assert.equal(model.milkLitres, 1.25); assert.deepEqual(model.milkRates, [80, 90]);
  assert.equal(model.milkAmount, 105); assert.equal(model.curdAmount, 20); assert.equal(model.otherAmount, 50);
  assert.equal(model.charges, 175); assert.equal(model.payments, 200); assert.equal(model.due, 0); assert.equal(model.credit, 25);
  assert.deepEqual(model.entries.map(row => row.id), ['first', 'other', 'last', 'curd']);
  assert.throws(() => core.periodSummary(data, 'a', '2026-09-31', '2026-10-10'));
  assert.throws(() => core.periodSummary(data, 'a', '2026-09-10', '2026-09-01'));
});

test('selected customers only, eight per sheet, without duplicating blank slots', () => {
  const data = fixture();
  const subset = core.selectedSummaries(data, ['b'], '2026-09-01', '2026-09-10');
  assert.equal(subset.length, 1); assert.equal(subset[0].customer.id, 'b'); assert.equal(subset[0].charges, 1600);
  const all = Array.from({ length: 10 }, (_, i) => ({ customer: { id: String(i) } }));
  assert.deepEqual(core.sheetGroups(all).map(group => group.length), [8, 2]);
  assert.deepEqual(core.sheetGroups(all.slice(0, 8)).map(group => group.length), [8]);
  assert.deepEqual(core.sheetGroups([]), []);
});

test('invalid payments and customer edits fail without mutating records', () => {
  const data = fixture(); const original = JSON.stringify(data);
  assert.throws(() => core.addPayment(data, { customerId: 'a', date: '2026-09-31', amount: 1 }, 'bad'));
  assert.throws(() => core.addPayment(data, { customerId: 'a', date: '2026-09-01', amount: -2 }, 'bad'));
  assert.throws(() => core.addPayment(data, { customerId: 'missing', date: '2026-09-01', amount: 2 }, 'bad'));
  assert.throws(() => core.saveCustomer(data, { name: 'Changed' }, 'missing', 'x', '2026-09-19'));
  assert.equal(JSON.stringify(data), original);
});

test('daily customer list adds only checked customers and supports multiple extras', () => {
  const data = fixture(); data.entries = [];
  const added = core.addDailyEntries(data, { date: '2026-09-19', rows: [
    { customerId: 'a', selected: true, quantity: 750, unit: 'ml', rate: 80, notes: 'Evening', extras: [
      { item: 'Curd', quantity: 2, unit: 'pack', rate: 20 }, { item: 'Eggs', quantity: 6, unit: 'item', rate: 8 }
    ] },
    { customerId: 'b', selected: false, quantity: 1, unit: 'L', rate: 80, extras: [] }
  ] }, index => `daily-${index}`);
  assert.equal(added.length, 3);
  assert.deepEqual(added.map(row => row.customerId), ['a', 'a', 'a']);
  assert.deepEqual(added.map(row => row.amount), [60, 40, 48]);
  assert.deepEqual(added.map(row => row.item), ['Milk', 'Curd', 'Eggs']);
  assert.equal(added[0].bottleReturned, true);
});

test('routes, no-milk dates and bottle returns update the daily delivery workflow', () => {
  const data = fixture(); data.entries = [];
  const customer = core.saveCustomer(data, { name: 'Muni', routeId: 'route2', defaultQty: 1 }, 'a', 'unused', '2026-09-01');
  assert.equal(customer.routeId, 'route2');
  const pause = core.addSupplyPause(data, { customerId: 'a', startDate: '2026-09-20', endDate: '2026-09-22', notes: 'Travelling' }, 'pause-1', 1);
  assert.equal(core.activeSupplyPause(data, 'a', '2026-09-20').id, pause.id);
  assert.equal(core.activeSupplyPause(data, 'a', '2026-09-22').id, pause.id);
  assert.equal(core.activeSupplyPause(data, 'a', '2026-09-23'), null);
  assert.throws(() => core.addDailyEntries(data, { date: '2026-09-21', rows: [{ customerId: 'a', selected: true, quantity: 1, unit: 'L', rate: 80 }] }));
  assert.equal(data.entries.length, 0);
  assert.equal(core.removeSupplyPause(data, 'pause-1'), true);
  const [entry] = core.addDailyEntries(data, { date: '2026-09-21', rows: [{ customerId: 'a', selected: true, quantity: 1, unit: 'L', rate: 80, bottleReturned: false }] }, () => 'milk-1');
  assert.equal(entry.bottleReturned, false);
  assert.equal(core.markBottleReturned(data, 'milk-1', '2026-09-22'), true);
  assert.equal(entry.bottleReturned, true);
  assert.equal(entry.bottleReturnedAt, '2026-09-22');
});

test('farmer collections track morning/evening litres, weighted quality tests and monthly payable', () => {
  const data = fixture();
  core.saveFarmer(data, { name: 'Lakshmi Farms', phone: '91 90000-00000', village: 'Kondapur', defaultRate: 60 }, null, 'f1', '2026-09-01');
  core.saveFarmer(data, { name: 'Raju', defaultRate: 62 }, null, 'f2', '2026-09-01');
  core.addFarmerCollection(data, { farmerId: 'f1', date: '2026-09-01', session: 'morning', litres: 10, rate: 60, fat: 4, snf: 8.5, water: 2, protein: 3.2 }, 'c1', 1);
  core.addFarmerCollection(data, { farmerId: 'f1', date: '2026-09-01', session: 'evening', litres: 5, rate: 60, fat: 5, snf: 9, water: '', protein: 3.4 }, 'c2', 2);
  core.addFarmerCollection(data, { farmerId: 'f1', date: '2026-10-01', session: 'morning', litres: 100, rate: 60, fat: 9 }, 'outside', 3);
  core.addFarmerCollection(data, { farmerId: 'f2', date: '2026-09-01', session: 'morning', litres: 8, rate: 62, fat: 6 }, 'other', 4);
  core.addFarmerPayment(data, { farmerId: 'f1', date: '2026-09-30', amount: 400, notes: 'Cash' }, 'p1', 5);
  const summary = core.farmerMonthSummary(data, 'f1', '2026-09');
  assert.equal(summary.morningLitres, 10); assert.equal(summary.eveningLitres, 5); assert.equal(summary.totalLitres, 15);
  assert.equal(summary.purchaseAmount, 900); assert.equal(summary.payments, 400); assert.equal(summary.due, 500);
  assert.equal(summary.averageFat, 4.33); assert.equal(summary.averageSnf, 8.67); assert.equal(summary.averageWater, 2); assert.equal(summary.averageProtein, 3.27);
  assert.deepEqual(summary.collections.map(row => row.id), ['c1', 'c2']);
  assert.deepEqual(core.farmerMonthSummaries(data, '2026-09').map(row => row.farmer.id), ['f1', 'f2']);
});

test('invalid farmer records do not mutate data and individual mistakes can be deleted', () => {
  const data = fixture();
  core.saveFarmer(data, { name: 'Raju', defaultRate: 60 }, null, 'f1', '2026-09-01');
  const original = JSON.stringify(data);
  assert.throws(() => core.addFarmerCollection(data, { farmerId: 'f1', date: '2026-09-31', session: 'morning', litres: 2, rate: 60 }, 'bad'));
  assert.throws(() => core.addFarmerCollection(data, { farmerId: 'f1', date: '2026-09-01', session: 'night', litres: 2, rate: 60 }, 'bad'));
  assert.throws(() => core.addFarmerCollection(data, { farmerId: 'f1', date: '2026-09-01', session: 'morning', litres: 0, rate: 60 }, 'bad'));
  assert.throws(() => core.addFarmerCollection(data, { farmerId: 'f1', date: '2026-09-01', session: 'morning', litres: 2, rate: 60, water: 101 }, 'bad'));
  assert.throws(() => core.addFarmerPayment(data, { farmerId: 'missing', date: '2026-09-01', amount: 10 }, 'bad'));
  assert.equal(JSON.stringify(data), original);
  core.addFarmerCollection(data, { farmerId: 'f1', date: '2026-09-01', session: 'morning', litres: 2, rate: 60 }, 'c1');
  core.addFarmerPayment(data, { farmerId: 'f1', date: '2026-09-30', amount: 20 }, 'p1');
  assert.equal(core.removeFarmerCollection(data, 'c1'), true);
  assert.equal(core.removeFarmerPayment(data, 'p1'), true);
  assert.equal(data.farmerCollections.length, 0); assert.equal(data.farmerPayments.length, 0);
});

test('all current accounts are admins and unknown accounts are rejected', async () => {
  const { getRoleForEmail } = await import('../app/api/state/access.js');
  assert.equal(getRoleForEmail('aadyafarms08@gmail.com'), 'admin');
  assert.equal(getRoleForEmail('muniteja@mcsquared.ai'), 'admin');
  assert.equal(getRoleForEmail(' MUNITEJACHOWDARY@GMAIL.COM '), 'admin');
  assert.equal(getRoleForEmail('s.kachavarapu@gmail.com'), 'admin');
  assert.equal(getRoleForEmail('unknown@example.com'), null);
});

test('operator saves may add and edit profiles but cannot delete customer or farmer profiles', async () => {
  const { operatorMutationError } = await import('../app/api/state/access.js');
  const before = { version: 1, settings: { businessName: 'Aadya Farms' }, customers: [{ id: 'c1', name: 'Muni' }], entries: [], payments: [], supplyPauses: [], farmers: [{ id: 'f1', name: 'Raju' }], farmerCollections: [], farmerPayments: [], invoiceNumbers: {}, sampleVisible: false };
  const allowed = structuredClone(before);
  allowed.customers[0].name = 'Muni updated';
  allowed.customers.push({ id: 'c2', name: 'Sita' });
  allowed.farmers.push({ id: 'f2', name: 'Lakshmi' });
  assert.equal(operatorMutationError(before, allowed), null);

  const missingCustomer = structuredClone(allowed);
  missingCustomer.customers = missingCustomer.customers.filter(row => row.id !== 'c1');
  assert.match(operatorMutationError(before, missingCustomer), /cannot delete customer/i);

  const missingFarmer = structuredClone(allowed);
  missingFarmer.farmers = missingFarmer.farmers.filter(row => row.id !== 'f1');
  assert.match(operatorMutationError(before, missingFarmer), /cannot delete farmer/i);
});

test('operator saves allow one incorrect record deletion but block bulk deletion and settings changes', async () => {
  const { operatorMutationError } = await import('../app/api/state/access.js');
  const before = { version: 1, settings: { businessName: 'Aadya Farms', defaultMilkRate: 80 }, customers: [{ id: 'c1' }], entries: [{ id: 'e1' }, { id: 'e2' }], payments: [{ id: 'p1' }], supplyPauses: [], farmers: [{ id: 'f1' }], farmerCollections: [{ id: 'fc1' }], farmerPayments: [{ id: 'fp1' }], invoiceNumbers: {}, sampleVisible: false };

  const oneDeletion = structuredClone(before);
  oneDeletion.entries = oneDeletion.entries.filter(row => row.id !== 'e1');
  assert.equal(operatorMutationError(before, oneDeletion), null);

  const twoDeletions = structuredClone(before);
  twoDeletions.entries = [];
  assert.match(operatorMutationError(before, twoDeletions), /only one individual record/i);

  const settingsChange = structuredClone(before);
  settingsChange.settings.defaultMilkRate = 90;
  assert.match(operatorMutationError(before, settingsChange), /only an admin/i);
});
