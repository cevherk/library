/**
 * Catalog — shared data layer for the library site and the label maker.
 * Turns the raw `libraryData` (data.js) into normalised book records:
 * Turkish-aware casing, DDC categories, generated call numbers, copy numbers
 * and parsed reading dates. No dependencies; exposes `window.Catalog`.
 */
(function (global) {
    'use strict';

    const LOCALE = 'tr';
    const SITE_URL = 'https://cevherk.github.io/library/';
    const OWNER = 'İbrahim & Esra';

    // ------------------------------------------------------------------
    // Classification — a home-library profile of the Dewey Decimal system
    // ------------------------------------------------------------------
    /** Main classes (first digit) with library-style colour coding. */
    const CLASSES = {
        '0': { name: 'Computing & general', color: '#5e6b7a' },
        '1': { name: 'Philosophy & psychology', color: '#6d4c8d' },
        '2': { name: 'Religion', color: '#8a6d3b' },
        '3': { name: 'Social sciences', color: '#2f7f7a' },
        '4': { name: 'Language', color: '#c08a2e' },
        '5': { name: 'Science', color: '#4f8a3c' },
        '6': { name: 'Applied sciences', color: '#2f6f8f' },
        '7': { name: 'Arts & recreation', color: '#c0577a' },
        '8': { name: 'Literature', color: '#b4532a' },
        '9': { name: 'History & biography', color: '#7a5235' },
        'Ç': { name: 'Children', color: '#d9a21b' },
    };

    const CATEGORIES = {
        '004': 'Computing & software',
        '100': 'Philosophy',
        '150': 'Psychology',
        '158': 'Self-improvement',
        '200': 'Religion',
        '300': 'Social sciences',
        '320': 'Politics',
        '330': 'Economics & finance',
        '340': 'Law',
        '428': 'English readers',
        '494.35': 'Turkish language',
        '500': 'Science & mathematics',
        '610': 'Health & family',
        '658': 'Business & management',
        '700': 'Arts & recreation',
        '810': 'American literature',
        '820': 'English literature',
        '830': 'German literature',
        '840': 'French literature',
        '850': 'Italian literature',
        '860': 'Spanish & Portuguese literature',
        '880': 'Classical literature',
        '890': 'Other world literature',
        '891.7': 'Russian literature',
        '894.35': 'Turkish literature',
        '900': 'History',
        '920': 'Biography & memoir',
        '956.1': 'Turkish history',
        'Ç': "Children's books",
    };

    const categoryInfo = (code) => {
        const key = String(code ?? '').trim();
        const cls = CLASSES[key.charAt(0)] ?? { name: 'Unclassified', color: '#93877c' };
        return {
            code: key,
            name: CATEGORIES[key] ?? (key ? `Class ${key}` : 'Unclassified'),
            classKey: key.charAt(0) || '?',
            className: cls.name,
            color: cls.color,
        };
    };

    // ------------------------------------------------------------------
    // Text helpers
    // ------------------------------------------------------------------
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

    const SMALL_WORDS = new Set(['ve', 'ile', 'ya', 'da', 'de', 'ki', 'mi', 'veya', 'of', 'the', 'and', 'a', 'an', 'in', 'on', 'to']);
    const ROMAN = /^(ii|iii|iv|vi|vii|viii|ix|xi|xii)$/i;

    /** "HARRY POTTER VE SIRLAR ODASI" -> "Harry Potter ve Sırlar Odası" */
    const titleCase = (value) => {
        const lower = String(value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase(LOCALE);
        let wordIndex = 0;
        return lower.replace(/\p{L}+/gu, (word, offset, full) => {
            const prev = full[offset - 1];
            const isFirst = wordIndex++ === 0;
            if (prev === "'" || prev === '’') return word;
            if (ROMAN.test(word)) return word.toLocaleUpperCase(LOCALE);
            if (!isFirst && SMALL_WORDS.has(word) && prev === ' ') return word;
            return word.charAt(0).toLocaleUpperCase(LOCALE) + word.slice(1);
        });
    };

    const pad = (n, len = 4) => String(n ?? '').padStart(len, '0');

    // ------------------------------------------------------------------
    // Dates
    // ------------------------------------------------------------------
    const dateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    const formatDate = (date) => (date ? dateFmt.format(date) : '');

    const parseDate = (value) => {
        const m = String(value ?? '').match(/(\d{1,2})\D+(\d{1,2})\D*(\d{4})/) || String(value ?? '').match(/^(\d{2})(\d{2})(\d{4})$/);
        if (!m) return null;
        const [, d, mo, y] = m.map(Number);
        const date = new Date(y, mo - 1, d);
        return Number.isNaN(date.getTime()) || date.getMonth() !== mo - 1 ? null : date;
    };

    /**
     * Reading status: "18.04.2022" (exact), "2021" (year only) or any other
     * non-empty text such as "Okundu" (read, date unknown).
     */
    const parseRead = (value) => {
        const raw = String(value ?? '').trim();
        if (!raw) return null;
        const date = parseDate(raw);
        if (date) return { raw, date, year: date.getFullYear(), precision: 'day', sortKey: date.getTime() };
        const y = raw.match(/^(\d{4})$/);
        if (y) return { raw, date: null, year: Number(y[1]), precision: 'year', sortKey: new Date(Number(y[1]), 0, 1).getTime() };
        return { raw, date: null, year: null, precision: 'unknown', sortKey: 0 };
    };

    const describeRead = (read) => {
        if (!read) return 'Not read yet';
        if (read.precision === 'day') return `Finished ${formatDate(read.date)}`;
        if (read.precision === 'year') return `Finished in ${read.year}`;
        return 'Read · date unknown';
    };

    // ------------------------------------------------------------------
    // Call numbers:  <class> <AUTHOR CUTTER> <title letter> [v.N] [c.N]
    // ------------------------------------------------------------------
    const firstAuthor = (author) => String(author ?? '').split(/\s+(?:ve|and|&)\s+|,|\/|\s+-\s*|\s*-\s+/i)[0];

    /** First three letters of the (first) author's surname: "J.K. ROWLİNG" -> "ROW". */
    const cutter = (author) => {
        const words = firstAuthor(author).replace(/[^\p{L}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
        const surname = words[words.length - 1] || 'XXX';
        return surname.toLocaleUpperCase(LOCALE).slice(0, 3);
    };

    const titleLetter = (title) => {
        const m = String(title ?? '').match(/[\p{L}\p{N}]/u);
        return m ? m[0].toLocaleLowerCase(LOCALE) : '';
    };

    // ------------------------------------------------------------------
    // Cover palettes (deterministic per title)
    // ------------------------------------------------------------------
    const PALETTES = [
        ['#1f3a5f', '#f3e9d2', '#e0a458'], ['#7a2e2e', '#f6ede1', '#e8b86d'], ['#2f4f3e', '#efe6d4', '#c9a66b'],
        ['#e8d9bd', '#2b2420', '#b4532a'], ['#3b2f4a', '#f1e7da', '#d9a5b3'], ['#b4532a', '#fbf3e6', '#2b2420'],
        ['#0f2a2e', '#e6efe9', '#6fb3a9'], ['#d9c3a5', '#3a2a20', '#7a2e2e'], ['#2a2a2a', '#efe9df', '#d4a24c'],
        ['#5c6b4e', '#f4efe2', '#2b2420'], ['#8a5a44', '#f8efe4', '#f0c987'], ['#cfdcd6', '#1f3a3a', '#b4532a'],
    ];
    const PATTERNS = ['band', 'circle', 'frame', 'diagonal', 'dots', 'split'];
    const hash = (str) => {
        let h = 2166136261;
        for (let i = 0; i < str.length; i++) {
            h ^= str.charCodeAt(i);
            h = Math.imul(h, 16777619);
        }
        return h >>> 0;
    };

    // ------------------------------------------------------------------
    // Build records
    // ------------------------------------------------------------------
    // `const libraryData` from data.js lives in the global lexical scope, not on window.
    // eslint-disable-next-line no-undef
    const raw = typeof libraryData !== 'undefined' ? libraryData : [];
    const str = (v) => String(v ?? '').trim();

    const books = raw.map((r, index) => {
        const pages = Number.parseInt(r.pages, 10);
        const reads = { ibrahim: parseRead(r.ibrahimRead), esra: parseRead(r.esraRead) };
        const h = hash(str(r.title) + str(r.author));
        return {
            id: index,
            no: Number.parseInt(r.no, 10) || index + 1,
            rawTitle: str(r.title),
            rawAuthor: str(r.author),
            title: titleCase(r.title),
            author: titleCase(r.author) || 'Unknown author',
            translator: titleCase(r.translator),
            publisher: titleCase(r.publisher),
            year: str(r.year),
            isbn: str(r.isbn),
            pages: Number.isFinite(pages) && pages > 0 ? pages : null,
            language: str(r.language) || 'Türkçe',
            category: categoryInfo(r.category),
            series: titleCase(r.series),
            volume: str(r.volume),
            shelf: str(r.shelf),
            acquired: parseDate(r.acquired),
            status: str(r.status).toLowerCase(),
            loanedTo: titleCase(r.loanedTo),
            loanDate: parseDate(r.loanDate),
            notes: str(r.notes),
            reads,
            lastRead: Math.max(reads.ibrahim?.sortKey ?? 0, reads.esra?.sortKey ?? 0),
            authorKey: normalize(r.author),
            cutter: cutter(r.author),
            letter: titleLetter(r.title),
            callOverride: str(r.callNumber),
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

    // Copy numbers for duplicate holdings (same title + author), in accession order
    const copyKey = (b) => `${normalize(b.rawTitle).replace(/[^\p{L}\p{N}]/gu, '')}|${b.cutter}`;
    const copies = new Map();
    [...books].sort((a, b) => a.no - b.no).forEach((b) => {
        const key = copyKey(b);
        const list = copies.get(key) ?? [];
        list.push(b);
        copies.set(key, list);
    });
    copies.forEach((list) => {
        if (list.length < 2) return;
        list.forEach((b, i) => { b.copy = i + 1; b.copies = list.length; });
    });

    books.forEach((b) => {
        b.author = canonicalAuthor.get(b.authorKey) || b.author;
        const parts = {
            cls: b.category.code || '000',
            cutter: b.cutter,
            letter: b.letter,
            volume: b.volume ? `v.${b.volume}` : '',
            copy: b.copy ? `c.${b.copy}` : '',
        };
        if (b.callOverride) {
            const tokens = b.callOverride.split(/\s+/);
            parts.cls = tokens[0] || parts.cls;
            parts.cutter = tokens[1] || '';
            parts.letter = tokens[2] || '';
            parts.volume = tokens.slice(3).join(' ');
            parts.copy = '';
        }
        b.callParts = parts;
        b.callNumber = [parts.cls, parts.cutter, parts.letter, parts.volume, parts.copy].filter(Boolean).join(' ');
        b.accession = pad(b.no);
        b.onLoan = Boolean(b.loanedTo);
        b.searchText = normalize([
            b.rawTitle, b.rawAuthor, b.publisher, b.translator, b.series, b.notes,
            b.callNumber, b.category.name, b.isbn, `#${b.accession}`, `#${b.no}`, b.loanedTo, b.shelf,
        ].join(' '));
    });

    const byNo = new Map(books.map((b) => [b.no, b]));
    const nextNo = books.reduce((m, b) => Math.max(m, b.no), 0) + 1;

    // Accession numbers must be unique — surface mistakes in the console
    if (byNo.size !== books.length) {
        const seen = new Set();
        books.forEach((b) => { if (seen.has(b.no)) console.warn(`[catalog] Duplicate accession no ${b.no}: ${b.title}`); seen.add(b.no); });
    }

    const collator = new Intl.Collator(LOCALE, { sensitivity: 'base', numeric: true });
    /** Shelf order as in a real library: class, then author cutter, title, volume, copy. */
    const compareCallNumbers = (a, b) => {
        const ca = a.callParts.cls, cb = b.callParts.cls;
        const na = Number.parseFloat(ca), nb = Number.parseFloat(cb);
        const classCmp = Number.isNaN(na) || Number.isNaN(nb) ? collator.compare(ca, cb) : na - nb || collator.compare(ca, cb);
        return classCmp
            || collator.compare(a.callParts.cutter, b.callParts.cutter)
            || collator.compare(a.title, b.title)
            || collator.compare(a.callParts.volume, b.callParts.volume)
            || (a.copy ?? 0) - (b.copy ?? 0)
            || a.no - b.no;
    };

    global.Catalog = {
        LOCALE, SITE_URL, OWNER, CLASSES, CATEGORIES,
        books, byNo, nextNo, collator,
        categoryInfo, compareCallNumbers,
        escapeHtml, normalize, titleCase, pad,
        formatDate, parseDate, parseRead, describeRead,
        bookUrl: (b) => `${SITE_URL}?book=${b.no}`,
    };
})(window);
