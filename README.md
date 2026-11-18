# Our Digital Library 📚

A personal library of 470+ books, built for İbrahim and Esra to keep track of what they own, what they've read, and when.

**🌐 Live:** [cevherk.github.io/library](https://cevherk.github.io/library/)

## ✨ Features

- **Generated book covers** — every book gets its own cover, picked from a set of palettes and patterns based on its title, so it looks the same on every visit.
- **Reading insights** — books finished per year, most collected authors, and recently finished books.
- **Fast search** — handles Turkish characters and ignores accents (`zweig` finds *ZWEİG*, `ciftlik` finds *ÇİFTLİK*), and lets you search several words at once.
- **Filters & sorting** — filter by reader (İbrahim, Esra, Together, Unread) with live counts; sort by title, author, length or most recently read.
- **Grid & list views**, plus a **"Surprise me"** button that picks a random unread book.
- **Book details** — a dialog showing who read the book and when, any notes, and other books by the same author.
- **Shareable links** — search, filter, sort and view are saved in the URL.
- **Dark mode** — follows your system setting by default, and remembers your choice.
- **Accessible & responsive** — works with the keyboard (`/` or `⌘K` jumps to search, `Esc` clears it), has ARIA labels, and respects `prefers-reduced-motion`.
- **Performance** — books load in batches as you scroll, and the data is prepared once when the page loads.

## 📖 Adding a Book

Open `data.js` and add an object to the `libraryData` array:

```javascript
{
    "title": "YÜZ YILLIK YALNIZLIK",
    "author": "GABRIEL GARCIA MARQUEZ",
    "pages": "461",
    "publisher": "Can Yayınları",
    "ibrahimRead": "14.11.2025",   // dd.mm.yyyy — leave empty if not read yet
    "esraRead": "",
    "notes": "Special edition"
}
```

Titles and names can be written in any case. The site displays them in title case, handling Turkish letters correctly.

## 🛠 Tech

Plain HTML, CSS and JavaScript — no frameworks, no build step, no dependencies.

- CSS custom properties for theming, plus Grid, container queries and `color-mix()`
- Native `<dialog>`, `IntersectionObserver`, `Intl` APIs and the View Transitions API
- Static hosting on GitHub Pages

## 📄 License

MIT — see [LICENSE](LICENSE).
