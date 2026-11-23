(function (root) {
  'use strict';
  const round = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T12:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }
  function validateRange(start, end) {
    if (!validDate(start) || !validDate(end)) throw new Error('Choose valid start and end dates.');
    if (start > end) throw new Error('The end date must be on or after the start date.');
  }
  function saveCustomer(data, values, editingId, newId, createdDate) {
    const name = String(values.name || '').trim();
    if (!name) throw new Error('Enter a customer name.');
    const existing = editingId ? data.customers.find(item => item.id === editingId) : null;
    if (editingId && !existing) throw new Error('This customer no longer exists. Choose New customer.');
    const quantity = Number(values.defaultQty || 0);
    if (!Number.isFinite(quantity) || quantity < 0) throw new Error('Enter a valid milk quantity.');
    const customer = { ...(existing || {}), id: existing ? existing.id : newId, name,
      phone: String(values.phone || '').replace(/[^0-9+]/g, ''), address: String(values.address || '').trim(),
      routeId: values.routeId === 'route2' ? 'route2' : 'route1',
      defaultQty: quantity, defaultUnit: values.defaultUnit === 'ml' ? 'ml' : 'L', createdAt: existing?.createdAt || createdDate };
    if (!existing && data.customers.some(item => item.id === newId)) throw new Error('Please try adding this customer again.');
    if (existing) data.customers[data.customers.indexOf(existing)] = customer;
    else data.customers.push(customer);
    return customer;
  }
  function paymentBillMonth(payment) {
    return validMonth(payment?.billMonth) ? payment.billMonth : String(payment?.date || '').slice(0, 7);
  }
  function paymentRecords(data, customerId = 'all', month = '') {
    return data.payments.filter(payment => (customerId === 'all' || payment.customerId === customerId) && (!month || paymentBillMonth(payment) === month))
      .sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt || 0) - (b.createdAt || 0));
  }
  function addPayment(data, values, id) {
    if (!data.customers.some(customer => customer.id === values.customerId)) throw new Error('Select an existing customer.');
    if (!validDate(values.date)) throw new Error('Enter a valid payment date.');
    const billMonth = String(values.billMonth || values.date.slice(0, 7));
    if (!validMonth(billMonth)) throw new Error('Choose the bill month this payment should clear.');
    const amount = round(values.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter a payment amount greater than zero.');
    const payment = { id, customerId: values.customerId, date: values.date, billMonth, amount, notes: String(values.notes || '').trim(), createdAt: Date.now() };
    data.payments.push(payment);
    return payment;
  }
  function removePayment(data, id) {
    const index = data.payments.findIndex(payment => payment.id === id);
    if (index < 0) return false;
    data.payments.splice(index, 1);
    return true;
  }
  function setPaymentBillMonth(data, id, month) {
    if (!validMonth(month)) throw new Error('Choose a valid bill month.');
    const payment = data.payments.find(row => row.id === id);
    if (!payment) throw new Error('This payment no longer exists.');
    payment.billMonth = month;
    return payment;
  }
  function periodSummary(data, customerId, start, end) {
    validateRange(start, end);
    const customer = data.customers.find(item => item.id === customerId);
    if (!customer) throw new Error('Customer not found.');
    const entries = data.entries.filter(entry => entry.customerId === customerId && entry.date >= start && entry.date <= end).sort((a, b) => a.date.localeCompare(b.date));
    const month = start.slice(0, 7);
    const [year, monthNumber] = month.split('-').map(Number);
    const monthEnd = `${month}-${String(new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()).padStart(2, '0')}`;
    const fullCalendarMonth = start === `${month}-01` && end === monthEnd;
    const paymentRows = data.payments.filter(payment => payment.customerId === customerId && (fullCalendarMonth ? paymentBillMonth(payment) === month : payment.date >= start && payment.date <= end)).sort((a, b) => a.date.localeCompare(b.date));
    const total = rows => round(rows.reduce((sum, row) => sum + Number(row.amount || 0), 0));
    const milk = entries.filter(entry => entry.item.toLowerCase() === 'milk');
    const curd = entries.filter(entry => entry.item.toLowerCase() === 'curd');
    const other = entries.filter(entry => !['milk', 'curd'].includes(entry.item.toLowerCase()));
    const charges = total(entries), payments = total(paymentRows), balance = round(charges - payments);
    const milkLitres = Math.round(milk.reduce((sum, row) => sum + (row.unit === 'ml' ? Number(row.quantity) / 1000 : row.unit === 'L' ? Number(row.quantity) : 0), 0) * 1000) / 1000;
    const milkRates = [...new Set(milk.filter(row => ['L', 'ml'].includes(row.unit)).map(row => Number(row.rate)))].sort((a, b) => a - b);
    return { customer, entries, paymentRows, charges, payments, due: Math.max(0, balance), credit: Math.max(0, -balance), balance,
      milkLitres, milkRates, milkAmount: total(milk), curdAmount: total(curd), otherAmount: total(other), range: { start, end } };
  }
  function selectedSummaries(data, selectedIds, start, end) {
    validateRange(start, end);
    const selected = new Set(selectedIds);
    return data.customers.filter(customer => selected.has(customer.id)).map(customer => periodSummary(data, customer.id, start, end));
  }
  function sheetGroups(models) {
    const groups = [];
    for (let i = 0; i < models.length; i += 8) groups.push(models.slice(i, i + 8));
    return groups;
  }

  function supplyPauseRecords(data, customerId = 'all') {
    const rows = Array.isArray(data.supplyPauses) ? data.supplyPauses : [];
    return rows.filter(row => customerId === 'all' || row.customerId === customerId)
      .sort((a, b) => a.startDate.localeCompare(b.startDate) || (a.createdAt || 0) - (b.createdAt || 0));
  }

  function addSupplyPause(data, values, id, createdAt = Date.now()) {
    if (!data.customers.some(customer => customer.id === values.customerId)) throw new Error('Select an existing customer.');
    validateRange(values.startDate, values.endDate);
    if (!Array.isArray(data.supplyPauses)) data.supplyPauses = [];
    const pause = { id, customerId: values.customerId, startDate: values.startDate, endDate: values.endDate,
      notes: String(values.notes || '').trim(), createdAt };
    data.supplyPauses.push(pause);
    return pause;
  }

  function removeSupplyPause(data, id) {
    if (!Array.isArray(data.supplyPauses)) return false;
    const index = data.supplyPauses.findIndex(row => row.id === id);
    if (index < 0) return false;
    data.supplyPauses.splice(index, 1);
    return true;
  }

  function activeSupplyPause(data, customerId, date) {
    if (!validDate(date)) return null;
    return supplyPauseRecords(data, customerId).find(row => row.startDate <= date && row.endDate >= date) || null;
  }

  function addDailyEntries(data, values, idFactory = () => `entry-${Date.now()}`) {
    if (!validDate(values.date)) throw new Error('Choose a valid delivery date.');
    const customers = new Map(data.customers.map(customer => [customer.id, customer]));
    const pending = [];
    (values.rows || []).filter(row => row.selected).forEach(row => {
      if (!customers.has(row.customerId)) throw new Error('A selected customer no longer exists.');
      if (activeSupplyPause(data, row.customerId, values.date)) throw new Error(`${customers.get(row.customerId).name} is marked as no milk on this date.`);
      const notes = String(row.notes || '').trim();
      const milkQty = Number(row.quantity || 0), milkRate = Number(row.rate || 0);
      if (!Number.isFinite(milkQty) || milkQty < 0 || !Number.isFinite(milkRate) || milkRate < 0) throw new Error('Enter valid milk quantities and rates.');
      if (milkQty > 0) pending.push({ customerId: row.customerId, item: 'Milk', quantity: milkQty, unit: row.unit === 'ml' ? 'ml' : 'L', rate: milkRate,
        bottleReturned: row.bottleReturned !== false, notes });
      (row.extras || []).forEach(extra => {
        const quantity = Number(extra.quantity || 0), rate = Number(extra.rate || 0), item = String(extra.item || '').trim();
        if (!item || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(rate) || rate < 0) throw new Error('Complete each extra item with a name, quantity and valid rate.');
        pending.push({ customerId: row.customerId, item, quantity, unit: String(extra.unit || 'item'), rate, notes });
      });
    });
    if (!pending.length) throw new Error('Tick a customer and enter milk or an extra item.');
    const createdAt = Date.now();
    const entries = pending.map((entry, index) => ({ id: idFactory(index), date: values.date, ...entry,
      amount: round(entry.item.toLowerCase() === 'milk' && entry.unit === 'ml' ? entry.quantity / 1000 * entry.rate : entry.quantity * entry.rate), createdAt: createdAt + index }));
    data.entries.push(...entries);
    return entries;
  }

  function markBottleReturned(data, entryId, returnedAt) {
    const entry = data.entries.find(row => row.id === entryId && String(row.item).toLowerCase() === 'milk');
    if (!entry || entry.bottleReturned !== false) return false;
    entry.bottleReturned = true;
    entry.bottleReturnedAt = returnedAt || new Date().toISOString().slice(0, 10);
    return true;
  }

  function saveFarmer(data, values, editingId, newId, createdDate) {
    const name = String(values.name || '').trim();
    if (!name) throw new Error('Enter a farmer name.');
    const existing = editingId ? data.farmers.find(item => item.id === editingId) : null;
    if (editingId && !existing) throw new Error('This farmer no longer exists. Choose New farmer.');
    const defaultRate = round(values.defaultRate);
    if (!Number.isFinite(defaultRate) || defaultRate < 0) throw new Error('Enter a valid purchase rate.');
    const farmer = { ...(existing || {}), id: existing ? existing.id : newId, name,
      phone: String(values.phone || '').replace(/[^0-9+]/g, ''), village: String(values.village || '').trim(),
      defaultRate, createdAt: existing?.createdAt || createdDate };
    if (!existing && data.farmers.some(item => item.id === newId)) throw new Error('Please try adding this farmer again.');
    if (existing) data.farmers[data.farmers.indexOf(existing)] = farmer;
    else data.farmers.push(farmer);
    return farmer;
  }

  function optionalPercent(value, label) {
    if (value === '' || value === null || typeof value === 'undefined') return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) throw new Error(`${label} must be between 0 and 100.`);
    return round(parsed);
  }

  function addFarmerCollection(data, values, id, createdAt = Date.now()) {
    if (!data.farmers.some(farmer => farmer.id === values.farmerId)) throw new Error('Select an existing farmer.');
    if (!validDate(values.date)) throw new Error('Enter a valid collection date.');
    const session = String(values.session || '').toLowerCase();
    if (!['morning', 'evening'].includes(session)) throw new Error('Choose morning or evening.');
    const litres = Number(values.litres), rate = round(values.rate);
    if (!Number.isFinite(litres) || litres <= 0) throw new Error('Enter litres greater than zero.');
    if (!Number.isFinite(rate) || rate < 0) throw new Error('Enter a valid purchase rate.');
    const cleanLitres = Math.round((litres + Number.EPSILON) * 1000) / 1000;
    const collection = { id, farmerId: values.farmerId, date: values.date, session,
      litres: cleanLitres, rate, amount: round(cleanLitres * rate),
      fat: optionalPercent(values.fat, 'FAT'), snf: optionalPercent(values.snf, 'SNF'),
      water: optionalPercent(values.water, 'Water'), protein: optionalPercent(values.protein, 'Protein'),
      notes: String(values.notes || '').trim(), createdAt };
    data.farmerCollections.push(collection);
    return collection;
  }

  function farmerCollectionRecords(data, farmerId = 'all', month = '') {
    return data.farmerCollections.filter(row => (farmerId === 'all' || row.farmerId === farmerId) && (!month || row.date.startsWith(month)))
      .sort((a, b) => a.date.localeCompare(b.date) || (a.session === b.session ? (a.createdAt || 0) - (b.createdAt || 0) : a.session === 'morning' ? -1 : 1));
  }

  function removeFarmerCollection(data, id) {
    const index = data.farmerCollections.findIndex(row => row.id === id);
    if (index < 0) return false;
    data.farmerCollections.splice(index, 1);
    return true;
  }

  function addFarmerPayment(data, values, id, createdAt = Date.now()) {
    if (!data.farmers.some(farmer => farmer.id === values.farmerId)) throw new Error('Select an existing farmer.');
    if (!validDate(values.date)) throw new Error('Enter a valid payment date.');
    const amount = round(values.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter a payment amount greater than zero.');
    const payment = { id, farmerId: values.farmerId, date: values.date, amount,
      notes: String(values.notes || '').trim(), createdAt };
    data.farmerPayments.push(payment);
    return payment;
  }

  function farmerPaymentRecords(data, farmerId = 'all', month = '') {
    return data.farmerPayments.filter(row => (farmerId === 'all' || row.farmerId === farmerId) && (!month || row.date.startsWith(month)))
      .sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt || 0) - (b.createdAt || 0));
  }

  function removeFarmerPayment(data, id) {
    const index = data.farmerPayments.findIndex(row => row.id === id);
    if (index < 0) return false;
    data.farmerPayments.splice(index, 1);
    return true;
  }

  function validMonth(value) { return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value || '')); }

  function farmerMonthSummary(data, farmerId, month) {
    if (!validMonth(month)) throw new Error('Choose a valid month.');
    const farmer = data.farmers.find(item => item.id === farmerId);
    if (!farmer) throw new Error('Farmer not found.');
    const collections = farmerCollectionRecords(data, farmerId, month);
    const paymentRows = farmerPaymentRecords(data, farmerId, month);
    const litres = rows => Math.round((rows.reduce((sum, row) => sum + Number(row.litres || 0), 0) + Number.EPSILON) * 1000) / 1000;
    const weighted = field => {
      const tested = collections.filter(row => row[field] !== null && row[field] !== '' && typeof row[field] !== 'undefined' && Number.isFinite(Number(row[field])));
      const weight = tested.reduce((sum, row) => sum + Number(row.litres || 0), 0);
      return weight > 0 ? round(tested.reduce((sum, row) => sum + Number(row[field]) * Number(row.litres || 0), 0) / weight) : null;
    };
    const purchaseAmount = round(collections.reduce((sum, row) => sum + Number(row.amount || 0), 0));
    const payments = round(paymentRows.reduce((sum, row) => sum + Number(row.amount || 0), 0));
    const balance = round(purchaseAmount - payments);
    return { farmer, month, collections, paymentRows, morningLitres: litres(collections.filter(row => row.session === 'morning')),
      eveningLitres: litres(collections.filter(row => row.session === 'evening')), totalLitres: litres(collections),
      averageFat: weighted('fat'), averageSnf: weighted('snf'), averageWater: weighted('water'), averageProtein: weighted('protein'),
      purchaseAmount, payments, balance, due: Math.max(0, balance), credit: Math.max(0, -balance) };
  }

  function farmerMonthSummaries(data, month) {
    if (!validMonth(month)) throw new Error('Choose a valid month.');
    return data.farmers.map(farmer => farmerMonthSummary(data, farmer.id, month));
  }

  const api = { round, validDate, validateRange, saveCustomer, paymentBillMonth, paymentRecords, addPayment, removePayment, setPaymentBillMonth, periodSummary, selectedSummaries, sheetGroups,
    supplyPauseRecords, addSupplyPause, removeSupplyPause, activeSupplyPause, addDailyEntries, markBottleReturned,
    saveFarmer, addFarmerCollection, farmerCollectionRecords, removeFarmerCollection, addFarmerPayment, farmerPaymentRecords, removeFarmerPayment, farmerMonthSummary, farmerMonthSummaries };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AadyaCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
