/**
 * Label Studio — generates print-ready A4 sheets of library labels.
 * Uses `window.Catalog` (catalog.js) and `window.Codes` (codes.js).
 */
(() => {
    'use strict';

    const { books, byNo, nextNo, pad, escapeHtml, normalize, bookUrl } = window.Catalog;
    const { qrSvg, code128Svg } = window.Codes;

    const TEMPLATES = {
        combo: { perPage: 14, name: 'Bookplate + Spine' },
        bookplate: { perPage: 24, name: 'Ex-Libris & QR' },
        spine: { perPage: 49, name: 'Spine Only' },
        card: { perPage: 4, name: 'Library Card' },
    };

    const $ = (sel, root = document) => root.querySelector(sel);
    const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

    // ------------------------------------------------------------------
    // State
    // ------------------------------------------------------------------
    const params = new URLSearchParams(location.search);
    const selectedParam = (params.get('select') || '')
        .split(',')
        .map((n) => Number.parseInt(n, 10))
        .filter((n) => byNo.has(n));

    const initialSelection = selectedParam.length
        ? selectedParam
        : books.slice(-14).map((b) => b.no);

    const state = {
        template: 'combo',
        owner: 'İbrahim & Esra Kitaplığı',
        offset: 0,
        showQr: true,
        showBarcode: true,
        showColor: true,
        showCut: true,
        query: '',
        selected: new Set(initialSelection),
    };

    // ------------------------------------------------------------------
    // Label renderers
    // ------------------------------------------------------------------
    const spineInner = (book) => {
        const p = book.callParts;
        const sub = [p.volume, p.copy].filter(Boolean).join(' ');
        return `
            <div class="lbl-spine">
                <div class="lbl-spine-band">${escapeHtml(book.category.classKey)}</div>
                <div class="lbl-spine-call">
                    <span class="lbl-spine-cls">${escapeHtml(p.cls)}</span>
                    <span class="lbl-spine-cut">${escapeHtml(p.cutter)}</span>
                    ${p.letter ? `<span class="lbl-spine-let">${escapeHtml(p.letter)}</span>` : ''}
                    ${sub ? `<span class="lbl-spine-sub">${escapeHtml(sub)}</span>` : ''}
                </div>
                <div class="lbl-spine-foot">#${book.accession}</div>
            </div>`;
    };

    const renderLabel = (book) => {
        const color = book.category.color;
        const qr = state.showQr ? qrSvg(bookUrl(book), { margin: 1, className: 'lbl-qr' }) : '';
        const bc = state.showBarcode ? code128Svg(book.accession, { height: 28, className: 'lbl-bc', quiet: 6 }) : '';
        const owner = escapeHtml(state.owner || 'Our Library');

        switch (state.template) {
            case 'spine':
                return `<div class="lbl" style="--c:${color}">${spineInner(book)}</div>`;

            case 'bookplate':
                return `
                    <div class="lbl lbl-bookplate" style="--c:${color}">
                        <div class="lbl-owner">
                            <span>${owner}</span>
                            <span class="lbl-acc">#${book.accession}</span>
                        </div>
                        <div>
                            <div class="lbl-book-title">${escapeHtml(book.title)}</div>
                            <div class="lbl-book-author">${escapeHtml(book.author)}</div>
                        </div>
                        <div class="lbl-combo-foot">
                            <div class="lbl-bc-wrap">
                                ${bc}
                                <span class="lbl-call-inline">${escapeHtml(book.callNumber)}</span>
                            </div>
                            ${qr}
                        </div>
                    </div>`;

            case 'card': {
                const sub = [book.publisher, book.year, book.pages ? `${book.pages} pp` : ''].filter(Boolean).join(' · ');
                const rows = '<tr><td></td><td></td><td></td></tr>'.repeat(9);
                return `
                    <div class="lbl lbl-card" style="--c:${color}">
                        <div class="lbl-card-head">
                            <div class="lbl-card-top">
                                <span>${escapeHtml(book.callNumber)}</span>
                                <span>#${book.accession}</span>
                            </div>
                            <div class="lbl-card-title">${escapeHtml(book.title)}</div>
                            <div class="lbl-card-author">${escapeHtml(book.author)}</div>
                            ${sub ? `<div class="lbl-card-meta">${escapeHtml(sub)}</div>` : ''}
                        </div>
                        <table class="lbl-card-table" aria-hidden="true">
                            <thead><tr><th>Ödünç Alan</th><th>Alış</th><th>İade</th></tr></thead>
                            <tbody>${rows}</tbody>
                        </table>
                        <div class="lbl-card-foot">
                            <div class="lbl-bc-wrap">
                                ${bc}
                                <span class="lbl-call-inline">${owner}</span>
                            </div>
                            ${qr}
                        </div>
                    </div>`;
            }

            case 'combo':
            default:
                return `
                    <div class="lbl lbl-combo" style="--c:${color}">
                        <div class="lbl-combo-main">
                            <div class="lbl-owner">
                                <span>${owner}</span>
                                <span class="lbl-acc">#${book.accession}</span>
                            </div>
                            <div>
                                <div class="lbl-book-title">${escapeHtml(book.title)}</div>
                                <div class="lbl-book-author">${escapeHtml(book.author)}</div>
                            </div>
                            <div class="lbl-combo-foot">
                                <div class="lbl-bc-wrap">
                                    ${bc}
                                    <span class="lbl-call-inline">${escapeHtml(book.callNumber)}</span>
                                </div>
                                ${qr}
                            </div>
                        </div>
                        ${spineInner(book)}
                    </div>`;
        }
    };

    // ------------------------------------------------------------------
    // Render sheets & picker
    // ------------------------------------------------------------------
    const sheetsEl = $('#sheetsContainer');
    const pickerEl = $('#pickerList');

    function renderSheets() {
        const chosen = books.filter((b) => state.selected.has(b.no));
        const tpl = TEMPLATES[state.template];
        $('#selectedCount').textContent = chosen.length;

        if (!chosen.length) {
            $('#sheetSummary').textContent = '0 labels · 0 A4 pages';
            sheetsEl.innerHTML = '<div class="empty-stage"><p>Select at least one book on the left to preview its A4 sheet.</p></div>';
            return;
        }

        const blanks = Array.from({ length: Math.max(0, state.offset) }, () => '<div class="lbl lbl-blank" aria-hidden="true"></div>');
        const cells = [...blanks, ...chosen.map(renderLabel)];
        const pages = [];
        for (let i = 0; i < cells.length; i += tpl.perPage) {
            pages.push(cells.slice(i, i + tpl.perPage));
        }

        const flags = [
            state.showCut ? 'show-cut' : '',
            state.showColor ? '' : 'hide-color',
            state.showQr ? '' : 'hide-qr',
            state.showBarcode ? '' : 'hide-barcode',
        ].filter(Boolean).join(' ');

        sheetsEl.innerHTML = pages
            .map((page) => `<section class="sheet sheet--${state.template} ${flags}" aria-label="A4 label sheet">${page.join('')}</section>`)
            .join('');

        $('#sheetSummary').textContent = `${chosen.length} label${chosen.length === 1 ? '' : 's'} · ${pages.length} A4 page${pages.length === 1 ? '' : 's'}`;
    }

    function renderPicker() {
        const terms = normalize(state.query).split(' ').filter(Boolean);
        const list = terms.length
            ? books.filter((b) => terms.every((t) => b.searchText.includes(t)))
            : books;

        pickerEl.innerHTML = list
            .map((b) => {
                const active = state.selected.has(b.no);
                return `
                    <button type="button" class="pick-item ${active ? 'is-selected' : ''}" data-no="${b.no}" role="option" aria-selected="${active}">
                        <span class="pick-check" aria-hidden="true">${active ? '✓' : ''}</span>
                        <span class="pick-main">
                            <span class="pick-title">${escapeHtml(b.title)}</span>
                            <span class="pick-sub">${escapeHtml(b.author)} · ${escapeHtml(b.callNumber)}</span>
                        </span>
                        <span class="pick-no">#${b.accession}</span>
                    </button>`;
            })
            .join('');
    }

    // ------------------------------------------------------------------
    // Events
    // ------------------------------------------------------------------
    $('#nextNoBadge').textContent = `#${pad(nextNo)}`;

    $('#templatePicker').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-tpl]');
        if (!btn) return;
        state.template = btn.dataset.tpl;
        $$('#templatePicker [data-tpl]').forEach((b) => {
            const on = b === btn;
            b.classList.toggle('is-active', on);
            b.setAttribute('aria-checked', String(on));
        });
        renderSheets();
    });

    $('#ownerInput').addEventListener('input', (e) => {
        state.owner = e.target.value;
        renderSheets();
    });

    $('#offsetInput').addEventListener('input', (e) => {
        state.offset = Math.max(0, Math.min(48, Number.parseInt(e.target.value, 10) || 0));
        renderSheets();
    });

    const bindToggle = (id, key) => {
        $(id).addEventListener('change', (e) => {
            state[key] = e.target.checked;
            renderSheets();
        });
    };
    bindToggle('#optQr', 'showQr');
    bindToggle('#optBarcode', 'showBarcode');
    bindToggle('#optColor', 'showColor');
    bindToggle('#optCut', 'showCut');

    $('#pickerSearch').addEventListener('input', (e) => {
        state.query = e.target.value.trim();
        renderPicker();
    });

    pickerEl.addEventListener('click', (e) => {
        const item = e.target.closest('[data-no]');
        if (!item) return;
        const no = Number(item.dataset.no);
        if (state.selected.has(no)) state.selected.delete(no);
        else state.selected.add(no);
        const on = state.selected.has(no);
        item.classList.toggle('is-selected', on);
        item.setAttribute('aria-selected', String(on));
        item.querySelector('.pick-check').textContent = on ? '✓' : '';
        renderSheets();
    });

    $('#selLatest').addEventListener('click', () => {
        state.selected = new Set(books.slice(-14).map((b) => b.no));
        renderPicker();
        renderSheets();
    });
    $('#selAll').addEventListener('click', () => {
        state.selected = new Set(books.map((b) => b.no));
        renderPicker();
        renderSheets();
    });
    $('#selNone').addEventListener('click', () => {
        state.selected.clear();
        renderPicker();
        renderSheets();
    });
    $('#selRange').addEventListener('click', () => {
        const from = Number.parseInt($('#rangeFrom').value, 10) || 1;
        const to = Number.parseInt($('#rangeTo').value, 10) || nextNo - 1;
        const lo = Math.min(from, to);
        const hi = Math.max(from, to);
        books.forEach((b) => { if (b.no >= lo && b.no <= hi) state.selected.add(b.no); });
        renderPicker();
        renderSheets();
    });

    $('#printBtn').addEventListener('click', () => window.print());

    $('#themeToggle').addEventListener('click', () => {
        const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
        document.documentElement.dataset.theme = next;
        localStorage.setItem('library-theme', next);
    });

    // ------------------------------------------------------------------
    // Boot
    // ------------------------------------------------------------------
    renderPicker();
    renderSheets();
})();
