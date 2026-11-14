(() => {
  'use strict';

  const STORAGE_KEY = 'aadya-ledger-v1';
  const Core = globalThis.AadyaCore || (typeof require === 'function' ? require('./ledger-core.js') : null);
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const uid = (prefix = 'id') => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const localISO = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const todayISO = () => localISO(new Date());
  const currentMonth = () => todayISO().slice(0, 7);
  const money = value => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(value || 0));
  const number = value => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 }).format(Number(value || 0));
  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  const parseDate = iso => new Date(`${iso}T00:00:00`);
  const dateLabel = iso => parseDate(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  const monthLabel = ym => new Date(`${ym}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  const monthRange = ym => {
    const [year, month] = ym.split('-').map(Number);
    const end = new Date(year, month, 0).getDate();
    return { start: `${ym}-01`, end: `${ym}-${String(end).padStart(2, '0')}` };
  };
  const defaultState = () => ({
    version: 1,
    settings: {
      businessName: 'Aadya Farms',
      phone: '',
      address: '',
      upiId: '',
      logo: 'assets/aadya-logo.png',
      paymentQr: '',
      defaultMilkRate: 80,
      invoicePrefix: 'AF',
      route1Name: 'Route 1',
      route1Partner: '',
      route2Name: 'Route 2',
      route2Partner: '',
      messageTemplate: 'Hi {name}, your {business} bill for {month} is {amount}. Invoice: {invoice}. Please find the PDF attached. Thank you.'
    },
    customers: [],
    entries: [],
    payments: [],
    supplyPauses: [],
    farmers: [],
    farmerCollections: [],
    farmerPayments: [],
    invoiceNumbers: {},
    sampleVisible: false
  });

  const hasDOM = typeof document !== 'undefined';
  let state = hasDOM ? loadState() : defaultState();
  let activeView = 'dashboard';
  let editingCustomerId = null;
  let editingFarmerId = null;
  let invoiceMode = 'detailed';
  let selectedBillCustomers = new Set();
  let toastTimer;
  let cloudRevision = 0;
  let cloudSaveTimer;
  let cloudSaving = false;
  let lastLocalChange = 0;
  let cloudStatus = 'Connecting to online ledger…';

  function loadState() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (stored && stored.settings && Array.isArray(stored.customers)) return { ...defaultState(), ...stored, settings: { ...defaultState().settings, ...stored.settings } };
    } catch (error) { console.warn('Could not load saved data', error); }
    return defaultState();
  }

  function saveState() {
    if (!hasDOM) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    lastLocalChange = Date.now();
    cloudStatus = 'Saving online…';
    updateConnection();
    clearTimeout(cloudSaveTimer);
    cloudSaveTimer = setTimeout(pushOnlineState, 250);
  }

  async function pushOnlineState() {
    if (cloudSaving || !navigator.onLine) return;
    cloudSaving = true;
    try {
      const response = await fetch('/api/state', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ state }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Online save failed');
      cloudRevision = Number(result.revision || cloudRevision);
      cloudStatus = 'Saved online · shared';
    } catch (error) {
      console.warn(error); cloudStatus = navigator.onLine ? 'Online save pending' : 'Offline · local copy safe';
    } finally { cloudSaving = false; updateConnection(); }
  }

  async function pullOnlineState({ initial = false } = {}) {
    if (!navigator.onLine || cloudSaving || (!initial && Date.now() - lastLocalChange < 2000)) return;
    try {
      const response = await fetch('/api/state', { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Online ledger unavailable');
      if (result.state && Number(result.revision || 0) > cloudRevision) {
        state = { ...defaultState(), ...result.state, settings: { ...defaultState().settings, ...result.state.settings } };
        cloudRevision = Number(result.revision || 0);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        if (!initial) { renderAll(); toast('Updated with changes from another device.'); }
      } else if (!result.state && initial && localStorage.getItem(STORAGE_KEY)) {
        await pushOnlineState();
      }
      cloudStatus = 'Saved online · shared';
    } catch (error) {
      console.warn(error); cloudStatus = navigator.onLine ? 'Could not reach online ledger' : 'Offline · local copy safe';
    }
    updateConnection();
  }

  function toast(message) {
    const el = $('#toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  function customerById(id) { return state.customers.find(customer => customer.id === id); }
  function customerName(id) { return customerById(id)?.name || 'Unknown customer'; }
  function customerRouteId(customer) { return customer?.routeId === 'route2' ? 'route2' : 'route1'; }
  function routeDetails(routeId) {
    const id = routeId === 'route2' ? 'route2' : 'route1';
    const number = id === 'route2' ? '2' : '1';
    return { id, name: String(state.settings[`route${number}Name`] || `Route ${number}`).trim() || `Route ${number}`,
      partner: String(state.settings[`route${number}Partner`] || '').trim() };
  }
  function routeLabel(routeId) {
    const route = routeDetails(routeId);
    return route.partner ? `${route.name} · ${route.partner}` : route.name;
  }
  function pendingBottleEntries(customerId = 'all') {
    return state.entries.filter(entry => String(entry.item).toLowerCase() === 'milk' && entry.bottleReturned === false && (customerId === 'all' || entry.customerId === customerId))
      .sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt || 0) - (b.createdAt || 0));
  }
  function farmerById(id) { return state.farmers.find(farmer => farmer.id === id); }
  function farmerName(id) { return farmerById(id)?.name || 'Unknown farmer'; }
  function entriesFor(customerId, month) { return state.entries.filter(entry => entry.customerId === customerId && entry.date.startsWith(month)).sort((a, b) => a.date.localeCompare(b.date)); }
  function paymentsFor(customerId, month) { return state.payments.filter(payment => payment.customerId === customerId && payment.date.startsWith(month)); }
  function totalsFor(customerId, month) {
    const entries = entriesFor(customerId, month);
    const charges = entries.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
    const payments = paymentsFor(customerId, month).reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    const milkLitres = entries.filter(entry => entry.item === 'Milk').reduce((sum, entry) => sum + (entry.unit === 'ml' ? Number(entry.quantity) / 1000 : entry.unit === 'L' ? Number(entry.quantity) : 0), 0);
    return { charges, payments, due: Math.max(0, charges - payments), milkLitres, entries };
  }

  function calculateAmount(item, quantity, unit, rate) {
    const qty = Number(quantity || 0);
    const price = Number(rate || 0);
    if (item === 'Milk' && unit === 'ml') return (qty / 1000) * price;
    return qty * price;
  }

  function getBulkDates(startDate, endDate, schedule, specificDays = '') {
    if (!startDate || !endDate || endDate < startDate) return [];
    const wanted = new Set(String(specificDays).split(/[^0-9]+/).filter(Boolean).map(Number));
    const dates = [];
    let index = 0;
    for (let cursor = parseDate(startDate); cursor <= parseDate(endDate); cursor.setDate(cursor.getDate() + 1), index += 1) {
      const iso = localISO(cursor);
      if (schedule === 'alternate' && index % 2 !== 0) continue;
      if (schedule === 'specific' && !wanted.has(cursor.getDate())) continue;
      dates.push(iso);
    }
    return dates;
  }

  function addBulkEntries(form) {
    const data = new FormData(form);
    const values = Object.fromEntries(data.entries());
    const matchingDates = getBulkDates(values.startDate, values.endDate, values.schedule, values.specificDays);
    if (!matchingDates.length) return toast('No dates match that selection.');
    const dates = matchingDates.filter(date => !Core.activeSupplyPause(state, values.customerId, date));
    const pausedDays = matchingDates.length - dates.length;
    if (!dates.length) return toast('Every matching date is inside this customer’s no-milk period.');
    const amount = calculateAmount(values.item, values.quantity, values.unit, values.rate);
    const newEntries = dates.map(date => ({
      id: uid('entry'), customerId: values.customerId, date, item: values.item,
      quantity: Number(values.quantity), unit: values.unit, rate: Number(values.rate), amount,
      notes: values.notes?.trim() || '', createdAt: Date.now()
    }));
    state.entries.push(...newEntries);
    saveState();
    renderAll();
    toast(`${newEntries.length} ${newEntries.length === 1 ? 'entry' : 'entries'} added${pausedDays ? ` · ${pausedDays} no-milk ${pausedDays === 1 ? 'day' : 'days'} skipped` : ''}.`);
  }

  function seedFormDates() {
    const first = `${currentMonth()}-01`;
    const today = todayISO();
    $('#dashboardMonth').value ||= currentMonth();
    $$('form:not(#supplyPauseForm) input[name="startDate"]').forEach(input => { if (!input.value) input.value = first; });
    $$('form:not(#supplyPauseForm) input[name="endDate"]').forEach(input => { if (!input.value) input.value = today; });
    const paymentDate = $('#paymentForm [name="date"]');
    if (paymentDate && !paymentDate.value) paymentDate.value = today;
    const farmerCollectionDate = $('#farmerCollectionForm [name="date"]');
    if (farmerCollectionDate && !farmerCollectionDate.value) farmerCollectionDate.value = today;
    const farmerPaymentDate = $('#farmerPaymentForm [name="date"]');
    if (farmerPaymentDate && !farmerPaymentDate.value) farmerPaymentDate.value = today;
    const dailyDate = $('#dailyEntryDate');
    if (dailyDate && !dailyDate.value) dailyDate.value = today;
    const pauseStart = $('#supplyPauseForm [name="startDate"]');
    const pauseEnd = $('#supplyPauseForm [name="endDate"]');
    if (pauseStart && !pauseStart.value) pauseStart.value = today;
    if (pauseEnd && !pauseEnd.value) pauseEnd.value = today;
    $('#ledgerMonth').value ||= currentMonth();
    $('#invoiceMonth').value ||= currentMonth();
    $('#farmerSummaryMonth').value ||= currentMonth();
    $('#farmerCollectionMonth').value ||= currentMonth();
    $('#farmerPaymentMonth').value ||= currentMonth();
    $('#billStartDate').value ||= first;
    $('#billEndDate').value ||= monthRange(currentMonth()).end;
    $('#billDate').value ||= today;
  }

  function setView(view) {
    activeView = view;
    $$('.view').forEach(section => section.classList.toggle('active', section.dataset.page === view));
    $$('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.view === view));
    if (view === 'invoices') { renderInvoiceArea(); renderBatchBills(); }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function renderRouteSelects() {
    $$('[data-route-select]').forEach(select => {
      const selected = select.value;
      const allOption = select.dataset.allowAll === 'true' ? '<option value="all">All routes</option>' : '';
      select.innerHTML = `${allOption}<option value="route1">${escapeHtml(routeLabel('route1'))}</option><option value="route2">${escapeHtml(routeLabel('route2'))}</option>`;
      if ([...select.options].some(option => option.value === selected)) select.value = selected;
      else if (select.dataset.allowAll === 'true') select.value = 'all';
    });
  }

  function renderCustomerSelects() {
    $$('[data-customer-select]').forEach(select => {
      const selected = select.value;
      let search = select.previousElementSibling;
      if (!search?.matches('[data-customer-picker-search]')) {
        search = document.createElement('input');
        search.type = 'search'; search.placeholder = 'Search customer…'; search.className = 'customer-picker-search'; search.dataset.customerPickerSearch = '';
        select.before(search);
        search.addEventListener('input', renderCustomerSelects);
      }
      const query = search.value.trim().toLowerCase();
      const options = state.customers.filter(customer => `${customer.name} ${customer.phone || ''}`.toLowerCase().includes(query))
        .map(customer => `<option value="${escapeHtml(customer.id)}">${escapeHtml(customer.name)}</option>`).join('');
      const allOption = select.id === 'ledgerCustomer' ? '<option value="all">All customers</option>' : '';
      select.innerHTML = allOption + options;
      if ([...select.options].some(option => option.value === selected)) select.value = selected;
    });
  }

  function renderFarmerSelects() {
    $$('[data-farmer-select]').forEach(select => {
      const selected = select.value;
      const searchable = select.dataset.allowAll !== 'true';
      let search = searchable ? select.previousElementSibling : null;
      if (searchable && !search?.matches('[data-farmer-picker-search]')) {
        search = document.createElement('input');
        search.type = 'search'; search.placeholder = 'Search farmer…'; search.className = 'customer-picker-search'; search.dataset.farmerPickerSearch = '';
        select.before(search);
        search.addEventListener('input', renderFarmerSelects);
      }
      const query = search?.value.trim().toLowerCase() || '';
      const options = state.farmers.filter(farmer => `${farmer.name} ${farmer.phone || ''} ${farmer.village || ''}`.toLowerCase().includes(query))
        .map(farmer => `<option value="${escapeHtml(farmer.id)}">${escapeHtml(farmer.name)}</option>`).join('');
      const allOption = select.dataset.allowAll === 'true' ? '<option value="all">All farmers</option>' : '';
      const emptyOption = !state.farmers.length && select.dataset.allowAll !== 'true' ? '<option value="">Add a farmer first</option>' : '';
      select.innerHTML = allOption + emptyOption + options;
      if ([...select.options].some(option => option.value === selected)) select.value = selected;
    });
  }

  function extraRowHtml() {
    return `<div class="daily-extra-row"><select name="extraItem"><option>Curd</option><option>Eggs</option><option>Other</option></select><input name="extraQty" type="number" min="0.01" step="0.01" value="1" aria-label="Extra quantity"><select name="extraUnit" aria-label="Extra unit"><option value="item">item</option><option value="pack">pack</option><option value="L">L</option><option value="ml">ml</option></select><input name="extraRate" type="number" min="0" step="0.01" placeholder="Rate ₹" aria-label="Extra rate"><button class="icon-btn danger" type="button" data-action="remove-daily-extra" aria-label="Remove extra item">×</button></div>`;
  }

  function renderDailyCustomers() {
    const list = $('#dailyCustomerRows'); if (!list) return;
    const query = ($('#dailyCustomerSearch')?.value || '').trim().toLowerCase();
    const routeFilter = $('#dailyRouteFilter')?.value || 'all';
    const date = $('#dailyEntryDate')?.value || todayISO();
    const customers = state.customers
      .filter(customer => (routeFilter === 'all' || customerRouteId(customer) === routeFilter) && `${customer.name} ${customer.phone || ''} ${customer.address || ''}`.toLowerCase().includes(query))
      .sort((a, b) => customerRouteId(a).localeCompare(customerRouteId(b)) || a.name.localeCompare(b.name));
    const selectedRoute = routeFilter === 'all' ? null : routeDetails(routeFilter);
    $('#dailyRoutePartner').textContent = selectedRoute ? (selectedRoute.partner ? `Delivery partner: ${selectedRoute.partner}` : `${selectedRoute.name} · Add the delivery partner name in Settings.`) : 'Showing both routes. Choose one route to prepare a partner’s delivery list.';
    list.innerHTML = customers.length ? customers.map(customer => {
      const route = routeDetails(customerRouteId(customer));
      const pause = Core.activeSupplyPause(state, customer.id, date);
      const disabled = pause ? ' disabled' : '';
      const pauseText = pause ? `<div class="daily-pause-note"><strong>No milk</strong> · ${escapeHtml(dateLabel(pause.startDate))} to ${escapeHtml(dateLabel(pause.endDate))}${pause.notes ? ` · ${escapeHtml(pause.notes)}` : ''}</div>` : '';
      return `<article class="daily-customer-row${pause ? ' is-paused' : ''}" data-daily-row="${escapeHtml(customer.id)}"><div class="daily-customer-head"><label class="daily-check"><input type="checkbox" name="selected"${disabled}> <strong>${escapeHtml(customer.name)}</strong></label><div class="daily-row-actions"><span class="route-chip">${escapeHtml(route.name)}</span><button class="text-btn" type="button" data-action="add-daily-extra"${disabled}>+ Extra item</button></div></div>${pauseText}<div class="daily-fields"><label>Milk<input name="quantity" type="number" min="0" step="0.05" value="${Number(customer.defaultQty || 0)}"${disabled}></label><label>Unit<select name="unit"${disabled}><option value="L"${customer.defaultUnit !== 'ml' ? ' selected' : ''}>L</option><option value="ml"${customer.defaultUnit === 'ml' ? ' selected' : ''}>ml</option></select></label><label>Rate ₹<input name="rate" type="number" min="0" step="0.01" value="${Number(state.settings.defaultMilkRate || 0)}"${disabled}></label><label class="bottle-return-field"><span>Bottle returned</span><input name="bottleReturned" type="checkbox" checked${disabled}></label><label>Note<input name="notes" placeholder="Optional"${disabled}></label></div><div class="daily-extras"></div></article>`;
    }).join('') : '<div class="empty">No customers match this route and search.</div>';
    updateDailyStatus();
  }

  function updateDailyStatus() {
    const checked = $$('#dailyCustomerRows [name="selected"]:checked').length;
    const paused = $$('#dailyCustomerRows .daily-customer-row.is-paused').length;
    if ($('#dailyEntryStatus')) $('#dailyEntryStatus').textContent = checked ? `${checked} customer${checked === 1 ? '' : 's'} selected${paused ? ` · ${paused} paused for this date` : ''}.` : `${paused ? `${paused} customer${paused === 1 ? ' is' : 's are'} paused · ` : ''}Tick only customers who received something. Bottle returned is selected by default.`;
  }

  function submitDailyList(form) {
    const rows = $$('#dailyCustomerRows [data-daily-row]').map(row => ({
      customerId: row.dataset.dailyRow, selected: row.querySelector('[name="selected"]').checked,
      quantity: row.querySelector('[name="quantity"]').value, unit: row.querySelector('[name="unit"]').value,
      rate: row.querySelector('[name="rate"]').value, bottleReturned: row.querySelector('[name="bottleReturned"]').checked, notes: row.querySelector('[name="notes"]').value,
      extras: [...row.querySelectorAll('.daily-extra-row')].map(extra => ({ item: extra.querySelector('[name="extraItem"]').value, quantity: extra.querySelector('[name="extraQty"]').value, unit: extra.querySelector('[name="extraUnit"]').value, rate: extra.querySelector('[name="extraRate"]').value }))
    }));
    try {
      const entries = Core.addDailyEntries(state, { date: form.elements.date.value, rows }, index => uid(`entry${index}`));
      saveState(); renderAll(); renderDailyCustomers(); toast(`${entries.length} record${entries.length === 1 ? '' : 's'} added.`);
    } catch (error) { toast(error.message); }
  }

  function renderDashboard() {
    const month = $('#dashboardMonth')?.value || currentMonth();
    const entries = state.entries.filter(entry => entry.date.startsWith(month));
    const payments = state.payments.filter(payment => payment.date.startsWith(month));
    const due = entries.reduce((sum, entry) => sum + Number(entry.amount), 0) - payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
    const milk = entries.filter(entry => entry.item === 'Milk').reduce((sum, entry) => sum + (entry.unit === 'ml' ? Number(entry.quantity) / 1000 : entry.unit === 'L' ? Number(entry.quantity) : 0), 0);
    const activeCustomers = new Set(entries.map(entry => entry.customerId)).size;
    $('#metricDue').textContent = money(Math.max(0, due));
    $('#metricMilk').textContent = `${number(milk)} L`;
    $('#metricCustomers').textContent = activeCustomers;
    $('#metricPayments').textContent = money(payments.reduce((sum, payment) => sum + Number(payment.amount), 0));
    $('#metricMonth').textContent = monthLabel(month);
    $$('[data-dashboard-period]').forEach(element => { element.textContent = monthLabel(month); });
    $('#metricCustomersPeriod').textContent = `With entries in ${monthLabel(month)}`;
    $('#dashboardEntriesTitle').textContent = `Entries for ${monthLabel(month)}`;
    const pendingBottles = pendingBottleEntries();
    const pendingCustomers = new Set(pendingBottles.map(entry => entry.customerId)).size;
    $('#dashboardPendingBottles').textContent = `${pendingBottles.length} bottle${pendingBottles.length === 1 ? '' : 's'} pending`;
    $('#dashboardBottleHelp').textContent = pendingBottles.length ? `From ${pendingCustomers} customer${pendingCustomers === 1 ? '' : 's'} · tap to update returns.` : 'All tracked bottles have been returned.';
    $('#bottleSummary').classList.toggle('all-clear', !pendingBottles.length);
    const hour = new Date().getHours();
    $('#dashboardGreeting').textContent = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    $('#sampleBanner').hidden = !state.sampleVisible;
    const latest = [...entries].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt).slice(0, 7);
    $('#recentEntries').innerHTML = latest.length ? latest.map(entry => { const d = parseDate(entry.date); return `<div class="activity-row"><div class="activity-date">${String(d.getDate()).padStart(2, '0')}<br>${escapeHtml(d.toLocaleDateString('en-IN', { month: 'short' }))}</div><div><strong>${escapeHtml(customerName(entry.customerId))}</strong><small>${escapeHtml(entry.item)} · ${number(entry.quantity)} ${escapeHtml(entry.unit)}${entry.notes ? ` · ${escapeHtml(entry.notes)}` : ''}</small></div><span class="amount">${money(entry.amount)}</span></div>`; }).join('') : `<div class="empty">No deliveries recorded for ${escapeHtml(monthLabel(month))}.</div>`;
  }

  function renderCustomers(filter = '', routeFilter = $('#customerRouteFilter')?.value || 'all') {
    const query = filter.trim().toLowerCase();
    const customers = state.customers.filter(customer => (routeFilter === 'all' || customerRouteId(customer) === routeFilter) && `${customer.name} ${customer.phone || ''} ${customer.address || ''}`.toLowerCase().includes(query));
    $('#customerCountHeading').textContent = customers.length === state.customers.length ? `${state.customers.length} ${state.customers.length === 1 ? 'customer' : 'customers'}` : `${customers.length} of ${state.customers.length} customers`;
    $('#customerList').innerHTML = customers.length ? customers.map(customer => {
      const totals = totalsFor(customer.id, currentMonth());
      const route = routeDetails(customerRouteId(customer));
      const pause = Core.activeSupplyPause(state, customer.id, todayISO());
      const pending = pendingBottleEntries(customer.id).length;
      return `<article class="customer-row"><div><div class="customer-title-line"><h4>${escapeHtml(customer.name)}</h4><span class="route-chip">${escapeHtml(route.name)}</span>${pause ? '<span class="pause-chip">No milk today</span>' : ''}</div><p>${escapeHtml(customer.phone || 'No WhatsApp number')}${customer.address ? ` · ${escapeHtml(customer.address)}` : ''}${route.partner ? ` · ${escapeHtml(route.partner)}` : ''}</p><div class="customer-stats"><span>This month<b>${number(totals.milkLitres)} L</b></span><span>Amount due<b>${money(totals.due)}</b></span><span>Bottles pending<b>${pending}</b></span></div></div><div class="row-actions">${customer.phone ? `<button class="icon-btn whatsapp-action" data-whatsapp-customer="${customer.id}" aria-label="Open WhatsApp for ${escapeHtml(customer.name)}">WhatsApp</button>` : ''}<button class="icon-btn" data-edit-customer="${customer.id}" aria-label="Edit ${escapeHtml(customer.name)}">Edit</button><button class="icon-btn" data-invoice-customer="${customer.id}" aria-label="Invoice for ${escapeHtml(customer.name)}">Bill</button><button class="icon-btn danger" data-delete-customer="${customer.id}" aria-label="Delete ${escapeHtml(customer.name)}">Delete</button></div></article>`;
    }).join('') : '<div class="empty">No customers match your search.</div>';
  }

  function renderSupplyPauses() {
    const rows = Core.supplyPauseRecords(state);
    $('#supplyPauseRows').innerHTML = rows.length ? rows.map(pause => {
      const customer = customerById(pause.customerId);
      const route = routeDetails(customerRouteId(customer));
      return `<tr><td><strong>${escapeHtml(customer?.name || 'Unknown customer')}</strong></td><td>${escapeHtml(dateLabel(pause.startDate))}<br><small>through ${escapeHtml(dateLabel(pause.endDate))}</small></td><td>${escapeHtml(route.name)}${route.partner ? `<br><small>${escapeHtml(route.partner)}</small>` : ''}</td><td>${escapeHtml(pause.notes || '—')}</td><td><div class="row-actions">${customer?.phone ? `<button class="icon-btn whatsapp-action" type="button" data-whatsapp-pause="${escapeHtml(pause.id)}">WhatsApp</button>` : ''}<button class="icon-btn danger" type="button" data-delete-pause="${escapeHtml(pause.id)}">Delete</button></div></td></tr>`;
    }).join('') : '<tr><td colspan="5"><div class="empty">No no-milk dates saved.</div></td></tr>';
  }

  function addSupplyPause(form) {
    const values = Object.fromEntries(new FormData(form).entries());
    try {
      Core.addSupplyPause(state, values, uid('pause'));
      saveState();
      form.elements.namedItem('notes').value = '';
      renderAll();
      toast('No-milk dates saved. Daily route lists updated.');
    } catch (error) { toast(error.message); }
  }

  async function deleteSupplyPause(id) {
    const pause = (state.supplyPauses || []).find(row => row.id === id);
    if (!pause) return;
    if (!await showConfirm('Delete no-milk dates?', `Remove the stop from ${dateLabel(pause.startDate)} to ${dateLabel(pause.endDate)} for ${customerName(pause.customerId)}?`)) return;
    Core.removeSupplyPause(state, id); saveState(); renderAll(); toast('No-milk dates deleted.');
  }

  function confirmPauseOnWhatsApp(id) {
    const pause = (state.supplyPauses || []).find(row => row.id === id);
    if (!pause) return;
    const customer = customerById(pause.customerId);
    openWhatsApp(customer?.phone, `Hi ${customer?.name || ''}, we have stopped your milk delivery from ${dateLabel(pause.startDate)} through ${dateLabel(pause.endDate)} as requested. Delivery will resume after this period. Thank you — ${state.settings.businessName}.`);
  }

  function percent(value) { return value === null || value === '' || typeof value === 'undefined' ? '—' : `${number(value)}%`; }

  function renderFarmers(filter = '') {
    const query = filter.trim().toLowerCase();
    const farmers = state.farmers.filter(farmer => `${farmer.name} ${farmer.phone || ''} ${farmer.village || ''}`.toLowerCase().includes(query));
    const month = $('#farmerSummaryMonth')?.value || currentMonth();
    $('#farmerCountHeading').textContent = `${state.farmers.length} ${state.farmers.length === 1 ? 'farmer' : 'farmers'}`;
    $('#farmerList').innerHTML = farmers.length ? farmers.map(farmer => {
      const totals = Core.farmerMonthSummary(state, farmer.id, month);
      return `<article class="customer-row"><div><h4>${escapeHtml(farmer.name)}</h4><p>${escapeHtml(farmer.phone || 'No phone')}${farmer.village ? ` · ${escapeHtml(farmer.village)}` : ''} · ${money(farmer.defaultRate)}/L</p><div class="customer-stats"><span>${escapeHtml(monthLabel(month))}<b>${number(totals.totalLitres)} L</b></span><span>Payable<b>${money(totals.due)}</b></span></div></div><div class="row-actions"><button class="icon-btn" type="button" data-edit-farmer="${escapeHtml(farmer.id)}" aria-label="Edit ${escapeHtml(farmer.name)}">Edit</button><button class="icon-btn danger" type="button" data-delete-farmer="${escapeHtml(farmer.id)}" aria-label="Delete ${escapeHtml(farmer.name)}">Delete</button></div></article>`;
    }).join('') : `<div class="empty">${state.farmers.length ? 'No farmers match your search.' : 'Add your first milk provider to start recording collections.'}</div>`;
  }

  function renderFarmerSummary() {
    const month = $('#farmerSummaryMonth').value || currentMonth();
    const summaries = Core.farmerMonthSummaries(state, month);
    const litres = summaries.reduce((sum, row) => sum + row.totalLitres, 0);
    const purchases = Core.round(summaries.reduce((sum, row) => sum + row.purchaseAmount, 0));
    const paid = Core.round(summaries.reduce((sum, row) => sum + row.payments, 0));
    const due = Core.round(summaries.reduce((sum, row) => sum + row.due, 0));
    $('#farmerMetricLitres').textContent = `${number(litres)} L`;
    $('#farmerMetricPurchase').textContent = money(purchases);
    $('#farmerMetricPaid').textContent = money(paid);
    $('#farmerMetricDue').textContent = money(due);
    $('#farmerMetricMonth').textContent = monthLabel(month);
    $('#farmerSummaryRows').innerHTML = summaries.length ? summaries.map(row => `<tr><td>${escapeHtml(row.farmer.name)}</td><td>${number(row.morningLitres)} L</td><td>${number(row.eveningLitres)} L</td><td><strong>${number(row.totalLitres)} L</strong></td><td>${percent(row.averageFat)}</td><td>${percent(row.averageSnf)}</td><td>${percent(row.averageWater)}</td><td>${percent(row.averageProtein)}</td><td>${money(row.purchaseAmount)}</td><td>${money(row.payments)}</td><td>${money(row.due)}${row.credit ? `<small> · ${money(row.credit)} credit</small>` : ''}</td></tr>`).join('') : '<tr><td colspan="11"><div class="empty">Add farmers to see the monthly payable summary.</div></td></tr>';
  }

  function collectionTests(row) {
    const values = [['FAT', row.fat], ['SNF', row.snf], ['Water', row.water], ['Protein', row.protein]].filter(([, value]) => value !== null && value !== '' && typeof value !== 'undefined');
    return values.length ? values.map(([label, value]) => `<b>${label}</b> ${number(value)}%`).join(' · ') : 'Not tested';
  }

  function renderFarmerCollections() {
    const farmerId = $('#farmerCollectionFilter').value || 'all';
    const month = $('#farmerCollectionMonth').value || currentMonth();
    const rows = [...Core.farmerCollectionRecords(state, farmerId, month)].reverse();
    $('#farmerCollectionHeading').textContent = `${rows.length} collection${rows.length === 1 ? '' : 's'} · ${monthLabel(month)}`;
    $('#farmerCollectionRows').innerHTML = rows.length ? rows.map(row => `<tr><td>${escapeHtml(dateLabel(row.date))}</td><td><strong>${escapeHtml(farmerName(row.farmerId))}</strong>${row.notes ? `<br><small>${escapeHtml(row.notes)}</small>` : ''}</td><td><span class="session-chip ${row.session === 'evening' ? 'evening' : ''}">${escapeHtml(row.session)}</span></td><td><strong>${number(row.litres)} L</strong></td><td>${money(row.rate)}/L</td><td><span class="farmer-tests">${collectionTests(row)}</span></td><td><strong>${money(row.amount)}</strong></td><td><button class="icon-btn danger" type="button" data-delete-farmer-collection="${escapeHtml(row.id)}">Delete</button></td></tr>`).join('') : '<tr><td colspan="8"><div class="empty">No milk collections for this selection.</div></td></tr>';
  }

  function renderFarmerPayments() {
    const farmerId = $('#farmerPaymentFilter').value || 'all';
    const month = $('#farmerPaymentMonth').value || currentMonth();
    const rows = [...Core.farmerPaymentRecords(state, farmerId, month)].reverse();
    const total = Core.round(rows.reduce((sum, row) => sum + Number(row.amount || 0), 0));
    $('#farmerPaymentsTotal').textContent = money(total);
    $('#farmerPaymentHeading').textContent = `${rows.length} payment${rows.length === 1 ? '' : 's'} · ${monthLabel(month)}`;
    $('#farmerPaymentRows').innerHTML = rows.length ? rows.map(row => `<tr><td>${escapeHtml(dateLabel(row.date))}</td><td><strong>${escapeHtml(farmerName(row.farmerId))}</strong><small>${escapeHtml(row.notes || 'No note')}</small></td><td class="received-amount">${money(row.amount)}</td><td><button class="icon-btn danger" type="button" data-delete-farmer-payment="${escapeHtml(row.id)}">Delete</button></td></tr>`).join('') : '<tr><td colspan="4"><div class="empty">No farmer payments for this selection.</div></td></tr>';
  }

  function renderFarmerCollectionPreview() {
    const form = $('#farmerCollectionForm');
    const litres = Number(form.elements.namedItem('litres').value || 0);
    const rate = Number(form.elements.namedItem('rate').value || 0);
    $('#farmerCollectionPreview').textContent = litres > 0 && Number.isFinite(rate) ? `${number(litres)} L × ${money(rate)} = ${money(litres * rate)}` : 'Enter litres to calculate the purchase amount.';
  }

  function renderFarmerSection() {
    renderFarmers($('#farmerSearch')?.value || '');
    renderFarmerSummary();
    renderFarmerCollections();
    renderFarmerPayments();
    renderFarmerCollectionPreview();
  }

  function renderLedger() {
    const customerId = $('#ledgerCustomer').value || 'all';
    const month = $('#ledgerMonth').value || currentMonth();
    const rows = state.entries.filter(entry => (customerId === 'all' || entry.customerId === customerId) && entry.date.startsWith(month)).sort((a, b) => a.date.localeCompare(b.date));
    $('#ledgerHeading').textContent = `${rows.length} ${rows.length === 1 ? 'entry' : 'entries'} in ${monthLabel(month)}`;
    $('#ledgerRows').innerHTML = rows.length ? rows.map(entry => {
      const isMilk = String(entry.item).toLowerCase() === 'milk';
      const bottle = !isMilk || typeof entry.bottleReturned === 'undefined' ? '<span class="bottle-status neutral">—</span>' : entry.bottleReturned === false ? '<span class="bottle-status pending">Pending</span>' : '<span class="bottle-status returned">Returned</span>';
      return `<tr><td>${dateLabel(entry.date)}</td><td>${escapeHtml(customerName(entry.customerId))}</td><td class="note-cell"><strong>${escapeHtml(entry.item)}</strong>${entry.notes ? `<br><small>${escapeHtml(entry.notes)}</small>` : ''}</td><td>${number(entry.quantity)} ${escapeHtml(entry.unit)}</td><td>${money(entry.rate)}</td><td><strong>${money(entry.amount)}</strong></td><td>${bottle}</td><td><button class="icon-btn danger" data-delete-entry="${entry.id}" aria-label="Delete entry">×</button></td></tr>`;
    }).join('') : '<tr><td colspan="8"><div class="empty">No entries for this selection.</div></td></tr>';
    renderBottleReturns();
    renderPayments();
  }

  function renderBottleReturns() {
    const rows = pendingBottleEntries();
    $('#pendingBottleTotal').textContent = `${rows.length} pending`;
    $('#pendingBottleRows').innerHTML = rows.length ? rows.map(entry => {
      const customer = customerById(entry.customerId);
      return `<tr><td>${escapeHtml(dateLabel(entry.date))}</td><td><strong>${escapeHtml(customer?.name || 'Unknown customer')}</strong></td><td>${escapeHtml(routeLabel(customerRouteId(customer)))}</td><td><button class="btn ghost bottle-return-button" type="button" data-return-bottle="${escapeHtml(entry.id)}">Mark returned</button></td></tr>`;
    }).join('') : '<tr><td colspan="4"><div class="empty">All tracked bottles have been returned.</div></td></tr>';
  }

  function markBottleReturned(entryId) {
    if (!Core.markBottleReturned(state, entryId, todayISO())) return;
    saveState(); renderAll(); toast('Bottle marked as returned.');
  }

  function renderPayments() {
    const customerId = $('#ledgerCustomer').value || 'all';
    const month = $('#ledgerMonth').value || currentMonth();
    const rows = Core.paymentRecords(state, customerId, month);
    $('#paymentsHistoryTotal').textContent = money(Core.round(rows.reduce((sum, row) => sum + Number(row.amount), 0)));
    $('#paymentsHistorySummary').textContent = `${rows.length} ${rows.length === 1 ? 'payment' : 'payments'} · ${monthLabel(month)} · ${customerId === 'all' ? 'All customers' : customerName(customerId)}`;
    $('#paymentRows').innerHTML = rows.length ? rows.map(payment => `<tr><td>${escapeHtml(dateLabel(payment.date))}</td><td><strong>${escapeHtml(customerName(payment.customerId))}</strong><small>${escapeHtml(payment.notes || 'No note')}</small></td><td class="received-amount">${money(payment.amount)}</td><td><button class="icon-btn danger" type="button" data-delete-payment="${escapeHtml(payment.id)}" aria-label="Delete payment for ${escapeHtml(customerName(payment.customerId))} on ${escapeHtml(dateLabel(payment.date))}">Delete</button></td></tr>`).join('') : '<tr><td colspan="4"><div class="empty">No payments for this customer and month.</div></td></tr>';
  }

  function invoiceNumber(customerId, month, create = true) {
    const key = `${customerId}_${month}`;
    if (!state.invoiceNumbers[key] && create) {
      const seed = Math.floor(1000 + Math.random() * 9000);
      state.invoiceNumbers[key] = `${state.settings.invoicePrefix || 'AF'}-${month.replace('-', '')}-${seed}`;
      saveState();
    }
    return state.invoiceNumbers[key] || '';
  }

  function aggregateInvoiceRows(entries) {
    const groups = new Map();
    entries.forEach(entry => {
      const key = `${entry.date}|${entry.item}|${entry.unit}|${entry.rate}`;
      const existing = groups.get(key) || { ...entry, quantity: 0, amount: 0, notes: [] };
      existing.quantity += Number(entry.quantity);
      existing.amount += Number(entry.amount);
      if (entry.notes && !existing.notes.includes(entry.notes)) existing.notes.push(entry.notes);
      groups.set(key, existing);
    });
    return [...groups.values()].sort((a, b) => a.date.localeCompare(b.date)).map(row => ({ ...row, notes: row.notes.join('; ') }));
  }

  function invoiceModel(customerId, month) {
    const customer = customerById(customerId);
    if (!customer) return null;
    const totals = totalsFor(customerId, month);
    const rows = aggregateInvoiceRows(totals.entries);
    const numberValue = invoiceNumber(customerId, month);
    const range = monthRange(month);
    return { customer, month, rows, ...totals, invoiceNumber: numberValue, range };
  }

  function fillMessage(model) {
    const template = state.settings.messageTemplate || '';
    return template.replaceAll('{name}', model.customer.name).replaceAll('{month}', monthLabel(model.month)).replaceAll('{amount}', money(model.due)).replaceAll('{invoice}', model.invoiceNumber).replaceAll('{business}', state.settings.businessName);
  }

  function invoiceHtml(model) {
    const logo = state.settings.logo || 'assets/aadya-logo.png';
    const qr = state.settings.paymentQr;
    const rows = model.rows.length ? model.rows.map((row, index) => `<tr><td>${index + 1}</td><td>${dateLabel(row.date)}</td><td>${escapeHtml(row.item)}${row.notes ? `<br><small>${escapeHtml(row.notes)}</small>` : ''}</td><td>${number(row.quantity)} ${escapeHtml(row.unit)}</td><td>${money(row.rate)}${row.item === 'Milk' ? '/L' : ''}</td><td>${money(row.amount)}</td></tr>`).join('') : '<tr><td colspan="6">No delivery entries for this month.</td></tr>';
    return `<article class="invoice-paper"><header class="invoice-header"><div class="invoice-brand"><img src="${escapeHtml(logo)}" alt="${escapeHtml(state.settings.businessName)}"><div><h3>${escapeHtml(state.settings.businessName)}</h3><p>${escapeHtml(state.settings.phone)}</p><p>${escapeHtml(state.settings.address)}</p></div></div><div class="invoice-customer"><h4>Invoice for ${escapeHtml(model.customer.name)}</h4><p>${escapeHtml(model.customer.phone)}</p><p>${escapeHtml(model.customer.address)}</p><p><strong>${escapeHtml(model.invoiceNumber)}</strong></p></div></header><section class="invoice-total-band"><div><p class="eyebrow">AMOUNT TO PAY</p><h2>${money(model.due)}</h2></div><div class="invoice-meta"><strong>${monthLabel(model.month)}</strong><br>${dateLabel(model.range.start)} - ${dateLabel(model.range.end)}<br>Created: ${dateLabel(todayISO())}</div></section><table class="invoice-table"><thead><tr><th>#</th><th>Date</th><th>Item / Notes</th><th>Quantity</th><th>Rate</th><th>Amount</th></tr></thead><tbody>${rows}</tbody></table><section class="invoice-summary"><div>${qr ? `<div class="payment-box"><img src="${escapeHtml(qr)}" alt="Payment QR"><div><strong>Scan and pay</strong><p>${escapeHtml(state.settings.upiId || 'UPI')}</p></div></div>` : `<div class="payment-box"><div><strong>Payment details</strong><p>${escapeHtml(state.settings.upiId || 'Add a UPI ID or payment QR in Settings.')}</p></div></div>`}</div><div class="totals"><div class="total-row"><span>Bill total</span><strong>${money(model.charges)}</strong></div><div class="total-row"><span>Payments received</span><strong>- ${money(model.payments)}</strong></div><div class="total-row grand"><span>Amount due</span><strong>${money(model.due)}</strong></div></div></section><footer class="invoice-foot">Thank you for choosing ${escapeHtml(state.settings.businessName)}. Fresh · Clean · Trusted</footer></article>`;
  }

  function renderInvoiceArea() {
    if (!state.customers.length) {
      $('#invoicePreviewHost').innerHTML = '<div class="empty">Add a customer before creating an invoice.</div>';
      return;
    }
    const customerId = $('#invoiceCustomer').value || state.customers[0].id;
    const month = $('#invoiceMonth').value || currentMonth();
    $('#invoiceCustomer').value = customerId;
    $('#invoiceMonth').value = month;
    const model = invoiceModel(customerId, month);
    $('#invoicePreviewHost').innerHTML = invoiceHtml(model);
    $('#printInvoice').innerHTML = invoiceHtml(model);
    $('#invoiceMessage').value = fillMessage(model);
    renderSendQueue(month);
  }

  function renderSendQueue(month) {
    const ready = state.customers.map(customer => ({ customer, model: invoiceModel(customer.id, month) })).filter(item => item.model.charges > 0);
    $('#sendQueue').innerHTML = ready.length ? ready.map(({ customer, model }) => `<div class="queue-row"><div><strong>${escapeHtml(customer.name)}</strong><small>${escapeHtml(customer.phone || 'Choose the WhatsApp contact when sharing')} · ${model.rows.length} delivery rows</small></div><span class="queue-due">${money(model.due)}</span><button class="btn whatsapp" type="button" data-share-customer="${customer.id}">Share PDF</button></div>`).join('') : '<div class="empty">No customers have entries for this month.</div>';
  }

  function periodInvoiceNumber(customerId, start, end) {
    const month = start.slice(0, 7);
    const fullMonth = monthRange(month);
    if (start === fullMonth.start && end === fullMonth.end) return invoiceNumber(customerId, month);
    return invoiceNumber(customerId, `${start}_${end}`);
  }

  function compactModels() {
    const start = $('#billStartDate').value;
    const end = $('#billEndDate').value;
    const billDate = $('#billDate').value;
    Core.validateRange(start, end);
    if (!Core.validDate(billDate)) throw new Error('Choose a valid bill date.');
    return Core.selectedSummaries(state, selectedBillCustomers, start, end).map(model => ({ ...model, billDate, invoiceNumber: periodInvoiceNumber(model.customer.id, start, end) }));
  }

  function milkRateLabel(model, currency = money) {
    if (!model.milkRates.length) return '—';
    if (model.milkRates.length === 1) return `${currency(model.milkRates[0])}/L`;
    return `${currency(model.milkRates[0])}–${currency(model.milkRates.at(-1))}/L (varies)`;
  }

  function compactBillHtml(model) {
    const s = state.settings;
    return `<article class="compact-bill"><header class="compact-brand"><img src="${escapeHtml(s.logo || 'assets/aadya-logo.png')}" alt="${escapeHtml(s.businessName)}"><div><strong>${escapeHtml(s.businessName)}</strong><span>${escapeHtml(s.phone)}</span><span>Bill: ${escapeHtml(model.invoiceNumber)} · ${escapeHtml(dateLabel(model.billDate))}</span></div></header><h4 class="compact-customer">${escapeHtml(model.customer.name)}</h4><p class="compact-period">${escapeHtml(dateLabel(model.range.start))} to ${escapeHtml(dateLabel(model.range.end))}</p><dl class="compact-facts"><div><dt>Total milk</dt><dd>${number(model.milkLitres)} L</dd></div><div><dt>Milk rate</dt><dd>${escapeHtml(milkRateLabel(model))}</dd></div><div><dt>Milk amount</dt><dd>${money(model.milkAmount)}</dd></div><div><dt>Curd / other</dt><dd>${money(model.curdAmount)} / ${money(model.otherAmount)}</dd></div></dl><div class="compact-payment"><div class="compact-totals"><div><span>Bill total</span><strong>${money(model.charges)}</strong></div><div><span>Received</span><strong>${money(model.payments)}</strong></div><div class="compact-due"><span>Amount to pay</span><strong>${money(model.due)}</strong></div>${model.credit > 0 ? `<small>Credit in period: ${money(model.credit)}</small>` : ''}</div>${s.paymentQr ? `<div class="compact-qr"><img src="${escapeHtml(s.paymentQr)}" alt="Payment QR"><span>Scan & pay</span></div>` : `<div class="compact-upi"><strong>Payment</strong><span>${escapeHtml(s.upiId || s.phone || 'Contact Aadya Farms')}</span></div>`}</div><footer class="compact-footer">${s.upiId && s.paymentQr ? escapeHtml(s.upiId) + ' · ' : ''}Thank you for choosing ${escapeHtml(s.businessName)}.</footer></article>`;
  }

  function compactSheetsHtml(models) {
    return Core.sheetGroups(models).map((group, index) => `<div class="bill-sheet" aria-label="A4 sheet ${index + 1}">${group.map(compactBillHtml).join('')}</div>`).join('');
  }

  function renderBatchBills() {
    const ids = new Set(state.customers.map(customer => customer.id));
    selectedBillCustomers = new Set([...selectedBillCustomers].filter(id => ids.has(id)));
    const start = $('#billStartDate').value, end = $('#billEndDate').value;
    let error = '';
    try { Core.validateRange(start, end); if (!Core.validDate($('#billDate').value)) throw new Error('Choose a valid bill date.'); } catch (reason) { error = reason.message; }
    $('#billCustomerList').innerHTML = state.customers.length ? state.customers.map(customer => {
      const model = error ? null : Core.periodSummary(state, customer.id, start, end);
      return `<label class="bill-customer-choice"><input type="checkbox" data-bill-customer="${escapeHtml(customer.id)}" ${selectedBillCustomers.has(customer.id) ? 'checked' : ''}><span><strong>${escapeHtml(customer.name)}</strong><small>${model ? `${number(model.milkLitres)} L · Bill ${money(model.charges)} · Paid ${money(model.payments)}` : 'Select a valid period'}${model && !model.entries.length && !model.paymentRows.length ? ' · No records' : ''}</small></span><b>${model ? money(model.due) : ''}</b></label>`;
    }).join('') : '<div class="empty">Add customers to print their bills.</div>';
    const count = selectedBillCustomers.size;
    $('#batchBillStatus').textContent = error || `${count} ${count === 1 ? 'customer' : 'customers'} selected · ${Math.ceil(count / 8)} A4 ${count > 8 ? 'sheets' : 'sheet'}`;
    $('#downloadBatchBills').disabled = !!error || count === 0;
    $('#printBatchBills').disabled = !!error || count === 0;
    $('#batchBillsPreview').innerHTML = !error && count ? compactSheetsHtml(compactModels()) : '';
  }

  function setInvoiceMode(mode) {
    invoiceMode = mode;
    $('#detailedInvoicePanel').hidden = mode !== 'detailed';
    $('#batchBillsPanel').hidden = mode !== 'slips';
    $$('[data-invoice-mode]').forEach(button => {
      const selected = button.dataset.invoiceMode === mode;
      button.classList.toggle('primary', selected);
      button.classList.toggle('ghost', !selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    if (mode === 'slips') renderBatchBills();
  }

  async function printSelectedBills() {
    let models;
    try { models = compactModels(); } catch (error) { return toast(error.message); }
    if (!models.length) return toast('Select at least one customer.');
    document.body.classList.add('printing-slips');
    $('#printInvoice').innerHTML = compactSheetsHtml(models);
    await Promise.allSettled($$('#printInvoice img').map(img => img.decode ? img.decode() : Promise.resolve()));
    window.print();
  }

  async function makeCompactBillsPdf(models) {
    if (!models.length) throw new Error('Select at least one customer.');
    const { PDFDocument, StandardFonts, rgb } = globalThis.PDFLib;
    const pdf = await PDFDocument.create();
    pdf.setTitle(`${state.settings.businessName} - 8 bills per A4`);
    pdf.setAuthor(state.settings.businessName);
    const { regular, bold } = await embedInvoiceFonts(pdf);
    const navy = rgb(.09, .22, .28), teal = rgb(.03, .50, .45), gray = rgb(.36, .42, .45), line = rgb(.75, .84, .83), pale = rgb(.92, .97, .95);
    async function embed(source) {
      const bytes = await imageBytes(source);
      if (!bytes) return null;
      try { return await pdf.embedPng(bytes); } catch { try { return await pdf.embedJpg(bytes); } catch { return null; } }
    }
    const logo = await embed(state.settings.logo || 'assets/aadya-logo.png');
    const qr = await embed(state.settings.paymentQr);
    const mm = 72 / 25.4, pageW = 210 * mm, pageH = 297 * mm, margin = 8 * mm, gap = 3 * mm;
    const width = (pageW - 2 * margin - gap) / 2, height = (pageH - 2 * margin - 3 * gap) / 4;
    const safeText = value => [...String(value ?? '').replaceAll('₹', 'Rs. ').replace(/[–—]/g, '-')].map(char => { try { regular.encodeText(char); return char; } catch { return '?'; } }).join('');
    const cash = value => `Rs. ${number(value)}`;
    for (const group of Core.sheetGroups(models)) {
      const page = pdf.addPage([pageW, pageH]);
      group.forEach((model, index) => {
        const x = margin + (index % 2) * (width + gap);
        const top = pageH - margin - Math.floor(index / 2) * (height + gap);
        const left = x + 9, right = x + width - 9;
        const text = (value, tx, fromTop, fontSize = 8, font = regular, color = navy, maxWidth = width - 18, align = 'left') => {
          let label = safeText(value), size = fontSize;
          while (font.widthOfTextAtSize(label, size) > maxWidth && size > 6) size -= .25;
          while (label && font.widthOfTextAtSize(label, size) > maxWidth) label = label.slice(0, -1);
          page.drawText(label, { x: align === 'right' ? tx - font.widthOfTextAtSize(label, size) : tx, y: top - fromTop, size, font, color });
        };
        page.drawRectangle({ x, y: top - height, width, height, borderWidth: .65, borderColor: line });
        page.drawRectangle({ x: x + .5, y: top - 40, width: width - 1, height: 39.5, color: pale });
        if (logo) { const scaled = logo.scaleToFit(70, 32); page.drawImage(logo, { x: left, y: top - 36, ...scaled }); }
        const brandX = logo ? left + 79 : left;
        const brandWidth = right - brandX;
        text(state.settings.businessName, brandX, 14, 10, bold, navy, brandWidth);
        text(`Ph: ${state.settings.phone || '-'}`, brandX, 24, 7, regular, gray, brandWidth);
        text(`Bill date: ${dateLabel(model.billDate)}`, brandX, 34, 7, regular, gray, brandWidth);
        text(model.customer.name, left, 54, 10, bold);
        text(`${dateLabel(model.range.start)} to ${dateLabel(model.range.end)}`, left, 66, 7.3, regular, gray);
        text(`Invoice: ${model.invoiceNumber}`, left, 77, 6.7, regular, gray);
        text(`Milk: ${number(model.milkLitres)} L`, left, 90, 8, bold, navy, 100);
        text(`Rate: ${milkRateLabel(model, cash)}`, right, 90, 7.3, regular, navy, width - 125, 'right');
        text(`Milk: ${cash(model.milkAmount)}`, left, 103, 7.5, regular, navy, 100);
        text(`Curd: ${cash(model.curdAmount)} | Other: ${cash(model.otherAmount)}`, right, 103, 7.1, regular, navy, width - 122, 'right');
        page.drawLine({ start: { x: left, y: top - 108 }, end: { x: right, y: top - 108 }, color: line, thickness: .5 });
        const totalsRight = qr ? right - 80 : right;
        text('Bill total', left, 121, 8);
        text(cash(model.charges), totalsRight, 121, 8, bold, navy, 89, 'right');
        text('Received', left, 134, 8);
        text(cash(model.payments), totalsRight, 134, 8, bold, teal, 89, 'right');
        page.drawRectangle({ x: left - 2, y: top - 156, width: totalsRight - left + 5, height: 18, color: pale });
        text('AMOUNT TO PAY', left + 2, 150, 7.6, bold, teal, 96);
        text(cash(model.due), totalsRight - 2, 151, 11, bold, navy, 85, 'right');
        if (qr) {
          const qrSide = 23 * mm;
          const scaled = qr.scaleToFit(qrSide - 6, qrSide - 6);
          page.drawRectangle({ x: right - qrSide, y: top - 113 - qrSide, width: qrSide, height: qrSide, color: rgb(1, 1, 1) });
          page.drawImage(qr, { x: right - qrSide + (qrSide - scaled.width) / 2, y: top - 113 - qrSide + (qrSide - scaled.height) / 2, ...scaled });
        }
        if (model.credit > 0) text(`Credit in this period: ${cash(model.credit)}`, left, 166, 7, bold, teal, totalsRight - left);
        else if (state.settings.upiId) text(`UPI: ${state.settings.upiId}`, left, 167, 6.8, regular, gray, totalsRight - left);
        text(`Thank you for choosing ${state.settings.businessName}.`, left, height - 7, 6.8, regular, gray);
      });
      for (let row = 1; row < 4; row++) {
        const y = pageH - margin - row * height - (row - .5) * gap;
        page.drawLine({ start: { x: margin, y }, end: { x: pageW - margin, y }, color: line, thickness: .4, dashArray: [2, 3] });
      }
      page.drawLine({ start: { x: pageW / 2, y: margin }, end: { x: pageW / 2, y: pageH - margin }, color: line, thickness: .4, dashArray: [2, 3] });
    }
    return new Blob([await pdf.save()], { type: 'application/pdf' });
  }

  async function downloadCompactBills() {
    const button = $('#downloadBatchBills');
    try {
      const models = compactModels();
      if (!models.length) return toast('Select at least one customer.');
      button.disabled = true;
      const pdf = await makeCompactBillsPdf(models);
      downloadBlob(pdf, `Aadya_Farms_Bills_${models[0].range.start}_to_${models[0].range.end}_8_per_A4.pdf`);
      toast(`${models.length} bills downloaded on ${Math.ceil(models.length / 8)} A4 sheet(s).`);
    } catch (error) { console.error(error); toast(error.message || 'Could not generate bills.'); }
    finally { renderBatchBills(); }
  }

  function renderSettings() {
    const form = $('#settingsForm');
    Object.entries(state.settings).forEach(([key, value]) => { if (form.elements[key]) form.elements[key].value = value; });
    $('#headerLogo').src = state.settings.logo || 'assets/aadya-logo.png';
    $('#logoPreview').src = state.settings.logo || 'assets/aadya-logo.png';
    const qr = $('#qrPreview');
    qr.src = state.settings.paymentQr || '';
    qr.hidden = !state.settings.paymentQr;
    $('#qrPreviewWrap span').hidden = !!state.settings.paymentQr;
  }

  function renderAll() {
    renderRouteSelects();
    renderCustomerSelects();
    renderFarmerSelects();
    seedFormDates();
    renderDashboard();
    renderCustomers($('#customerSearch')?.value || '', $('#customerRouteFilter')?.value || 'all');
    renderSupplyPauses();
    renderFarmerSection();
    renderLedger();
    renderSettings();
    if (activeView === 'invoices') renderInvoiceArea();
    renderBatchBills();
    renderDailyCustomers();
  }

  function saveCustomer(form) {
    const values = Object.fromEntries(new FormData(form).entries());
    try {
      const wasEditing = !!editingCustomerId;
      Core.saveCustomer(state, values, editingCustomerId, uid('cust'), todayISO());
      saveState(); resetCustomerForm(); renderAll();
      toast(wasEditing ? 'Changes saved. Ready to add a new customer.' : 'New customer added.');
    } catch (error) { toast(error.message); }
  }

  function updateCustomerMode() {
    $('#customerModeLabel').textContent = editingCustomerId ? 'EDIT CUSTOMER' : 'NEW CUSTOMER';
    $('#customerFormTitle').textContent = editingCustomerId ? `Editing ${customerName(editingCustomerId)}` : 'Add a customer';
    $('#customerSaveButton').textContent = editingCustomerId ? 'Save changes' : 'Add customer';
  }

  function resetCustomerForm() {
    editingCustomerId = null;
    $('#customerForm').reset();
    updateCustomerMode();
  }

  function editCustomer(id) {
    const customer = customerById(id); if (!customer) return;
    editingCustomerId = id;
    const form = $('#customerForm');
    ['name', 'phone', 'address', 'defaultQty', 'defaultUnit'].forEach(key => { form.elements.namedItem(key).value = customer[key] ?? ''; });
    form.elements.namedItem('routeId').value = customerRouteId(customer);
    updateCustomerMode();
    setView('customers'); form.elements.namedItem('name').focus();
  }

  function showConfirm(title, text) {
    const dialog = $('#confirmDialog');
    $('#dialogTitle').textContent = title; $('#dialogText').textContent = text;
    dialog.returnValue = 'cancel';
    dialog.showModal();
    return new Promise(resolve => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true }));
  }

  function showShareHelp() {
    const dialog = $('#shareHelpDialog');
    if (dialog?.showModal) dialog.showModal();
    else window.alert('This browser cannot share a PDF file. Open Aadya Ledger on your phone, tap Share PDF, then choose WhatsApp and the customer.');
  }

  async function deleteCustomer(id) {
    const customer = customerById(id); if (!customer) return;
    if (!await showConfirm('Delete customer?', `${customer.name} and all delivery/payment entries will be removed.`)) return;
    state.customers = state.customers.filter(item => item.id !== id);
    state.entries = state.entries.filter(item => item.customerId !== id);
    state.payments = state.payments.filter(item => item.customerId !== id);
    state.supplyPauses = (state.supplyPauses || []).filter(item => item.customerId !== id);
    selectedBillCustomers.delete(id);
    if (editingCustomerId === id) resetCustomerForm();
    saveState(); renderAll(); toast('Customer deleted.');
  }

  function saveFarmer(form) {
    const values = Object.fromEntries(new FormData(form).entries());
    try {
      const wasEditing = !!editingFarmerId;
      const farmer = Core.saveFarmer(state, values, editingFarmerId, uid('farmer'), todayISO());
      saveState(); resetFarmerForm(); renderAll();
      const collectionFarmer = $('#farmerCollectionForm [name="farmerId"]');
      if (!wasEditing && collectionFarmer) { collectionFarmer.value = farmer.id; syncFarmerRate(collectionFarmer); }
      toast(wasEditing ? 'Farmer changes saved.' : 'New farmer added.');
    } catch (error) { toast(error.message); }
  }

  function updateFarmerMode() {
    $('#farmerModeLabel').textContent = editingFarmerId ? 'EDIT FARMER' : 'NEW FARMER';
    $('#farmerFormTitle').textContent = editingFarmerId ? `Editing ${farmerName(editingFarmerId)}` : 'Add a milk provider';
    $('#farmerSaveButton').textContent = editingFarmerId ? 'Save changes' : 'Add farmer';
  }

  function resetFarmerForm() {
    editingFarmerId = null;
    $('#farmerForm').reset();
    updateFarmerMode();
  }

  function editFarmer(id) {
    const farmer = farmerById(id); if (!farmer) return;
    editingFarmerId = id;
    const form = $('#farmerForm');
    ['name', 'phone', 'village', 'defaultRate'].forEach(key => { form.elements.namedItem(key).value = farmer[key] ?? ''; });
    updateFarmerMode();
    setView('farmers'); form.elements.namedItem('name').focus();
  }

  async function deleteFarmer(id) {
    const farmer = farmerById(id); if (!farmer) return;
    const collectionCount = state.farmerCollections.filter(row => row.farmerId === id).length;
    const paymentCount = state.farmerPayments.filter(row => row.farmerId === id).length;
    if (!await showConfirm('Delete farmer?', `${farmer.name}, ${collectionCount} collection record(s) and ${paymentCount} payment record(s) will be removed.`)) return;
    state.farmers = state.farmers.filter(item => item.id !== id);
    state.farmerCollections = state.farmerCollections.filter(item => item.farmerId !== id);
    state.farmerPayments = state.farmerPayments.filter(item => item.farmerId !== id);
    if (editingFarmerId === id) resetFarmerForm();
    saveState(); renderAll(); toast('Farmer and linked records deleted.');
  }

  function syncFarmerRate(select) {
    const farmer = farmerById(select.value);
    const rate = $('#farmerCollectionForm [name="rate"]');
    if (farmer && rate) rate.value = Number(farmer.defaultRate ?? 60);
    renderFarmerCollectionPreview();
  }

  function recordFarmerCollection(form) {
    const values = Object.fromEntries(new FormData(form).entries());
    try {
      Core.addFarmerCollection(state, values, uid('collection'));
      saveState();
      ['litres', 'fat', 'snf', 'water', 'protein', 'notes'].forEach(name => { form.elements.namedItem(name).value = ''; });
      $('#farmerCollectionFilter').value = values.farmerId;
      $('#farmerCollectionMonth').value = values.date.slice(0, 7);
      $('#farmerSummaryMonth').value = values.date.slice(0, 7);
      renderAll(); toast(`${number(values.litres)} L ${values.session} collection saved.`);
    } catch (error) { toast(error.message); }
  }

  async function deleteFarmerCollection(id) {
    const row = state.farmerCollections.find(item => item.id === id); if (!row) return;
    if (!await showConfirm('Delete milk collection?', `Remove ${number(row.litres)} L from ${farmerName(row.farmerId)} on ${dateLabel(row.date)}?`)) return;
    Core.removeFarmerCollection(state, id); saveState(); renderAll(); toast('Milk collection deleted. Payable updated.');
  }

  function recordFarmerPayment(form) {
    const values = Object.fromEntries(new FormData(form).entries());
    try {
      Core.addFarmerPayment(state, values, uid('farmerpay'));
      saveState();
      form.elements.namedItem('amount').value = '';
      form.elements.namedItem('notes').value = '';
      $('#farmerPaymentFilter').value = values.farmerId;
      $('#farmerPaymentMonth').value = values.date.slice(0, 7);
      $('#farmerSummaryMonth').value = values.date.slice(0, 7);
      renderAll(); toast('Farmer payment saved. Monthly payable updated.');
    } catch (error) { toast(error.message); }
  }

  async function deleteFarmerPayment(id) {
    const row = state.farmerPayments.find(item => item.id === id); if (!row) return;
    if (!await showConfirm('Delete farmer payment?', `Remove ${money(row.amount)} paid to ${farmerName(row.farmerId)} on ${dateLabel(row.date)}?`)) return;
    Core.removeFarmerPayment(state, id); saveState(); renderAll(); toast('Farmer payment deleted. Payable updated.');
  }

  function importCsv(form) {
    const values = Object.fromEntries(new FormData(form).entries());
    const lines = String(values.rows || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const imported = [];
    const errors = [];
    let pausedRows = 0;
    lines.forEach((line, index) => {
      const [date, rawItem, rawQty, rawUnit, rawRate, ...noteParts] = line.split(',').map(value => value.trim());
      const item = rawItem ? rawItem[0].toUpperCase() + rawItem.slice(1).toLowerCase() : '';
      const quantity = Number(rawQty); const rate = Number(rawRate); const unit = rawUnit || 'L';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !item || !Number.isFinite(quantity) || !Number.isFinite(rate)) { errors.push(index + 1); return; }
      if (Core.activeSupplyPause(state, values.customerId, date)) { pausedRows += 1; return; }
      imported.push({ id: uid('entry'), customerId: values.customerId, date, item, quantity, unit, rate, amount: calculateAmount(item, quantity, unit, rate), notes: noteParts.join(', '), createdAt: Date.now() });
    });
    state.entries.push(...imported); saveState(); renderAll();
    toast(errors.length ? `${imported.length} imported; check row ${errors.join(', ')}.` : `${imported.length} entries imported${pausedRows ? ` · ${pausedRows} no-milk ${pausedRows === 1 ? 'row' : 'rows'} skipped` : ''}.`);
  }

  function recordPayment(form) {
    const values = Object.fromEntries(new FormData(form).entries());
    try {
      Core.addPayment(state, values, uid('pay'));
      saveState();
      form.elements.namedItem('amount').value = '';
      form.elements.namedItem('notes').value = '';
      $('#ledgerCustomer').value = values.customerId;
      $('#ledgerMonth').value = values.date.slice(0, 7);
      renderAll(); toast('Payment saved in Payment history.');
      $('#paymentHistory').scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (error) { toast(error.message); }
  }

  async function deletePayment(id) {
    const payment = state.payments.find(item => item.id === id);
    if (!payment) return;
    const confirmed = await showConfirm('Delete payment?', `Remove ${money(payment.amount)} received from ${customerName(payment.customerId)} on ${dateLabel(payment.date)}? The amount due will be recalculated.`);
    if (!confirmed) return;
    Core.removePayment(state, id); saveState(); renderAll(); toast('Payment deleted. Bills updated.');
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob); const link = document.createElement('a');
    link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function backupData() {
    downloadBlob(new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), ...state }, null, 2)], { type: 'application/json' }), `aadya-ledger-backup-${todayISO()}.json`);
    toast('Backup downloaded.');
  }

  async function restoreData(file) {
    try {
      const parsed = JSON.parse(await file.text());
      if (!parsed.settings || !Array.isArray(parsed.customers) || !Array.isArray(parsed.entries)) throw new Error('Invalid backup');
      if (!await showConfirm('Restore backup?', 'Current data on this device will be replaced.')) return;
      state = { ...defaultState(), ...parsed, settings: { ...defaultState().settings, ...parsed.settings } };
      saveState(); renderAll(); toast('Backup restored.');
    } catch (error) { toast('That file is not a valid Aadya Ledger backup.'); }
  }

  async function compressImage(file, maxSize = 900) {
    const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
    const image = await new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = dataUrl; });
    const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas'); canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale);
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', .86);
  }

  async function imageBytes(source) {
    if (!source) return null;
    try {
      if (source.startsWith('data:')) {
        const [meta, data] = source.split(','); const binary = meta.includes(';base64') ? atob(data) : decodeURIComponent(data);
        const bytes = new Uint8Array(binary.length); for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i); return bytes;
      }
      return new Uint8Array(await (await fetch(source)).arrayBuffer());
    } catch (error) {
      if (!hasDOM) return null;
      try {
        const image = await new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = source; });
        const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight; canvas.getContext('2d').drawImage(image, 0, 0);
        return imageBytes(canvas.toDataURL('image/png'));
      } catch { return null; }
    }
  }

  async function embedInvoiceFonts(pdf) {
    if (globalThis.fontkit && globalThis.AadyaPdfFonts) {
      pdf.registerFontkit(globalThis.fontkit);
      const decode = value => Uint8Array.from(atob(value), char => char.charCodeAt(0));
      const regular = await pdf.embedFont(decode(globalThis.AadyaPdfFonts.regular), { subset: true });
      const bold = await pdf.embedFont(decode(globalThis.AadyaPdfFonts.bold), { subset: true });
      return { regular, bold };
    }
    const { StandardFonts } = globalThis.PDFLib;
    return { regular: await pdf.embedFont(StandardFonts.Helvetica), bold: await pdf.embedFont(StandardFonts.HelveticaBold) };
  }

  async function makeInvoicePdf(model) {
    if (!globalThis.PDFLib) throw new Error('PDF generator unavailable');
    const { PDFDocument, StandardFonts, rgb } = globalThis.PDFLib;
    const pdf = await PDFDocument.create();
    pdf.setTitle(`${state.settings.businessName} - ${model.invoiceNumber}`); pdf.setAuthor(state.settings.businessName);
    const { regular, bold } = await embedInvoiceFonts(pdf);
    const navy = rgb(.09, .22, .28); const wine = rgb(.50, .06, .13); const teal = rgb(.03, .50, .45); const gray = rgb(.38, .46, .49); const pale = rgb(.93, .96, .96); const line = rgb(.84, .88, .89);
    const logoBytes = await imageBytes(state.settings.logo || 'assets/aadya-logo.png'); const qrBytes = await imageBytes(state.settings.paymentQr);
    let logoImage = null; let qrImage = null;
    if (logoBytes) { try { logoImage = await pdf.embedPng(logoBytes); } catch { try { logoImage = await pdf.embedJpg(logoBytes); } catch {} } }
    if (qrBytes) { try { qrImage = await pdf.embedPng(qrBytes); } catch { try { qrImage = await pdf.embedJpg(qrBytes); } catch {} } }
    const size = [595.28, 841.89]; const margin = 38; const rowHeight = 13.5; let page; let y;
    const drawText = (text, x, yPos, sizePt = 9, font = regular, color = navy, options = {}) => page.drawText(String(text ?? ''), { x, y: yPos, size: sizePt, font, color, ...options });
    const drawTableHeader = () => { page.drawRectangle({ x: margin, y: y - 16, width: size[0] - margin * 2, height: 18, color: pale }); [['Date', 45], ['Item / notes', 135], ['Qty', 342], ['Rate', 410], ['Amount', 485]].forEach(([label, x]) => drawText(label, x, y - 10, 7.5, bold, gray)); y -= 22; };
    const addPage = (continuation = false) => {
      page = pdf.addPage(size); y = size[1] - margin;
      if (continuation) { drawText(`${state.settings.businessName} · ${model.customer.name} · ${model.invoiceNumber}`, margin, y, 9, bold, navy); drawText('Continued', 507, y, 8, regular, gray); y -= 22; drawTableHeader(); }
    };
    addPage(false);
    if (logoImage) { const dims = logoImage.scaleToFit(116, 64); page.drawImage(logoImage, { x: margin, y: y - dims.height, width: dims.width, height: dims.height }); }
    drawText(state.settings.businessName, logoImage ? 166 : margin, y - 16, 16, bold, navy);
    drawText(state.settings.phone || '', logoImage ? 166 : margin, y - 33, 8.5, regular, gray);
    drawText((state.settings.address || '').slice(0, 55), logoImage ? 166 : margin, y - 48, 8, regular, gray);
    drawText('MONTHLY INVOICE', 430, y - 10, 9, bold, teal);
    drawText(model.invoiceNumber, 430, y - 28, 10, bold, navy);
    drawText(dateLabel(todayISO()), 430, y - 44, 8, regular, gray); y -= 78;
    page.drawLine({ start: { x: margin, y }, end: { x: size[0] - margin, y }, thickness: 1.5, color: navy }); y -= 24;
    drawText(`Bill to: ${model.customer.name}`, margin, y, 11, bold, navy); drawText(model.customer.phone || '', margin, y - 16, 8.5, regular, gray); drawText((model.customer.address || '').slice(0, 58), margin, y - 30, 8, regular, gray);
    drawText('AMOUNT TO PAY', 400, y, 7.5, bold, teal); drawText(`Rs. ${model.due.toFixed(2)}`, 400, y - 25, 20, bold, wine); y -= 62;
    drawText(`${dateLabel(model.range.start)} - ${dateLabel(model.range.end)}`, margin, y, 8.5, bold, navy); drawText('Entries are listed from earliest to latest.', 325, y, 7.5, regular, gray); y -= 12; drawTableHeader();
    model.rows.forEach(row => {
      if (y < 92) addPage(true);
      const qty = `${number(row.quantity)} ${row.unit}`; const note = row.notes ? `${row.item} - ${row.notes}` : row.item;
      drawText(dateLabel(row.date).replace(String(parseDate(row.date).getFullYear()), '').trim(), 45, y, 6.9, regular, navy);
      drawText(note.slice(0, 42), 135, y, 6.9, row.notes ? regular : bold, navy); drawText(qty, 342, y, 6.9, regular, navy);
      drawText(`Rs. ${Number(row.rate).toFixed(2)}`, 410, y, 6.9, regular, navy); drawText(`Rs. ${Number(row.amount).toFixed(2)}`, 485, y, 6.9, bold, wine);
      page.drawLine({ start: { x: margin, y: y - 4.5 }, end: { x: size[0] - margin, y: y - 4.5 }, thickness: .3, color: line }); y -= rowHeight;
    });
    if (y < 170) { addPage(true); y -= 8; }
    y -= 14;
    if (qrImage) { const dims = qrImage.scaleToFit(72, 72); page.drawImage(qrImage, { x: margin, y: y - dims.height, width: dims.width, height: dims.height }); drawText('Scan and pay', margin + 84, y - 18, 10, bold, teal); drawText(state.settings.upiId || 'UPI', margin + 84, y - 35, 8, regular, gray); }
    else { drawText('Payment', margin, y - 12, 9, bold, teal); drawText(state.settings.upiId || 'Add UPI details in Settings', margin, y - 29, 8, regular, gray); }
    const tx = 376; drawText('Bill total', tx, y, 8.5, regular, gray); drawText(`Rs. ${model.charges.toFixed(2)}`, 487, y, 8.5, bold, navy); drawText('Payments received', tx, y - 20, 8.5, regular, gray); drawText(`- Rs. ${model.payments.toFixed(2)}`, 487, y - 20, 8.5, bold, teal);
    page.drawLine({ start: { x: tx, y: y - 31 }, end: { x: size[0] - margin, y: y - 31 }, thickness: 1, color: navy }); drawText('Amount due', tx, y - 49, 10, bold, navy); drawText(`Rs. ${model.due.toFixed(2)}`, 475, y - 49, 11, bold, wine);
    page.drawLine({ start: { x: margin, y: 45 }, end: { x: size[0] - margin, y: 45 }, thickness: .5, color: line }); drawText(`Thank you for choosing ${state.settings.businessName}. Fresh - Clean - Trusted`, margin, 28, 8, regular, gray);
    return new Blob([await pdf.save()], { type: 'application/pdf' });
  }

  function invoiceFilename(model) { return `${state.settings.businessName.replace(/[^a-z0-9]+/gi, '_')}_${model.customer.name.replace(/[^a-z0-9]+/gi, '_')}_${model.month}_${model.invoiceNumber}.pdf`; }

  async function downloadInvoice(customerId = $('#invoiceCustomer').value, month = $('#invoiceMonth').value) {
    const model = invoiceModel(customerId, month); if (!model) return;
    try { const blob = await makeInvoicePdf(model); downloadBlob(blob, invoiceFilename(model)); toast('Invoice PDF downloaded.'); } catch (error) { console.error(error); toast('Could not create the PDF.'); }
  }

  async function shareInvoice(customerId = $('#invoiceCustomer').value, month = $('#invoiceMonth').value, customMessage = null) {
    const model = invoiceModel(customerId, month); if (!model) return;
    const message = customMessage ?? (customerId === $('#invoiceCustomer').value ? $('#invoiceMessage').value : fillMessage(model));
    let file;
    try {
      const blob = await makeInvoicePdf(model);
      file = new File([blob], invoiceFilename(model), { type: 'application/pdf' });
    } catch (error) {
      console.error(error); toast('Could not create the invoice PDF.'); return;
    }
    if (!navigator.share || (navigator.canShare && !navigator.canShare({ files: [file] }))) { showShareHelp(); return; }
    try {
      await navigator.share({ files: [file], title: `${state.settings.businessName} · ${model.invoiceNumber}`, text: message });
      toast('PDF shared successfully.');
    } catch (error) {
      if (error?.name === 'AbortError') return;
      console.error(error); showShareHelp();
    }
  }

  function openWhatsApp(phone, message) {
    const cleanPhone = String(phone || '').replace(/\D/g, '');
    if (!cleanPhone) return toast('Add this customer’s WhatsApp phone number first.');
    window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`, '_blank', 'noopener');
  }

  function updateBulkPreview(form) {
    const data = Object.fromEntries(new FormData(form).entries());
    const dates = getBulkDates(data.startDate, data.endDate, data.schedule, data.specificDays);
    const amount = calculateAmount(data.item, data.quantity, data.unit, data.rate);
    const target = form.id === 'bulkForm' ? $('#bulkPreview') : null;
    if (target) target.textContent = dates.length ? `${dates.length} days × ${money(amount)} = ${money(dates.length * amount)}` : 'No dates match this selection.';
  }

  function installEventHandlers() {
    $$('.nav-item').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
    $$('[data-go]').forEach(button => button.addEventListener('click', () => setView(button.dataset.go)));
    $('#quickBulkForm').addEventListener('submit', event => { event.preventDefault(); addBulkEntries(event.currentTarget); });
    $('#bulkForm').addEventListener('submit', event => { event.preventDefault(); addBulkEntries(event.currentTarget); updateBulkPreview(event.currentTarget); });
    ['input', 'change'].forEach(type => $('#bulkForm').addEventListener(type, () => updateBulkPreview($('#bulkForm'))));
    $('#customerForm').addEventListener('submit', event => { event.preventDefault(); saveCustomer(event.currentTarget); });
    $('#customerForm').addEventListener('reset', () => { editingCustomerId = null; updateCustomerMode(); });
    $('#customerSearch').addEventListener('input', event => renderCustomers(event.target.value, $('#customerRouteFilter').value));
    $('#customerRouteFilter').addEventListener('change', () => renderCustomers($('#customerSearch').value, $('#customerRouteFilter').value));
    $('#supplyPauseForm').addEventListener('submit', event => { event.preventDefault(); addSupplyPause(event.currentTarget); });
    $('#farmerForm').addEventListener('submit', event => { event.preventDefault(); saveFarmer(event.currentTarget); });
    $('#farmerForm').addEventListener('reset', () => { editingFarmerId = null; updateFarmerMode(); });
    $('#farmerSearch').addEventListener('input', event => renderFarmers(event.target.value));
    $('#farmerCollectionForm').addEventListener('submit', event => { event.preventDefault(); recordFarmerCollection(event.currentTarget); });
    $('#farmerCollectionForm [name="farmerId"]').addEventListener('change', event => syncFarmerRate(event.target));
    ['input', 'change'].forEach(type => $('#farmerCollectionForm').addEventListener(type, renderFarmerCollectionPreview));
    $('#farmerPaymentForm').addEventListener('submit', event => { event.preventDefault(); recordFarmerPayment(event.currentTarget); });
    $('#farmerSummaryMonth').addEventListener('change', () => { renderFarmerSummary(); renderFarmers($('#farmerSearch').value); });
    $('#farmerCollectionFilter').addEventListener('change', renderFarmerCollections);
    $('#farmerCollectionMonth').addEventListener('change', renderFarmerCollections);
    $('#farmerPaymentFilter').addEventListener('change', renderFarmerPayments);
    $('#farmerPaymentMonth').addEventListener('change', renderFarmerPayments);
    $('#ledgerCustomer').addEventListener('change', renderLedger); $('#ledgerMonth').addEventListener('change', renderLedger);
    $('#dashboardMonth').addEventListener('change', renderDashboard);
    $('#invoiceCustomer').addEventListener('change', renderInvoiceArea); $('#invoiceMonth').addEventListener('change', renderInvoiceArea);
    $$('[data-invoice-mode]').forEach(button => button.addEventListener('click', () => setInvoiceMode(button.dataset.invoiceMode)));
    ['billStartDate', 'billEndDate', 'billDate'].forEach(id => $(`#${id}`).addEventListener('change', renderBatchBills));
    $('#billCustomerList').addEventListener('change', event => {
      const id = event.target.dataset.billCustomer;
      if (!id) return;
      if (event.target.checked) selectedBillCustomers.add(id); else selectedBillCustomers.delete(id);
      renderBatchBills();
    });
    $('#csvForm').addEventListener('submit', event => { event.preventDefault(); importCsv(event.currentTarget); });
    $('#csvFile').addEventListener('change', async event => { const file = event.target.files[0]; if (file) $('#csvForm [name="rows"]').value = await file.text(); });
    $('#paymentForm').addEventListener('submit', event => { event.preventDefault(); recordPayment(event.currentTarget); });
    $('#dailyListForm').addEventListener('submit', event => { event.preventDefault(); submitDailyList(event.currentTarget); });
    $('#dailyCustomerSearch').addEventListener('input', renderDailyCustomers);
    $('#dailyEntryDate').addEventListener('change', renderDailyCustomers);
    $('#dailyRouteFilter').addEventListener('change', renderDailyCustomers);
    $('#dailyCustomerRows').addEventListener('change', event => { if (event.target.name === 'selected') updateDailyStatus(); });
    $$('[data-entry-mode]').forEach(button => button.addEventListener('click', () => { $$('[data-entry-mode]').forEach(item => item.classList.toggle('active', item === button)); $('#entryDailyPanel').hidden = button.dataset.entryMode !== 'daily'; $('#entryRangePanel').hidden = button.dataset.entryMode !== 'range'; $('#entryCsvPanel').hidden = button.dataset.entryMode !== 'csv'; $('#entryPaymentPanel').hidden = button.dataset.entryMode !== 'payment'; }));
    $('#settingsForm').addEventListener('submit', event => { event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget).entries()); state.settings = { ...state.settings, ...values, defaultMilkRate: Number(values.defaultMilkRate || 0) }; saveState(); renderAll(); toast('Settings saved.'); });
    $('#logoFile').addEventListener('change', async event => { const file = event.target.files[0]; if (file) { state.settings.logo = await compressImage(file); saveState(); renderSettings(); toast('Logo updated.'); } });
    $('#qrFile').addEventListener('change', async event => { const file = event.target.files[0]; if (file) { state.settings.paymentQr = await compressImage(file, 650); saveState(); renderSettings(); toast('Payment QR updated.'); } });
    $('#restoreFile').addEventListener('change', event => { const file = event.target.files[0]; if (file) restoreData(file); });
    document.addEventListener('click', async event => {
      const button = event.target.closest('button,[data-action]'); if (!button) return;
      if (button.dataset.editCustomer) editCustomer(button.dataset.editCustomer);
      if (button.dataset.editFarmer) editFarmer(button.dataset.editFarmer);
      if (button.dataset.action === 'new-customer') { resetCustomerForm(); $('#customerForm [name="name"]').focus(); }
      if (button.dataset.action === 'new-farmer') { resetFarmerForm(); $('#farmerForm [name="name"]').focus(); }
      if (button.dataset.action === 'add-daily-extra') { const row = button.closest('[data-daily-row]'); row.querySelector('[name="selected"]').checked = true; row.querySelector('.daily-extras').insertAdjacentHTML('beforeend', extraRowHtml()); updateDailyStatus(); }
      if (button.dataset.action === 'remove-daily-extra') button.closest('.daily-extra-row')?.remove();
      if (button.dataset.action === 'daily-select-visible') { $$('#dailyCustomerRows [name="selected"]:not(:disabled)').forEach(box => { box.checked = true; }); updateDailyStatus(); }
      if (button.dataset.action === 'daily-clear') { $$('#dailyCustomerRows [name="selected"]').forEach(box => { box.checked = false; }); updateDailyStatus(); }
      if (button.dataset.deleteCustomer) deleteCustomer(button.dataset.deleteCustomer);
      if (button.dataset.deleteFarmer) await deleteFarmer(button.dataset.deleteFarmer);
      if (button.dataset.deleteFarmerCollection) await deleteFarmerCollection(button.dataset.deleteFarmerCollection);
      if (button.dataset.deleteFarmerPayment) await deleteFarmerPayment(button.dataset.deleteFarmerPayment);
      if (button.dataset.deletePayment) await deletePayment(button.dataset.deletePayment);
      if (button.dataset.deletePause) await deleteSupplyPause(button.dataset.deletePause);
      if (button.dataset.whatsappPause) confirmPauseOnWhatsApp(button.dataset.whatsappPause);
      if (button.dataset.whatsappCustomer) { const customer = customerById(button.dataset.whatsappCustomer); openWhatsApp(customer?.phone, `Hi ${customer?.name || ''}, `); }
      if (button.dataset.returnBottle) markBottleReturned(button.dataset.returnBottle);
      if (button.dataset.invoiceCustomer) { setView('invoices'); $('#invoiceCustomer').value = button.dataset.invoiceCustomer; renderInvoiceArea(); }
      if (button.dataset.deleteEntry) { state.entries = state.entries.filter(entry => entry.id !== button.dataset.deleteEntry); saveState(); renderAll(); toast('Entry deleted.'); }
      if (button.dataset.shareCustomer) await shareInvoice(button.dataset.shareCustomer, $('#invoiceMonth').value);
      if (button.dataset.action === 'view-dashboard-ledger') { $('#ledgerMonth').value = $('#dashboardMonth').value || currentMonth(); setView('ledger'); renderLedger(); }
      if (button.dataset.action === 'view-pending-bottles') { setView('ledger'); renderLedger(); requestAnimationFrame(() => $('#bottleReturns').scrollIntoView({ behavior: 'smooth', block: 'start' })); }
      if (button.dataset.action === 'dismiss-sample') { state.sampleVisible = false; saveState(); renderDashboard(); }
      if (button.dataset.action === 'backup') backupData();
      if (button.dataset.action === 'download-invoice') await downloadInvoice();
      if (button.dataset.action === 'select-all-bills') { selectedBillCustomers = new Set(state.customers.map(customer => customer.id)); renderBatchBills(); }
      if (button.dataset.action === 'select-no-bills') { selectedBillCustomers.clear(); renderBatchBills(); }
      if (button.dataset.action === 'download-batch-bills') await downloadCompactBills();
      if (button.dataset.action === 'print-batch-bills') await printSelectedBills();
      if (button.dataset.action === 'share-invoice') await shareInvoice();
      if (button.dataset.action === 'whatsapp-text') { const model = invoiceModel($('#invoiceCustomer').value, $('#invoiceMonth').value); openWhatsApp(model.customer.phone, $('#invoiceMessage').value); }
      if (button.dataset.action === 'print-invoice') { document.body.classList.remove('printing-slips'); renderInvoiceArea(); window.print(); }
      if (button.dataset.action === 'clear-all' && await showConfirm('Erase all local data?', 'Download a backup first if you may need these records again.')) { state = defaultState(); state.sampleVisible = false; saveState(); renderAll(); toast('Local data erased.'); }
    });
    window.addEventListener('online', () => { updateConnection(); pushOnlineState(); }); window.addEventListener('offline', updateConnection);
    window.addEventListener('afterprint', () => document.body.classList.remove('printing-slips'));
  }

  function updateConnection() { const pill = $('#connectionPill'); if (pill) pill.lastChild.textContent = ` ${navigator.onLine ? cloudStatus : 'Offline · local copy safe'}`; }

  function registerWebMcp() {
    const context = document.modelContext; if (!context?.registerTool) return;
    const register = tool => { try { Promise.resolve(context.registerTool(tool)).catch(console.warn); } catch (error) { console.warn(error); } };
    register({ name: 'create_customer', title: 'Create customer', description: 'Add a customer to the Aadya Farms ledger and assign a delivery route.', inputSchema: { type: 'object', properties: { name: { type: 'string' }, phone: { type: 'string' }, address: { type: 'string' }, routeId: { type: 'string', enum: ['route1', 'route2'] } }, required: ['name'], additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: false }, execute(input) { const customer = { id: uid('cust'), name: String(input.name).trim(), phone: String(input.phone || '').replace(/[^0-9+]/g, ''), address: String(input.address || ''), routeId: input.routeId === 'route2' ? 'route2' : 'route1', defaultQty: 1, defaultUnit: 'L', createdAt: todayISO() }; state.customers.push(customer); saveState(); renderAll(); return { id: customer.id, name: customer.name, routeId: customer.routeId }; } });
    register({ name: 'add_delivery_range', title: 'Add delivery range', description: 'Add daily or alternate-day milk or curd entries for one customer and date range, skipping saved no-milk dates.', inputSchema: { type: 'object', properties: { customerId: { type: 'string' }, startDate: { type: 'string' }, endDate: { type: 'string' }, item: { type: 'string', enum: ['Milk', 'Curd', 'Other'] }, quantity: { type: 'number' }, unit: { type: 'string', enum: ['L', 'ml', 'pack'] }, rate: { type: 'number' }, schedule: { type: 'string', enum: ['daily', 'alternate'] } }, required: ['customerId', 'startDate', 'endDate', 'item', 'quantity', 'unit', 'rate'], additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: false }, execute(input) { if (!customerById(input.customerId)) throw new Error('Customer not found'); const matchingDates = getBulkDates(input.startDate, input.endDate, input.schedule || 'daily'); const dates = matchingDates.filter(date => !Core.activeSupplyPause(state, input.customerId, date)); const amount = calculateAmount(input.item, input.quantity, input.unit, input.rate); dates.forEach(date => state.entries.push({ id: uid('entry'), customerId: input.customerId, date, item: input.item, quantity: input.quantity, unit: input.unit, rate: input.rate, amount, notes: '', createdAt: Date.now() })); saveState(); renderAll(); return { entriesAdded: dates.length, skippedNoMilkDates: matchingDates.length - dates.length, totalAmount: dates.length * amount }; } });
    register({ name: 'add_supply_pause', title: 'Add no-milk dates', description: 'Stop milk delivery for a customer over an inclusive date range.', inputSchema: { type: 'object', properties: { customerId: { type: 'string' }, startDate: { type: 'string' }, endDate: { type: 'string' }, notes: { type: 'string' } }, required: ['customerId', 'startDate', 'endDate'], additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: false }, execute(input) { const pause = Core.addSupplyPause(state, input, uid('pause')); saveState(); renderAll(); return pause; } });
    register({ name: 'mark_bottle_returned', title: 'Mark bottle returned', description: 'Clear one pending bottle return using its milk delivery entry ID.', inputSchema: { type: 'object', properties: { entryId: { type: 'string' } }, required: ['entryId'], additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: false }, execute(input) { if (!Core.markBottleReturned(state, input.entryId, todayISO())) throw new Error('Pending bottle not found'); saveState(); renderAll(); return { entryId: input.entryId, returned: true }; } });
    register({ name: 'get_invoice_summary', title: 'Get invoice summary', description: 'Read the monthly invoice totals for a customer.', inputSchema: { type: 'object', properties: { customerId: { type: 'string' }, month: { type: 'string' } }, required: ['customerId', 'month'], additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: false }, execute(input) { const model = invoiceModel(input.customerId, input.month); if (!model) throw new Error('Customer not found'); return { invoiceNumber: model.invoiceNumber, customer: model.customer.name, month: model.month, charges: model.charges, payments: model.payments, amountDue: model.due, milkLitres: model.milkLitres }; } });
  }

  async function init() {
    if ('serviceWorker' in navigator) navigator.serviceWorker.getRegistrations().then(registrations => registrations.forEach(registration => registration.unregister())).catch(console.warn);
    await pullOnlineState({ initial: true });
    renderCustomerSelects(); seedFormDates(); installEventHandlers(); renderAll(); updateBulkPreview($('#bulkForm')); updateConnection(); registerWebMcp();
    setInterval(() => pullOnlineState(), 20000);
  }

  if (!hasDOM && typeof module !== 'undefined') module.exports = { calculateAmount, getBulkDates, monthRange, aggregateInvoiceRows, defaultState, invoiceModel, makeInvoicePdf, makeCompactBillsPdf,
    setStateForTest: value => { state = value; }, getStateForTest: () => state };
  if (hasDOM) init();
})();
