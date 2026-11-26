/**
 * Our Digital Library
 * Vanilla JS, no dependencies. Data comes from `libraryData` (data.js).
 */
(() => {
    'use strict';

    // ------------------------------------------------------------------
    // Config
    // ------------------------------------------------------------------
    const PAGE_SIZE = 48;
    const LOCALE = 'tr';
    const READERS = {
        ibrahim: { name: 'İbrahim', key: 'ibrahimRead', initial: 'İ' },
        esra: { name: 'Esra', key: 'esraRead', initial: 'E' },
    };
    const FILTERS = [
        { id: 'all', label: 'All' },
        { id: 'ibrahim', label: 'İbrahim' },
        { id: 'esra', label: 'Esra' },
        { id: 'both', label: 'Together' },
        { id: 'unread', label: 'Unread' },
    ];
    // Curated cover palettes: [background, foreground, accent]
    const PALETTES = [
        ['#1f3a5f', '#f3e9d2', '#e0a458'],
        ['#7a2e2e', '#f6ede1', '#e8b86d'],
        ['#2f4f3e', '#efe6d4', '#c9a66b'],
        ['#e8d9bd', '#2b2420', '#b4532a'],
        ['#3b2f4a', '#f1e7da', '#d9a5b3'],
        ['#b4532a', '#fbf3e6', '#2b2420'],
        ['#0f2a2e', '#e6efe9', '#6fb3a9'],
        ['#d9c3a5', '#3a2a20', '#7a2e2e'],
        ['#2a2a2a', '#efe9df', '#d4a24c'],
        ['#5c6b4e', '#f4efe2', '#2b2420'],
        ['#8a5a44', '#f8efe4', '#f0c987'],
        ['#cfdcd6', '#1f3a3a', '#b4532a'],
    ];
    const PATTERNS = ['band', 'circle', 'frame', 'diagonal', 'dots', 'split'];
    const SMALL_WORDS = new Set(['ve', 'ile', 'ya', 'da', 'de', 'ki', 'mi', 'veya', 'of', 'the', 'and', 'a', 'an', 'in', 'on', 'to']);
    const ROMAN = /^(i|ii|iii|iv|v|vi|vii|viii|ix|x|xi|xii)$/i;

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // ------------------------------------------------------------------
    // Utilities
    // ------------------------------------------------------------------
    const $ = (sel, root = document) => root.querySelector(sel);
    const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

    const escapeHtml = (value) =>
        String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    /** Turkish-aware, accent-insensitive normalisation for search & grouping. */
    const normalize = (value) =>
        String(value ?? '')
            .toLocaleLowerCase(LOCALE)
            .replace(/ı/g, 'i')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/\s+/g, ' ')
            .trim();

    /** "HARRY POTTER VE SIRLAR ODASI" -> "Harry Potter ve Sırlar Odası" (Turkish-aware). */
    const titleCase = (value) => {
        const lower = String(value ?? '').trim().toLocaleLowerCase(LOCALE);
        let wordIndex = 0;
        return lower.replace(/\p{L}+/gu, (word, offset, full) => {
            const prev = full[offset - 1];
            const isFirst = wordIndex++ === 0;
            if (prev === "'" || prev === '’') return word; // Dünya'nın
            if (ROMAN.test(word) && word.length > 1) return word.toLocaleUpperCase(LOCALE);
            if (!isFirst && SMALL_WORDS.has(word) && prev === ' ') return word;
            return word.charAt(0).toLocaleUpperCase(LOCALE) + word.slice(1);
        });
    };

    /** Lenient date parser: "4.04.2022", "06/072024" -> Date | null */
    const parseDate = (value) => {
        const m = String(value ?? '').match(/(\d{1,2})\D*(\d{1,2})\D*(\d{4})/);
        if (!m) return null;
        const [, d, mo, y] = m.map(Number);
        const date = new Date(y, mo - 1, d);
        return Number.isNaN(date.getTime()) ? null : date;
    };

    const dateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    const numberFmt = new Intl.NumberFormat('en-US');
    const formatDate = (date) => (date ? dateFmt.format(date) : '');

    const hash = (str) => {
        let h = 2166136261;
        for (let i = 0; i < str.length; i++) {
            h ^= str.charCodeAt(i);
            h = Math.imul(h, 16777619);
        }
        return h >>> 0;
    };

    const debounce = (fn, wait = 120) => {
        let t;
        return (...args) => {
            clearTimeout(t);
            t = setTimeout(() => fn(...args), wait);
        };
    };

    // ------------------------------------------------------------------
    // Data model — normalise once, query many times
    // ------------------------------------------------------------------
    const rawData = Array.isArray(window.libraryData) ? window.libraryData : (typeof libraryData !== 'undefined' ? libraryData : []);

    const books = rawData.map((raw, index) => {
        const pages = Number.parseInt(raw.pages, 10);
        const ibrahimDate = parseDate(raw.ibrahimRead);
        const esraDate = parseDate(raw.esraRead);
        const h = hash(raw.title + raw.author);
        return {
            id: index,
            title: titleCase(raw.title),
            author: titleCase(raw.author) || 'Unknown author',
            publisher: titleCase(raw.publisher),
            notes: String(raw.notes ?? '').trim(),
            pages: Number.isFinite(pages) && pages > 0 ? pages : null,
            reads: {
                ibrahim: raw.ibrahimRead?.trim() ? { date: ibrahimDate, raw: raw.ibrahimRead.trim() } : null,
                esra: raw.esraRead?.trim() ? { date: esraDate, raw: raw.esraRead.trim() } : null,
            },
            lastRead: Math.max(ibrahimDate?.getTime() ?? 0, esraDate?.getTime() ?? 0),
            authorKey: normalize(raw.author),
            searchText: normalize(`${raw.title} ${raw.author} ${raw.publisher} ${raw.notes}`),
            palette: PALETTES[h % PALETTES.length],
            pattern: PATTERNS[(h >>> 8) % PATTERNS.length],
        };
    });

    // Unify author spellings ("Stefan Zweig" / "Stefan Zweıg") — prefer the dotted-i variant
    const dotCount = (s) => (s.match(/i/g) || []).length;
    const canonicalAuthor = new Map();
    books.forEach((b) => {
        const best = canonicalAuthor.get(b.authorKey);
        if (!best || dotCount(b.author) > dotCount(best)) canonicalAuthor.set(b.authorKey, b.author);
    });
    books.forEach((b) => { b.author = canonicalAuthor.get(b.authorKey) || b.author; });

    const byId = new Map(books.map((b) => [b.id, b]));

    const matchesFilter = (book, filter) => {
        const { ibrahim, esra } = book.reads;
        switch (filter) {
            case 'ibrahim': return Boolean(ibrahim);
            case 'esra': return Boolean(esra);
            case 'both': return Boolean(ibrahim && esra);
            case 'unread': return !ibrahim && !esra;
            default: return true;
        }
    };

    const collator = new Intl.Collator(LOCALE, { sensitivity: 'base', numeric: true });
    const SORTERS = {
        shelf: (a, b) => a.id - b.id,
        recent: (a, b) => b.lastRead - a.lastRead || a.id - b.id,
        title: (a, b) => collator.compare(a.title, b.title),
        author: (a, b) => collator.compare(a.author, b.author) || collator.compare(a.title, b.title),
        'pages-desc': (a, b) => (b.pages ?? -1) - (a.pages ?? -1),
        'pages-asc': (a, b) => (a.pages ?? Infinity) - (b.pages ?? Infinity),
    };

    // ------------------------------------------------------------------
    // State (synced with the URL so every view is shareable)
    // ------------------------------------------------------------------
    const params = new URLSearchParams(location.search);
    const state = {
        query: params.get('q') ?? '',
        filter: FILTERS.some((f) => f.id === params.get('reader')) ? params.get('reader') : 'all',
        sort: params.get('sort') in SORTERS ? params.get('sort') : 'shelf',
        view: params.get('view') === 'list' ? 'list' : (localStorage.getItem('library-view') || 'grid'),
        results: [],
        rendered: 0,
    };

    const syncUrl = () => {
        const p = new URLSearchParams();
        if (state.query) p.set('q', state.query);
        if (state.filter !== 'all') p.set('reader', state.filter);
        if (state.sort !== 'shelf') p.set('sort', state.sort);
        if (state.view !== 'grid') p.set('view', state.view);
        const qs = p.toString();
        history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
    };

    // ------------------------------------------------------------------
    // Templates
    // ------------------------------------------------------------------
    const coverHtml = (book, size = '') => {
        const [bg, fg, accent] = book.palette;
        return `
            <div class="cover cover--${book.pattern} ${size}" style="--bg:${bg};--fg:${fg};--accent:${accent}" aria-hidden="true">
                <div class="cover-art"></div>
                <div class="cover-text">
                    <span class="cover-title">${escapeHtml(book.title)}</span>
                    <span class="cover-author">${escapeHtml(book.author)}</span>
                </div>
            </div>`;
    };

    const readerBadges = (book) =>
        Object.entries(READERS)
            .map(([id, r]) => {
                const read = book.reads[id];
                const label = read ? `${r.name} read this${read.date ? ` on ${formatDate(read.date)}` : ''}` : `${r.name} hasn't read this yet`;
                return `<span class="badge badge-${id} ${read ? 'is-read' : ''}" title="${escapeHtml(label)}"><span class="sr-only">${escapeHtml(label)}</span><span aria-hidden="true">${r.initial}</span></span>`;
            })
            .join('');

    const bookCardHtml = (book, i) => `
        <article class="book" style="--i:${i % PAGE_SIZE}">
            <button type="button" class="book-hit" data-id="${book.id}" aria-label="${escapeHtml(`${book.title} by ${book.author}`)}">
                ${coverHtml(book)}
                <div class="book-info">
                    <h3 class="book-title">${escapeHtml(book.title)}</h3>
                    <p class="book-author">${escapeHtml(book.author)}</p>
                    <div class="book-foot">
                        <span class="badges">${readerBadges(book)}</span>
                        ${book.pages ? `<span class="book-pages">${book.pages} pp</span>` : ''}
                    </div>
                </div>
            </button>
        </article>`;

    const describeRead = (read) => {
        if (!read) return 'Not read yet';
        if (read.date) return `Finished ${formatDate(read.date)}`;
        if (/^\d{4}$/.test(read.raw)) return `Finished in ${read.raw}`;
        return 'Finished · date unknown';
    };

    const readRowHtml = (id) => {
        const r = READERS[id];
        return (book) => {
            const read = book.reads[id];
            return `
                <div class="read-row ${read ? 'is-read' : ''}">
                    <span class="badge badge-${id} ${read ? 'is-read' : ''}" aria-hidden="true">${r.initial}</span>
                    <div>
                        <strong>${r.name}</strong>
                        <span>${escapeHtml(describeRead(read))}</span>
                    </div>
                </div>`;
        };
    };

    const modalHtml = (book) => {
        const more = books.filter((b) => b.authorKey === book.authorKey && b.id !== book.id).slice(0, 6);
        return `
            <div class="modal-cover">${coverHtml(book, 'cover--lg')}</div>
            <div class="modal-content">
                <p class="eyebrow">${book.pages ? `${book.pages} pages` : 'Book'}${book.publisher ? ` · ${escapeHtml(book.publisher)}` : ''}</p>
                <h2 id="modalTitle" class="modal-title">${escapeHtml(book.title)}</h2>
                <button type="button" class="modal-author" data-author="${escapeHtml(book.author)}">by ${escapeHtml(book.author)}</button>

                <div class="read-rows">
                    ${readRowHtml('ibrahim')(book)}
                    ${readRowHtml('esra')(book)}
                </div>

                ${book.notes ? `<blockquote class="note">${escapeHtml(book.notes)}</blockquote>` : ''}

                ${more.length ? `
                    <div class="more">
                        <h3>More by this author</h3>
                        <ul>${more.map((b) => `<li><button type="button" data-id="${b.id}">${escapeHtml(b.title)}</button></li>`).join('')}</ul>
                    </div>` : ''}
            </div>`;
    };

    // ------------------------------------------------------------------
    // Rendering: stats & insights
    // ------------------------------------------------------------------
    const countUp = (el, target, duration = 1100) => {
        if (prefersReducedMotion) { el.textContent = numberFmt.format(target); return; }
        const start = performance.now();
        const tick = (now) => {
            const p = Math.min(1, (now - start) / duration);
            const eased = 1 - Math.pow(1 - p, 4);
            el.textContent = numberFmt.format(Math.round(target * eased));
            if (p < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    };

    function renderStats() {
        const total = books.length;
        const ibrahim = books.filter((b) => b.reads.ibrahim).length;
        const esra = books.filter((b) => b.reads.esra).length;
        const both = books.filter((b) => b.reads.ibrahim && b.reads.esra).length;
        const pages = books.reduce((sum, b) => sum + (b.pages ?? 0), 0);
        const pct = (n) => (total ? Math.round((n / total) * 100) : 0);

        const cards = [
            { label: 'Books on the shelf', value: total, sub: `${numberFmt.format(pages)} pages in total` },
            { label: 'Read by İbrahim', value: ibrahim, pct: pct(ibrahim), tone: 'ibrahim' },
            { label: 'Read by Esra', value: esra, pct: pct(esra), tone: 'esra' },
            { label: 'Read together', value: both, pct: pct(both), tone: 'both' },
        ];

        $('#libraryStats').innerHTML = cards.map((c, i) => `
            <div class="stat reveal" style="--d:${i * 80}ms">
                <span class="stat-label">${c.label}</span>
                <span class="stat-value" data-count="${c.value}">0</span>
                ${c.pct !== undefined
                    ? `<div class="meter meter-${c.tone}" role="progressbar" aria-valuenow="${c.pct}" aria-valuemin="0" aria-valuemax="100" aria-label="${c.label}: ${c.pct}%"><span style="--w:${c.pct}%"></span></div>
                       <span class="stat-sub">${c.pct}% of the library</span>`
                    : `<span class="stat-sub">${c.sub}</span>`}
            </div>`).join('');

        $$('#libraryStats [data-count]').forEach((el) => countUp(el, Number(el.dataset.count)));
        countUp($('#heroCount'), total, 900);
    }

    function renderYearChart() {
        const counts = new Map();
        books.forEach((b) => {
            for (const id of Object.keys(READERS)) {
                const d = b.reads[id]?.date;
                if (!d) continue;
                const y = d.getFullYear();
                if (!counts.has(y)) counts.set(y, { ibrahim: 0, esra: 0 });
                counts.get(y)[id]++;
            }
        });
        const el = $('#yearChart');
        if (!counts.size) { el.innerHTML = '<p class="muted">No reading dates yet.</p>'; return; }

        // Show a continuous range of the most recent 12 years with data
        const years = [...counts.keys()].sort((a, b) => a - b);
        const last = years[years.length - 1];
        const first = Math.max(years[0], last - 11);
        const range = Array.from({ length: last - first + 1 }, (_, i) => first + i);
        const max = Math.max(...range.map((y) => Math.max(counts.get(y)?.ibrahim ?? 0, counts.get(y)?.esra ?? 0)), 1);

        el.innerHTML = `
            <div class="bars" style="--cols:${range.length}">
                ${range.map((y) => {
                    const c = counts.get(y) ?? { ibrahim: 0, esra: 0 };
                    return `
                        <div class="bar-group" tabindex="0" aria-label="${y}: İbrahim ${c.ibrahim}, Esra ${c.esra}">
                            <div class="bar-pair">
                                <span class="bar bar-ibrahim" style="--h:${(c.ibrahim / max) * 100}%"></span>
                                <span class="bar bar-esra" style="--h:${(c.esra / max) * 100}%"></span>
                            </div>
                            <span class="bar-label">’${String(y).slice(2)}</span>
                            <span class="bar-tip">${y}<br><b>${c.ibrahim}</b> İbrahim · <b>${c.esra}</b> Esra</span>
                        </div>`;
                }).join('')}
            </div>`;
    }

    function renderTopAuthors() {
        const groups = new Map();
        books.forEach((b) => {
            if (!b.authorKey) return;
            const g = groups.get(b.authorKey) ?? { name: b.author, count: 0, read: 0 };
            g.count++;
            if (b.reads.ibrahim || b.reads.esra) g.read++;
            groups.set(b.authorKey, g);
        });
        const top = [...groups.values()].sort((a, b) => b.count - a.count || collator.compare(a.name, b.name)).slice(0, 7);
        const max = top[0]?.count ?? 1;
        $('#topAuthors').innerHTML = top.map((a) => `
            <li>
                <button type="button" class="rank" data-author="${escapeHtml(a.name)}">
                    <span class="rank-name">${escapeHtml(a.name)}</span>
                    <span class="rank-count">${a.count}</span>
                    <span class="rank-bar"><span style="--w:${(a.count / max) * 100}%"></span><span class="rank-read" style="--w:${(a.read / max) * 100}%"></span></span>
                </button>
            </li>`).join('');
    }

    function renderRecent() {
        const events = [];
        books.forEach((b) => {
            for (const id of Object.keys(READERS)) {
                const d = b.reads[id]?.date;
                if (d) events.push({ book: b, reader: id, date: d });
            }
        });
        events.sort((a, b) => b.date - a.date);
        const recent = events.slice(0, 10);
        $('#recentMeta').textContent = recent.length ? `Last update ${formatDate(recent[0].date)}` : '';
        $('#recentReads').innerHTML = recent.map((e) => `
            <button type="button" class="recent" data-id="${e.book.id}">
                ${coverHtml(e.book, 'cover--sm')}
                <span class="recent-title">${escapeHtml(e.book.title)}</span>
                <span class="recent-meta"><span class="badge badge-${e.reader} is-read" aria-hidden="true">${READERS[e.reader].initial}</span>${formatDate(e.date)}</span>
            </button>`).join('');
    }

    // ------------------------------------------------------------------
    // Rendering: shelf (incremental, IntersectionObserver-driven)
    // ------------------------------------------------------------------
    const shelf = $('#bookShelf');
    const sentinel = $('#sentinel');
    const resultsInfo = $('#resultsInfo');
    const noResults = $('#noResults');
    const searchInput = $('#searchInput');
    const sortSelect = $('#sortSelect');
    const chipsEl = $('#readerFilter');

    function renderChips() {
        const q = normalize(state.query);
        const base = q ? books.filter((b) => b.searchText.includes(q)) : books;
        chipsEl.innerHTML = FILTERS.map((f) => {
            const count = base.filter((b) => matchesFilter(b, f.id)).length;
            const active = state.filter === f.id;
            return `<button type="button" class="chip ${active ? 'is-active' : ''}" role="radio" aria-checked="${active}" data-filter="${f.id}">${f.label}<span class="chip-count">${count}</span></button>`;
        }).join('');
    }

    function renderMore() {
        const next = state.results.slice(state.rendered, state.rendered + PAGE_SIZE);
        if (!next.length) return;
        shelf.insertAdjacentHTML('beforeend', next.map((b, i) => bookCardHtml(b, state.rendered + i)).join(''));
        state.rendered += next.length;
        sentinel.hidden = state.rendered >= state.results.length;
    }

    function applyFilters() {
        const terms = normalize(state.query).split(' ').filter(Boolean);
        state.results = books
            .filter((b) => matchesFilter(b, state.filter) && terms.every((t) => b.searchText.includes(t)))
            .sort(SORTERS[state.sort]);
        state.rendered = 0;
        shelf.innerHTML = '';
        renderMore();

        const n = state.results.length;
        const filtered = n !== books.length;
        resultsInfo.innerHTML = filtered
            ? `Showing <strong>${n}</strong> of ${books.length} books${state.query ? ` for “${escapeHtml(state.query)}”` : ''}`
            : `All <strong>${n}</strong> books`;
        noResults.classList.toggle('hidden', n > 0);
        renderChips();
        syncUrl();
    }

    function setView(view) {
        state.view = view;
        shelf.dataset.view = view;
        localStorage.setItem('library-view', view);
        $$('.view-toggle [data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
        syncUrl();
    }

    function searchFor(text) {
        state.query = text;
        searchInput.value = text;
        state.filter = 'all';
        closeModal();
        applyFilters();
        $('#shelf').scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth' });
    }

    // ------------------------------------------------------------------
    // Modal
    // ------------------------------------------------------------------
    const modal = $('#bookModal');
    const modalBody = $('#modalBody');
    let lastFocus = null;

    function openBook(id) {
        const book = byId.get(Number(id));
        if (!book) return;
        modalBody.innerHTML = modalHtml(book);
        modalBody.scrollTop = 0;
        if (!modal.open) {
            lastFocus = document.activeElement;
            modal.showModal();
            document.body.classList.add('no-scroll');
        }
    }

    function closeModal() {
        if (!modal.open) return;
        modal.close();
    }

    modal.addEventListener('close', () => {
        document.body.classList.remove('no-scroll');
        lastFocus?.focus?.({ preventScroll: true });
    });
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal(); // backdrop click
        const idBtn = e.target.closest('[data-id]');
        if (idBtn) openBook(idBtn.dataset.id);
        const authorBtn = e.target.closest('[data-author]');
        if (authorBtn) searchFor(authorBtn.dataset.author);
    });
    $('#modalClose').addEventListener('click', closeModal);

    // ------------------------------------------------------------------
    // Theme
    // ------------------------------------------------------------------
    $('#themeToggle').addEventListener('click', () => {
        const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
        const apply = () => {
            document.documentElement.dataset.theme = next;
            localStorage.setItem('library-theme', next);
        };
        if (document.startViewTransition && !prefersReducedMotion) document.startViewTransition(apply);
        else apply();
    });

    // ------------------------------------------------------------------
    // Events
    // ------------------------------------------------------------------
    searchInput.value = state.query;
    sortSelect.value = state.sort;

    searchInput.addEventListener('input', debounce(() => {
        state.query = searchInput.value.trim();
        applyFilters();
    }));

    chipsEl.addEventListener('click', (e) => {
        const chip = e.target.closest('[data-filter]');
        if (!chip) return;
        state.filter = chip.dataset.filter;
        applyFilters();
    });

    // Arrow-key navigation inside the radiogroup
    chipsEl.addEventListener('keydown', (e) => {
        if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
        const idx = FILTERS.findIndex((f) => f.id === state.filter);
        const next = FILTERS[(idx + (e.key === 'ArrowRight' ? 1 : FILTERS.length - 1)) % FILTERS.length];
        state.filter = next.id;
        applyFilters();
        chipsEl.querySelector(`[data-filter="${next.id}"]`)?.focus();
    });

    sortSelect.addEventListener('change', () => {
        state.sort = sortSelect.value;
        applyFilters();
    });

    $$('.view-toggle [data-view]').forEach((btn) => btn.addEventListener('click', () => setView(btn.dataset.view)));

    $('#randomBtn').addEventListener('click', () => {
        const pool = state.results.length ? state.results : books;
        const unread = pool.filter((b) => !b.reads.ibrahim && !b.reads.esra);
        const pick = (unread.length ? unread : pool)[Math.floor(Math.random() * (unread.length || pool.length))];
        if (pick) openBook(pick.id);
    });

    $('#clearFilters').addEventListener('click', () => {
        state.query = '';
        state.filter = 'all';
        searchInput.value = '';
        applyFilters();
        searchInput.focus();
    });

    document.addEventListener('click', (e) => {
        if (modal.contains(e.target)) return;
        const idBtn = e.target.closest('[data-id]');
        if (idBtn) return openBook(idBtn.dataset.id);
        const authorBtn = e.target.closest('[data-author]');
        if (authorBtn) searchFor(authorBtn.dataset.author);
    });

    document.addEventListener('keydown', (e) => {
        const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
        if ((e.key === '/' && !typing) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) {
            e.preventDefault();
            searchInput.focus();
            searchInput.select();
        } else if (e.key === 'Escape' && document.activeElement === searchInput && searchInput.value) {
            searchInput.value = '';
            state.query = '';
            applyFilters();
        }
    });

    // Infinite scroll
    new IntersectionObserver((entries) => {
        if (entries.some((en) => en.isIntersecting)) renderMore();
    }, { rootMargin: '800px 0px' }).observe(sentinel);

    // Sticky toolbar shadow
    const toolbar = $('#toolbar');
    const stickyProbe = document.createElement('div');
    toolbar.before(stickyProbe);
    new IntersectionObserver(([en]) => toolbar.classList.toggle('is-stuck', !en.isIntersecting), { rootMargin: '-65px 0px 0px 0px' }).observe(stickyProbe);

    // Scroll-reveal for sections
    const revealObserver = new IntersectionObserver((entries) => {
        entries.forEach((en) => {
            if (en.isIntersecting) {
                en.target.classList.add('is-visible');
                revealObserver.unobserve(en.target);
            }
        });
    }, { threshold: 0.12 });

    // ------------------------------------------------------------------
    // Boot
    // ------------------------------------------------------------------
    renderStats();
    renderYearChart();
    renderTopAuthors();
    renderRecent();
    setView(state.view);
    applyFilters();
    $$('.reveal').forEach((el) => revealObserver.observe(el));
    document.documentElement.classList.add('is-ready');
})();
