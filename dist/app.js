(() => {
  'use strict';

  const SOURCE_URL = 'https://corsi.unibo.it/laurea/IngegneriaCivile/appelli';
  const DURATION_HOURS = 3;
  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const MONTHS_IT = ['gennaio','febbraio','marzo','aprile','maggio','giugno','luglio','agosto','settembre','ottobre','novembre','dicembre'];
  const copy = {
    eyebrow:'Ingegneria civile · Università di Bologna',appSubtitle:'Calendario esami',officialSource:'Fonte ufficiale',refresh:'Aggiorna',intro:'Gli appelli ufficiali della laurea triennale, organizzati per individuare rapidamente le sovrapposizioni.',exams:'Appelli',conflicts:'Conflitti',lastUpdate:'Aggiornato',today:'Oggi',month:'Mese',week:'Settimana',courseFilter:'Corso',teacherFilter:'Docente',clearFilters:'Azzera filtri',durationNote:'Durata indicativa: 3 ore',loadingTitle:'Caricamento degli appelli',loadingBody:'Lettura della pagina ufficiale Unibo…',planning:'Pianificazione',detectedConflicts:'Conflitti rilevati',conflictExplanation:'Gli intervalli sono calcolati usando una durata indicativa di tre ore.',openSource:'Apri la fonte ufficiale',disclaimer:'Visualizzatore indipendente. I dati ufficiali restano quelli pubblicati dall’Università di Bologna.',allCourses:'Tutti i corsi',allTeachers:'Tutti i docenti',loadError:'Impossibile leggere gli appelli',loadErrorBody:'Controlla la connessione e prova ad aggiornare. I dati ufficiali sono sempre disponibili dal collegamento in alto.',more:n=>`+${n} altri`,date:'Data e ora',duration:'Durata',teacher:'Docente',type:'Tipo di prova',place:'Luogo',subscriptions:'Iscrizioni',notes:'Note',hours:'3 ore (indicative)',conflict:'In sovrapposizione',yes:'Sì',no:'No',exportEmpty:'Nessun appello da esportare con i filtri attuali.',csvName:'appelli-ic-calendar.csv',icsName:'appelli-ic-calendar.ics'
  };

  const state = {
    view: 'month', cursor: new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()), events: [], filtered: [],
    conflictIds: new Set(), conflictGroups: [], loading: true
  };
  const $ = id => document.getElementById(id);
  const tr = key => copy[key];
  const locale = () => 'it-IT';
  const clean = value => (value || '').replace(/\s+/g, ' ').trim();
  const startOfDay = date => new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const addDays = (date, days) => { const next = new Date(date); next.setDate(next.getDate() + days); return next; };
  const addMonths = (date, months) => new Date(date.getFullYear(), date.getMonth() + months, 1);
  const startOfWeek = date => addDays(startOfDay(date), -((date.getDay() + 6) % 7));
  const sameDay = (a,b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const dayKey = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;

  function parseDate(value) {
    const match = clean(value).match(/(\d{1,2})\s+([A-Za-zàèéìòù]+)\s+(\d{4})\s+(?:ore|at)\s+(\d{1,2}):(\d{2})/i);
    if (!match) return null;
    const monthName = match[2].toLowerCase();
    let month = MONTHS_IT.indexOf(monthName);
    if (month < 0) month = MONTHS.findIndex(name => name.toLowerCase() === monthName);
    return month < 0 ? null : new Date(+match[3], month, +match[1], +match[4], +match[5]);
  }

  function parseExamPage(html) {
    const page = new DOMParser().parseFromString(html, 'text/html');
    const events = [];
    const fieldNames = {
      'when':'when','data e ora':'when',
      'test type':'type','tipo prova':'type',
      'place':'place','luogo':'place',
      'subscriptions list':'subscriptions','lista iscrizioni':'subscriptions',
      'notes':'notes','note':'notes'
    };
    page.querySelectorAll('h3[aria-controls]').forEach((heading, courseIndex) => {
      const code = clean(heading.querySelector('.code')?.textContent);
      const teacher = clean(heading.querySelector('.docente')?.textContent);
      const titleCopy = heading.cloneNode(true);
      titleCopy.querySelectorAll('.code,.docente,i').forEach(node => node.remove());
      const course = clean(titleCopy.textContent);
      const panel = page.getElementById(heading.getAttribute('aria-controls')) || heading.nextElementSibling;
      panel?.querySelectorAll('table.single-item').forEach((table, examIndex) => {
        const fields = {};
        table.querySelectorAll('tr').forEach(row => {
          const label = clean(row.querySelector('th')?.textContent).replace(/:$/, '').toLowerCase();
          const key = fieldNames[label];
          if (key) fields[key] = clean(row.querySelector('td')?.textContent);
        });
        const start = parseDate(fields.when);
        if (!start) return;
        events.push({
          id:`${code}-${start.getTime()}-${courseIndex}-${examIndex}`, code, course, teacher, start,
          end:new Date(start.getTime() + DURATION_HOURS * 3600000), type:fields.type || '',
          place:fields.place || '', subscriptions:fields.subscriptions || '', notes:fields.notes || ''
        });
      });
    });
    return events.sort((a,b) => a.start - b.start || a.course.localeCompare(b.course));
  }

  function findConflicts(events) {
    state.conflictIds = new Set();
    state.conflictGroups = [];
    const days = events.reduce((map,event) => {
      const key = dayKey(event.start);
      map.set(key, [...(map.get(key) || []), event]);
      return map;
    }, new Map());
    days.forEach(dayEvents => {
      const sorted = [...dayEvents].sort((a,b) => a.start-b.start);
      let group = [], groupEnd = null;
      const finishGroup = () => {
        if (group.length > 1) {
          state.conflictGroups.push(group);
          group.forEach(event => state.conflictIds.add(event.id));
        }
      };
      sorted.forEach(event => {
        if (!group.length || event.start < groupEnd) {
          group.push(event);
          if (!groupEnd || event.end > groupEnd) groupEnd = event.end;
        } else {
          finishGroup();
          group = [event]; groupEnd = event.end;
        }
      });
      finishGroup();
    });
  }

  async function loadEvents() {
    setStatus('loading');
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(`${SOURCE_URL}?iccalendar=${Date.now()}`, {cache:'no-store',signal:controller.signal});
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const events = parseExamPage(await response.text());
      if (!events.length) throw new Error('No exam dates found');
      state.events = events;
      findConflicts(events);
      const now = new Date();
      const currentMonthHasEvents = events.some(event => event.start.getFullYear() === now.getFullYear() && event.start.getMonth() === now.getMonth());
      if (!currentMonthHasEvents && (state.cursor < events[0].start || state.cursor > events.at(-1).start)) state.cursor = new Date(events[0].start.getFullYear(), events[0].start.getMonth(), 1);
      populateFilters();
      setStatus('ready');
      applyFilters();
      $('lastUpdated').textContent = new Intl.DateTimeFormat(locale(), {hour:'2-digit',minute:'2-digit'}).format(new Date());
    } catch (error) {
      console.error('IC Calendar:', error);
      setStatus('error');
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function setStatus(mode) {
    state.loading = mode === 'loading';
    $('refreshButton').disabled = state.loading;
    $('statusMessage').hidden = mode === 'ready';
    $('calendarContainer').hidden = mode !== 'ready';
    if (mode === 'loading') {
      $('statusMessage').className = 'status-panel loading';
      $('statusMessage').innerHTML = `<span class="spinner" aria-hidden="true"></span><div><strong>${tr('loadingTitle')}</strong><span>${tr('loadingBody')}</span></div>`;
    } else if (mode === 'error') {
      $('statusMessage').className = 'status-panel error';
      $('statusMessage').innerHTML = `<div><strong>${tr('loadError')}</strong><span>${tr('loadErrorBody')}</span></div>`;
    }
  }

  function populateFilters() {
    const oldCourse = $('courseFilter').value;
    const oldTeacher = $('teacherFilter').value;
    const courses = [...new Set(state.events.map(event => `${event.code} · ${event.course}`))].sort();
    const teachers = [...new Set(state.events.map(event => event.teacher).filter(Boolean))].sort();
    $('courseFilter').replaceChildren(new Option(tr('allCourses'),''), ...courses.map(value => new Option(value,value)));
    $('teacherFilter').replaceChildren(new Option(tr('allTeachers'),''), ...teachers.map(value => new Option(value,value)));
    $('courseFilter').value = oldCourse;
    $('teacherFilter').value = oldTeacher;
  }

  function applyFilters() {
    const course = $('courseFilter').value;
    const teacher = $('teacherFilter').value;
    state.filtered = state.events.filter(event => (!course || `${event.code} · ${event.course}` === course) && (!teacher || event.teacher === teacher));
    render();
  }

  function render() {
    document.documentElement.lang = 'it';
    document.querySelectorAll('[data-i18n]').forEach(node => { const value = tr(node.dataset.i18n); if (typeof value === 'string') node.textContent = value; });
    $('examCount').textContent = state.loading ? '—' : state.filtered.length;
    $('conflictCount').textContent = state.loading ? '—' : state.filtered.filter(event => state.conflictIds.has(event.id)).length;
    $('monthViewButton').classList.toggle('active', state.view === 'month');
    $('weekViewButton').classList.toggle('active', state.view === 'week');
    updateTitle();
    if (!state.loading && state.events.length) {
      state.view === 'month' ? renderMonth() : renderWeek();
      renderConflicts();
    }
  }

  function updateTitle() {
    let title;
    if (state.view === 'month') title = new Intl.DateTimeFormat(locale(), {month:'long',year:'numeric'}).format(state.cursor);
    else {
      const start = startOfWeek(state.cursor), end = addDays(start,6);
      title = `${new Intl.DateTimeFormat(locale(),{day:'numeric',month:'short'}).format(start)} — ${new Intl.DateTimeFormat(locale(),{day:'numeric',month:'short',year:'numeric'}).format(end)}`;
    }
    $('calendarTitle').textContent = title.charAt(0).toUpperCase() + title.slice(1);
  }

  function eventButton(event, className) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `${className}${state.conflictIds.has(event.id) ? ' conflict' : ''}`;
    button.setAttribute('aria-label', `${event.course}, ${formatDateTime(event.start)}`);
    button.addEventListener('click', () => showEvent(event));
    return button;
  }

  function renderMonth() {
    const grid = document.createElement('div');
    grid.className = 'month-grid';
    const monday = new Date(2024,0,1);
    for (let i=0;i<7;i++) {
      const head = document.createElement('div'); head.className = 'weekday';
      head.textContent = new Intl.DateTimeFormat(locale(),{weekday:'short'}).format(addDays(monday,i)); grid.append(head);
    }
    const gridStart = startOfWeek(new Date(state.cursor.getFullYear(),state.cursor.getMonth(),1));
    const byDay = state.filtered.reduce((map,event) => { (map[dayKey(event.start)] ??= []).push(event); return map; },{});
    for (let index=0;index<42;index++) {
      const date = addDays(gridStart,index), events = byDay[dayKey(date)] || [];
      const cell = document.createElement('div'); cell.className = 'day-cell';
      if (date.getMonth() !== state.cursor.getMonth()) cell.classList.add('outside');
      if (sameDay(date,new Date())) cell.classList.add('today');
      if (events.some(event => state.conflictIds.has(event.id))) cell.classList.add('has-conflict');
      const number = document.createElement('div'); number.className = 'day-number'; number.textContent = date.getDate(); cell.append(number);
      const list = document.createElement('div'); list.className = 'day-events';
      events.slice(0,4).forEach(event => {
        const button = eventButton(event,'event-card');
        const time = document.createElement('span'); time.className = 'event-time'; time.textContent = formatTime(event.start);
        const name = document.createElement('span'); name.className = 'event-name'; name.textContent = `${event.code} ${event.course}`;
        button.append(time,name); list.append(button);
      });
      if (events.length > 4) { const more = document.createElement('div'); more.className = 'more-events'; more.textContent = tr('more')(events.length-4); list.append(more); }
      cell.append(list); grid.append(cell);
    }
    $('calendarContainer').replaceChildren(grid);
  }

  function assignLanes(events) {
    const laneEnds = [];
    const positioned = events.map(event => {
      let lane = laneEnds.findIndex(end => end <= event.start);
      if (lane < 0) lane = laneEnds.length;
      laneEnds[lane] = event.end;
      return {event,lane};
    });
    return {positioned, lanes:Math.max(1,laneEnds.length)};
  }

  function renderWeek() {
    const wrap = document.createElement('div'); wrap.className = 'week-view';
    const header = document.createElement('div'); header.className = 'week-header'; header.append(document.createElement('div'));
    const start = startOfWeek(state.cursor);
    for (let i=0;i<7;i++) {
      const date = addDays(start,i), day = document.createElement('div');
      if (sameDay(date,new Date())) day.classList.add('today');
      const name = document.createElement('span'); name.className = 'week-day-name'; name.textContent = new Intl.DateTimeFormat(locale(),{weekday:'short'}).format(date);
      const number = document.createElement('span'); number.className = 'week-day-number'; number.textContent = date.getDate();
      day.append(name,number); header.append(day);
    }
    const body = document.createElement('div'); body.className = 'week-body';
    const axis = document.createElement('div'); axis.className = 'time-axis';
    for (let hour=8;hour<20;hour++) { const label = document.createElement('div'); label.className = 'time-label'; label.textContent = `${String(hour).padStart(2,'0')}:00`; axis.append(label); }
    body.append(axis);
    for (let i=0;i<7;i++) {
      const date = addDays(start,i), column = document.createElement('div'); column.className = 'week-column';
      const daily = state.filtered.filter(event => sameDay(event.start,date));
      const {positioned,lanes} = assignLanes(daily);
      positioned.forEach(({event,lane}) => {
        const startHour = event.start.getHours() + event.start.getMinutes()/60;
        const top = Math.max(0,(startHour-8)*62), height = Math.max(34,Math.min(DURATION_HOURS*62,744-top));
        const button = eventButton(event,'week-event');
        button.style.top = `${top}px`; button.style.height = `${height}px`;
        button.style.left = `calc(${lane * 100/lanes}% + 3px)`; button.style.width = `calc(${100/lanes}% - 6px)`; button.style.right = 'auto';
        const time = document.createElement('strong'); time.textContent = `${formatTime(event.start)}–${formatTime(event.end)}`;
        const name = document.createElement('span'); name.textContent = `${event.code} · ${event.course}`;
        button.append(time,name); column.append(button);
      });
      body.append(column);
    }
    wrap.append(header,body); $('calendarContainer').replaceChildren(wrap);
  }

  function renderConflicts() {
    const visible = new Set(state.filtered.map(event => event.id));
    const groups = state.conflictGroups.map(group => group.filter(event => visible.has(event.id))).filter(group => group.length > 1);
    $('conflictsSection').hidden = !groups.length;
    $('conflictsList').replaceChildren(...groups.map(group => {
      const card = document.createElement('article'); card.className = 'conflict-card';
      const date = document.createElement('div'); date.className = 'conflict-date';
      date.append(document.createTextNode(group[0].start.getDate()));
      const month = document.createElement('small'); month.textContent = new Intl.DateTimeFormat(locale(),{month:'short'}).format(group[0].start); date.append(month);
      const detail = document.createElement('div'); detail.className = 'conflict-copy';
      const title = document.createElement('strong'); title.textContent = `${formatTime(group[0].start)} · ${group.length} ${tr('exams').toLowerCase()}`;
      const names = document.createElement('span'); names.textContent = group.map(event => `${event.code} ${event.course}`).join(' · ');
      detail.append(title,names); card.append(date,detail); return card;
    }));
  }

  const formatTime = date => new Intl.DateTimeFormat(locale(),{hour:'2-digit',minute:'2-digit'}).format(date);
  const formatDateTime = date => new Intl.DateTimeFormat(locale(),{weekday:'long',day:'numeric',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(date);

  function showEvent(event) {
    $('dialogCode').textContent = event.code; $('dialogTitle').textContent = event.course; $('dialogTeacher').textContent = event.teacher;
    const rows = [[tr('date'),formatDateTime(event.start)],[tr('duration'),tr('hours')],[tr('teacher'),event.teacher],[tr('type'),event.type],[tr('place'),event.place],[tr('subscriptions'),event.subscriptions],[tr('notes'),event.notes],[tr('conflict'),state.conflictIds.has(event.id)?tr('yes'):tr('no')]].filter(([,value]) => value);
    const details = $('dialogDetails'); details.replaceChildren();
    rows.forEach(([label,value]) => { const dt=document.createElement('dt'), dd=document.createElement('dd'); dt.textContent=label; dd.textContent=value; details.append(dt,dd); });
    $('eventDialog').showModal();
  }

  function download(content,type,filename) {
    const url = URL.createObjectURL(new Blob([content],{type}));
    const link = Object.assign(document.createElement('a'),{href:url,download:filename});
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url),500);
  }
  const csvCell = value => `"${String(value ?? '').replace(/"/g,'""')}"`;
  const icsText = value => String(value || '').replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');
  const icsDate = date => `${date.getFullYear()}${String(date.getMonth()+1).padStart(2,'0')}${String(date.getDate()).padStart(2,'0')}T${String(date.getHours()).padStart(2,'0')}${String(date.getMinutes()).padStart(2,'0')}00`;

  function exportCsv() {
    if (!state.filtered.length) { window.alert(tr('exportEmpty')); return; }
    const rows = [['Codice','Corso','Docente','Inizio','Fine indicativa','Tipo di prova','Luogo','Iscrizioni','Note'],...state.filtered.map(e => [e.code,e.course,e.teacher,e.start.toISOString(),e.end.toISOString(),e.type,e.place,e.subscriptions,e.notes])];
    download('\ufeff'+rows.map(row => row.map(csvCell).join(',')).join('\r\n'),'text/csv;charset=utf-8',tr('csvName'));
  }
  function exportIcs() {
    if (!state.filtered.length) { window.alert(tr('exportEmpty')); return; }
    const stamp = new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
    const entries = state.filtered.map(e => ['BEGIN:VEVENT',`UID:${icsText(e.id)}@iccalendar`,`DTSTAMP:${stamp}`,`DTSTART;TZID=Europe/Rome:${icsDate(e.start)}`,`DTEND;TZID=Europe/Rome:${icsDate(e.end)}`,`SUMMARY:${icsText(`${e.code} · ${e.course}`)}`,`DESCRIPTION:${icsText(`${e.teacher}\n${e.type}\n${e.notes}`)}`,`LOCATION:${icsText(e.place)}`,`URL:${SOURCE_URL}`,'END:VEVENT'].join('\r\n')).join('\r\n');
    download(['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//ICcalendar//Calendario esami//IT','CALSCALE:GREGORIAN','METHOD:PUBLISH',entries,'END:VCALENDAR'].join('\r\n'),'text/calendar;charset=utf-8',tr('icsName'));
  }

  $('refreshButton').addEventListener('click',loadEvents);
  $('monthViewButton').addEventListener('click',() => { state.view='month'; state.cursor=new Date(state.cursor.getFullYear(),state.cursor.getMonth(),1); render(); });
  $('weekViewButton').addEventListener('click',() => { state.view='week'; render(); });
  $('previousButton').addEventListener('click',() => { state.cursor=state.view==='month'?addMonths(state.cursor,-1):addDays(state.cursor,-7); render(); });
  $('nextButton').addEventListener('click',() => { state.cursor=state.view==='month'?addMonths(state.cursor,1):addDays(state.cursor,7); render(); });
  $('todayButton').addEventListener('click',() => { state.cursor=startOfDay(new Date()); render(); });
  $('courseFilter').addEventListener('change',applyFilters); $('teacherFilter').addEventListener('change',applyFilters);
  $('clearFiltersButton').addEventListener('click',() => { $('courseFilter').value=''; $('teacherFilter').value=''; applyFilters(); });
  $('csvButton').addEventListener('click',exportCsv); $('icsButton').addEventListener('click',exportIcs);
  $('closeDialogButton').addEventListener('click',() => $('eventDialog').close());
  $('eventDialog').addEventListener('click',event => { if (event.target === $('eventDialog')) $('eventDialog').close(); });

  render();
  loadEvents();
})();
