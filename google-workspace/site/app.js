/*
 * The Governor: the newspaper's pages, drawn in the reader's browser.
 *
 * The publisher script (google-workspace/publisher/Code.gs) serves this inside Page.html with the
 * site's data: every article's headline, byline, picture and summary, the writers, the print
 * issues and the settings from the Sheet. Article texts arrive one at a time as readers open them.
 * Pictures and PDFs come straight from Google Drive.
 *
 * The markup and class names follow the Astro site this replaced, so the same stylesheet
 * (src/styles/global.css) draws it. Plain JavaScript, no build step: Node runs it in the tests
 * (tests/site-app.test.ts).
 */
(function (global) {
  'use strict';

  const SITE = {
    name: 'The Governor',
    description: "The student newspaper of The Governor's Academy.",
    school: "The Governor's Academy",
    location: 'Byfield, Massachusetts',
    motto: 'Non Sibi Sed Aliis',
    social: [{ label: 'Instagram', handle: '@the.governor.2026', href: 'https://www.instagram.com/the.governor.2026/' }],
  };
  const SECTIONS = [
    { slug: 'news', label: 'News' }, { slug: 'opinion', label: 'Opinion' }, { slug: 'arts', label: 'Arts' },
    { slug: 'sports', label: 'Sports' }, { slug: 'humor-fun', label: 'Humor & Fun' }, { slug: 'people', label: 'People' },
    { slug: 'school-culture', label: 'School Culture' },
  ];
  const MORE = [{ path: '/archives/', label: 'Archives' }, { path: '/about/', label: 'About' }];
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const PAGE_SIZE = 12;
  const ICONS = {
    search: '<circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />',
    menu: '<path d="M3 6h18M3 12h18M3 18h18" />',
    close: '<path d="M5 5l14 14M19 5 5 19" />',
  };

  // ---- small helpers ---------------------------------------------------------------------
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dayOf = (date) => String(date).slice(0, 10);
  function formatDate(date, style) {
    const [y, m, d] = dayOf(date).split('-').map(Number);
    const month = MONTHS[m - 1] || '';
    const name = style === 'short' ? month.slice(0, 3) + (month.length > 3 ? '.' : '') : month;
    return name + ' ' + d + ', ' + y;
  }
  const monthLabel = (ym) => MONTHS[Number(ym.slice(5, 7)) - 1] + ' ' + ym.slice(0, 4);
  function academicYear(date) {
    const y = Number(String(date).slice(0, 4));
    const m = Number(String(date).slice(5, 7));
    return m >= 8 ? y + '-' + (y + 1) : (y - 1) + '-' + y;
  }
  const academicYearLabel = (ay) => ay.slice(0, 4) + '–' + ay.slice(7, 9);
  const sectionLabel = (slug) => (SECTIONS.find((s) => s.slug === slug) || { label: slug }).label;
  const icon = (name) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false" class="icon-' + name + '">' + ICONS[name] + '</svg>';

  /** A picture kept in Google Drive, at a given width (Google resizes it). */
  const driveImage = (id, width) => 'https://lh3.googleusercontent.com/d/' + encodeURIComponent(id) + '=w' + width;
  function picture(img) {
    if (!img || !img.id) return null;
    const widths = [480, 960, 1600].filter((w) => !img.w || w < img.w);
    if (!widths.length || (img.w && widths[widths.length - 1] < img.w && img.w <= 2000)) widths.push(img.w ? Math.min(img.w, 2000) : 1600);
    return {
      src: driveImage(img.id, widths[Math.min(1, widths.length - 1)]),
      srcset: widths.map((w) => driveImage(img.id, w) + ' ' + w + 'w').join(', '),
      large: driveImage(img.id, Math.min(img.w || 2000, 2000)),
      width: img.w || null,
      height: img.h || null,
    };
  }
  /** A print issue's cover: its first page (from the Sheet: Drive draws it from the PDF; from the archive: a page scan). */
  const coverOf = (issue) => picture(issue.cover || (issue.pages || [])[0]);
  const imgTag = (pic, sizes, extra) => '<img src="' + esc(pic.src) + '" srcset="' + esc(pic.srcset) + '" sizes="' + esc(sizes) + '"'
    + (pic.width ? ' width="' + pic.width + '"' : '') + (pic.height ? ' height="' + pic.height + '"' : '') + ' ' + (extra || 'alt="" loading="lazy" decoding="async"') + '>';

  /** The editor's description, or the article's opening words cut at a word boundary. Never generated text. */
  function summary(article, max) {
    max = max || 170;
    if (article.deck) return article.deck;
    let text = '';
    for (const para of article.paras || []) {
      if (text.length >= max || (text.length > 40 && max <= 320)) break;
      text += (text ? ' ' : '') + para;
    }
    if (text.length <= max) return text;
    const cut = text.slice(0, max);
    return cut.slice(0, cut.lastIndexOf(' ')).replace(/[,;:.\-–—]+$/, '') + '…';
  }

  // ---- the site --------------------------------------------------------------------------
  /**
   * data: { articles (newest first), authors, issues, settings, brand }.
   * options.appUrl: the publisher's web address, for links readers open in a new tab or share.
   */
  function createApp(data, options) {
    const appUrl = (options && options.appUrl) || '';
    const articles = data.articles || [];
    const authors = data.authors || {};
    const issues = data.issues || [];
    const settings = data.settings || {};
    const home = settings.homepage || {};
    const siteSettings = settings.site || {};
    const brand = data.brand || {};
    const byId = new Map(articles.map((a) => [a.id, a]));
    const byPath = new Map(articles.map((a) => [a.path, a]));
    const issueById = new Map(issues.map((i) => [i.id, i]));

    const url = (path) => (appUrl ? appUrl + '?p=' + encodeURIComponent(path) : path);
    const link = (path, inner, attrs) => '<a href="' + esc(url(path)) + '" data-route="' + esc(path) + '" target="_top"' + (attrs || '') + '>' + inner + '</a>';
    const external = (href, inner, attrs) => '<a href="' + esc(href) + '" target="_blank" rel="noopener"' + (attrs || '') + '>' + inner + '</a>';
    const authorLabel = (au) => au.name + (au.classYear ? ' ’' + String(au.classYear).slice(2) : '');
    const authorsOf = (a) => (a.authors || []).map((slug) => (authors[slug] ? Object.assign({ slug: slug }, authors[slug]) : null)).filter((au) => au && au.visible !== false);
    const byline = (list, attrs) => list.map((au, i) => (i > 0 ? (i === list.length - 1 ? ' and ' : ', ') : '') + link('/authors/' + au.slug + '/', esc(authorLabel(au)), attrs)).join('');
    const pick = (refs) => (refs || []).map((r) => byId.get(String(r || '').split('/').pop())).filter(Boolean);
    const sectionArticles = (slug) => articles.filter((a) => a.section === slug || (a.secondarySections || []).indexOf(slug) >= 0);

    function storyCard(a, o) {
      o = Object.assign({ size: 'medium', layout: 'stack', image: true, dek: true, kicker: true, date: true, heading: 'h3', eager: false, mediaSide: 'right', dekLength: 170, sizes: '(min-width: 1024px) 30vw, (min-width: 768px) 50vw, 100vw' }, o);
      const pic = o.image ? picture(a.cover) : null;
      // Keep a photograph's own shape (upright stays upright), within sensible limits.
      const ratio = pic && pic.width && pic.height ? Math.min(2.6, Math.max(0.66, pic.width / pic.height)) : 1.5;
      const shape = ratio < 0.95 ? 'tall' : ratio > 1.9 ? 'pano' : 'wide';
      const classes = ['story', 'size-' + o.size, 'layout-' + o.layout];
      if (pic) classes.push('shape-' + shape);
      if (o.layout === 'row') classes.push('media-' + o.mediaSide);
      if (a.section === 'opinion') classes.push('is-opinion');
      if (!pic) classes.push('no-media');
      const list = authorsOf(a);
      const label = a.kind === 'editorial' ? 'Editorial' : sectionLabel(a.section);
      return '<article class="' + classes.join(' ') + '"' + (pic ? ' style="--ar:' + ratio.toFixed(3) + '"' : '') + '>'
        + (pic ? '<a class="media" href="' + esc(url(a.path)) + '" data-route="' + esc(a.path) + '" target="_top" tabindex="-1" aria-hidden="true">'
          + imgTag(pic, o.sizes, 'alt="" loading="' + (o.eager ? 'eager' : 'lazy') + '"' + (o.eager ? ' fetchpriority="high"' : '') + ' decoding="async"') + '</a>' : '')
        + '<div class="story-text">'
        + (o.kicker ? link('/' + a.section + '/', esc(label), ' class="kicker"') : '')
        + '<' + o.heading + ' class="hed">' + link(a.path, esc(a.title)) + '</' + o.heading + '>'
        + (o.dek ? '<p class="dek">' + esc(summary(a, o.dekLength)) + '</p>' : '')
        + '<p class="meta">'
        + (list.length ? '<span>By ' + byline(list) + '</span>' : '')
        + (o.date ? '<time' + (list.length ? ' class="sep"' : '') + ' datetime="' + esc(a.publishedAt) + '">' + formatDate(a.publishedAt, 'short') + '</time>' : '')
        + '<span class="sep">' + (a.minutes || 1) + ' min read</span>'
        + '</p></div></article>';
    }

    function sectionBand(slug, label, list, reverse) {
      const feature = list.find((a) => a.cover);
      const rest = list.filter((a) => a !== feature).slice(0, feature ? 3 : 4);
      let body;
      if (feature) {
        body = '<div class="feature-split' + (reverse ? ' reverse' : '') + (rest.length === 0 ? ' solo' : '') + '">'
          + '<div class="feature">' + storyCard(feature, { size: 'large', kicker: false, heading: 'h3', dekLength: 260, sizes: '(min-width: 768px) 520px, 100vw' }) + '</div>'
          + (rest.length ? '<div class="list">' + rest.map((a) => storyCard(a, { size: 'medium', layout: 'row', kicker: a.kind === 'editorial', heading: 'h3', dekLength: 230, sizes: '(min-width: 700px) 150px, 100px' })).join('') + '</div>' : '')
          + '</div>';
      } else {
        body = '<div class="row-' + Math.min(4, Math.max(2, rest.length)) + '">' + rest.map((a) => storyCard(a, { size: 'small', image: false, kicker: a.kind === 'editorial', heading: 'h3', dekLength: 200 })).join('') + '</div>';
      }
      return '<section class="wrap band" aria-labelledby="band-' + slug + '"><div class="band-head"><h2 id="band-' + slug + '">' + link('/' + slug + '/', esc(label)) + '</h2>'
        + link('/' + slug + '/', 'View all', ' class="more-link" aria-label="View all ' + esc(label) + '"') + '</div>' + body + '</section>';
    }

    function contactLine(kind, subject, label) {
      const email = (kind === 'tips' ? siteSettings.tipsEmail : null) || siteSettings.contactEmail || data.contactEmail || '';
      const list = String(email).split(',').map((e) => e.trim()).filter(Boolean);
      if (!list.length) {
        return '<p class="note">The staff’s public email address has not been posted here yet. Message the paper on '
          + SITE.social.map((x) => external(x.href, esc(x.label + ' (' + x.handle + ')'))).join(' or ') + ', or speak to any editor or the faculty adviser on campus.</p>';
      }
      const mailto = 'mailto:' + list.join(',') + (subject ? '?subject=' + encodeURIComponent(subject) : '');
      return '<p class="contact-line">' + external(mailto, esc(label || 'Email the editors'), ' class="button"')
        + '<span class="addresses">' + list.map((e, i) => (i > 0 ? '<span class="dot" aria-hidden="true">·</span>' : '') + external('mailto:' + e, esc(e))).join('') + '</span></p>';
    }

    // ---- frame: header and footer ----
    function header(path) {
      const isCurrent = (target) => path === target || (target !== '/' && path.indexOf(target) === 0);
      const current = (target) => (isCurrent(target) ? ' aria-current="page"' : '');
      const issue = home.currentIssue ? issueById.get(home.currentIssue) : null;
      const sectionLinks = SECTIONS.map((s) => '<li>' + link('/' + s.slug + '/', esc(s.label), current('/' + s.slug + '/')) + '</li>').join('');
      const more = MORE.map((m) => '<li>' + link(m.path, esc(m.label), current(m.path)) + '</li>').join('');
      const nameplate = picture(brand.nameplate);
      const wordmark = picture(brand.wordmark);
      return '<header class="site-header"><div class="wrap">'
        + '<div class="utility"><span class="left" data-today></span><span class="motto">' + esc(SITE.motto) + '</span><span class="right">'
        + (issue ? link('/issues/' + issue.id + '/', 'Latest print edition: ' + esc(issue.title)) : '') + '</span></div>'
        + '<div class="header-main">'
        + '<details class="nav-toggle"><summary aria-label="Menu">' + icon('menu') + icon('close') + '</summary>'
        + '<nav class="drawer" aria-label="Sections (mobile)"><ul>' + sectionLinks + more
        + '<li>' + link('/issues/', 'Print Issues') + '</li><li>' + link('/search/', 'Search') + '</li></ul></nav></details>'
        + link('/search/', icon('search'), ' class="mobile-search" aria-label="Search"')
        + '<div class="nameplate">' + link('/',
          (nameplate ? '<img class="np np-full" src="' + esc(nameplate.large) + '" width="' + (brand.nameplate.w || 3794) + '" height="' + (brand.nameplate.h || 357) + '" alt="' + esc(SITE.name) + '" decoding="async">' : '<span class="np np-full">' + esc(SITE.name) + '</span>')
          + (wordmark ? '<img class="np np-word" src="' + esc(wordmark.large) + '" width="' + (brand.wordmark.w || 2539) + '" height="' + (brand.wordmark.h || 322) + '" alt="' + esc(SITE.name) + '" decoding="async">' : ''),
          ' aria-label="' + esc(SITE.name) + ', home"')
        + '<p class="tagline">The student newspaper of ' + esc(SITE.school) + ' <span aria-hidden="true">·</span> ' + esc(SITE.location) + '</p></div>'
        + '</div>'
        + '<nav class="site-nav" aria-label="Sections"><ul>' + sectionLinks + '<li class="divider" aria-hidden="true"></li>' + more
        + '<li>' + link('/search/', icon('search') + 'Search', ' class="search-link"' + current('/search/')) + '</li></ul></nav>'
        + '</div></header>';
    }

    function footer() {
      const seal = picture(brand.seal);
      const wordmark = picture(brand.wordmark);
      const list = (items) => '<ul>' + items.join('') + '</ul>';
      return '<footer class="site-footer"><div class="wrap"><div class="cols"><div>'
        + link('/', (seal ? '<img class="seal" src="' + esc(driveImage(brand.seal.id, 256)) + '" width="512" height="512" alt="" loading="lazy" decoding="async">' : '')
          + (wordmark ? '<img class="word" src="' + esc(wordmark.src) + '" width="2539" height="322" alt="' + esc(SITE.name) + '" loading="lazy" decoding="async">' : esc(SITE.name)), ' class="name"')
        + '<p class="blurb">' + esc(SITE.description) + ' Written, edited and produced by students in ' + esc(SITE.location) + '.</p>'
        + '<p class="motto">' + esc(SITE.motto) + '</p></div>'
        + '<nav aria-label="Footer sections"><h2>Sections</h2>' + list(SECTIONS.map((s) => '<li>' + link('/' + s.slug + '/', esc(s.label)) + '</li>')) + '</nav>'
        + '<nav aria-label="Footer archive"><h2>Archive</h2>' + list([['/archives/', 'All articles'], ['/issues/', 'Print issues'], ['/authors/', 'Writers'], ['/search/', 'Search']].map((x) => '<li>' + link(x[0], x[1]) + '</li>')) + '</nav>'
        + '<nav aria-label="Footer newspaper"><h2>The paper</h2>' + list([['/about/', 'About'], ['/masthead/', 'Masthead'], ['/join/', 'Join the staff'], ['/contact/', 'Contact &amp; tips'], ['/corrections/', 'Corrections'], ['/privacy/', 'Privacy']].map((x) => '<li>' + link(x[0], x[1]) + '</li>')
          .concat(SITE.social.map((x) => '<li>' + external(x.href, esc(x.label)) + '</li>'))) + '</nav>'
        + '</div><div class="fine"><span>© ' + new Date().getFullYear() + ' ' + esc(SITE.name) + '. Articles and photographs belong to their student authors and photographers.</span>'
        + '<span>Views expressed in Opinion are the writers’ own.</span></div></div></footer>';
    }

    function frame(path, main) {
      const alert = home.alert && home.alert.text ? home.alert : null;
      const alertLink = alert && alert.href ? (/^\/(?!\/)/.test(alert.href) ? link(alert.href, esc(alert.text)) : /^https:\/\//.test(alert.href) ? external(alert.href, esc(alert.text)) : esc(alert.text)) : alert ? esc(alert.text) : '';
      return '<a class="skip-link" href="#main">Skip to content</a>'
        + (alert ? '<div class="alert-banner" role="status">' + alertLink + '</div>' : '')
        + header(path) + '<main id="main">' + main + '</main>' + footer();
    }
    const pageHead = (kicker, title, text) => '<header class="page-head">' + kicker + '<h1>' + title + '</h1>' + (text ? '<p>' + text + '</p>' : '') + '</header>';
    const kicker = (text, path) => (path ? link(path, esc(text), ' class="kicker"') : '<span class="kicker">' + esc(text) + '</span>');

    // ---- pages ----
    function homePage() {
      const perIssue = new Map();
      articles.forEach((a) => { if (a.issueId) perIssue.set(a.issueId, (perIssue.get(a.issueId) || 0) + 1); });
      const first = articles[0];
      const editionIssue = first && first.issueId && (perIssue.get(first.issueId) || 0) >= 3 ? issueById.get(first.issueId) : null;
      const edition = !first ? [] : editionIssue
        ? articles.filter((a) => a.issueId === editionIssue.id).sort((a, b) => (a.printOrder == null ? 999 : a.printOrder) - (b.printOrder == null ? 999 : b.printOrder))
        : articles.filter((a) => dayOf(a.publishedAt) === dayOf(first.publishedAt));
      const pool = edition.concat(articles.filter((a) => edition.indexOf(a) < 0));
      const used = new Set();
      const take = (list, n) => { const out = list.filter((a) => !used.has(a)).slice(0, n); out.forEach((a) => used.add(a)); return out; };
      const ratio = (a) => (a.cover && a.cover.w && a.cover.h ? a.cover.w / a.cover.h : 0);
      const lead = pick([home.lead])[0] || pool.find((a) => a.featured && a.cover) || pool.find((a) => ratio(a) >= 1.4) || pool.find((a) => a.cover) || pool[0];
      if (lead) used.add(lead);
      const rail = take(pick(home.secondary).concat(pool), 4);
      const latest = take(pool, 4);
      const picks = pick(home.editorsPicks).filter((a) => !used.has(a)).slice(0, 4);
      picks.forEach((a) => used.add(a));
      const bands = SECTIONS.map((s) => {
        const mine = sectionArticles(s.slug).filter((a) => a !== lead);
        const fresh = mine.filter((a) => !used.has(a));
        return { slug: s.slug, label: s.label, list: fresh.concat(mine.filter((a) => used.has(a))).slice(0, 4) };
      }).filter((b) => b.list.length);
      const promoted = home.currentIssue ? issueById.get(home.currentIssue) : editionIssue;
      const promotedCover = promoted ? coverOf(promoted) : null;
      const otherIssues = issues.filter((i) => (!promoted || i.id !== promoted.id) && coverOf(i));
      const leadPic = lead ? picture(lead.cover) : null;

      let out = '<h1 class="visually-hidden">' + esc(SITE.name) + '</h1>';
      if (!lead) return out + '<div class="wrap band"><p>No articles have been published yet.</p></div>';
      out += '<div class="wrap">'
        + '<p class="issue-strip"><strong>' + esc(editionIssue ? editionIssue.title : 'Latest') + '</strong><span>' + esc(editionIssue && editionIssue.dateLabel ? editionIssue.dateLabel : formatDate(first.publishedAt)) + '</span>'
        + (editionIssue ? link('/issues/' + editionIssue.id + '/', 'Read the print edition') : '') + '</p>'
        + '<section class="package" aria-label="Top stories"><article class="hero">'
        + (leadPic ? '<a class="hero-photo zoom" href="' + esc(url(lead.path)) + '" data-route="' + esc(lead.path) + '" target="_top" tabindex="-1" aria-hidden="true">' + imgTag(leadPic, '(min-width: 1024px) 720px, 100vw', 'alt="" fetchpriority="high" decoding="async"') + '</a>' : '')
        + storyCard(lead, { size: 'lead', image: false, heading: 'h2', dekLength: 300 })
        + '</article><div class="rail">' + rail.map((a) => storyCard(a, { size: 'medium', layout: 'row', heading: 'h2', dekLength: 200, sizes: '(min-width: 700px) 160px, 110px' })).join('') + '</div></section>'
        + (latest.length ? '<section class="band" aria-labelledby="latest-head"><div class="band-head"><h2 id="latest-head">Latest</h2>' + link('/archives/', 'All articles', ' class="more-link"') + '</div>'
          + '<div class="row-4">' + latest.map((a) => storyCard(a, { size: 'small', image: false, dekLength: 190 })).join('') + '</div></section>' : '')
        + '</div>';
      if (picks.length) {
        out += '<section class="picks" aria-labelledby="picks-head"><div class="wrap"><div class="band-head"><h2 id="picks-head">Editors’ Picks</h2></div>'
          + '<div class="row-4 uniform">' + picks.map((a) => storyCard(a, { size: 'small', dekLength: 150, sizes: '(min-width: 1024px) 290px, 50vw' })).join('') + '</div></div></section>';
      }
      out += bands.map((b, i) => sectionBand(b.slug, b.label, b.list, i % 2 === 1)).join('');
      if (promoted && (promoted.pdf || promotedCover)) {
        out += '<section class="wrap band" aria-labelledby="issue-head"><div class="print-callout">'
          + (promotedCover ? '<a class="page" href="' + esc(url('/issues/' + promoted.id + '/')) + '" data-route="/issues/' + esc(promoted.id) + '/" target="_top" tabindex="-1" aria-hidden="true">' + imgTag(promotedCover, '220px') + '</a>' : '')
          + '<div class="print-text"><span class="kicker">In print</span><h2 id="issue-head">' + esc(promoted.title) + (promoted.dateLabel ? '<em>, ' + esc(promoted.dateLabel) + '</em>' : '') + '</h2>'
          + '<p>Read the paper as it was laid out for campus, page by page, or download the full edition.</p><div class="actions">'
          + link('/issues/' + promoted.id + '/', 'Read the issue', ' class="button"')
          + (promoted.pdf ? external('https://drive.google.com/file/d/' + encodeURIComponent(promoted.pdf.id) + '/view', 'Download PDF', ' class="button ghost"') : '')
          + link('/issues/', 'All print issues', ' class="button ghost"') + '</div></div>'
          + (otherIssues.length ? '<div class="print-shelf"><span class="kicker" style="color:var(--ink-soft)">Earlier editions</span><div class="shelf-row">'
            + otherIssues.slice(0, 3).map((issue) => {
              const c = coverOf(issue);
              return link('/issues/' + issue.id + '/', '<span class="cover">' + (c ? imgTag(c, '150px') : '') + '</span><span><h3>' + esc(issue.title) + '</h3><span class="meta">' + esc(issue.dateLabel || issue.year) + '</span></span>', ' class="issue-card"');
            }).join('') + '</div></div>' : '')
          + '</div></section>';
      }
      out += '<section class="join" aria-labelledby="join-head"><div class="wrap join-inner"><div><h2 id="join-head">Write for The Governor</h2>'
        + '<p>The paper is made by students, for the whole Academy. Pitch a story, send a tip, or write a letter to the editors.</p></div>'
        + '<div class="actions">' + link('/join/', 'Join the staff', ' class="button"') + link('/contact/', 'Submit a tip or letter', ' class="button ghost"') + '</div></div></section>';
      return out;
    }

    function sectionPage(slug, page) {
      const label = sectionLabel(slug);
      const all = sectionArticles(slug);
      const last = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
      if (page < 1 || page > last) return null;
      const list = all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
      const first = list[0];
      const showFeature = page === 1 && first && first.cover;
      const others = SECTIONS.filter((s) => s.slug !== slug);
      const pagePath = (n) => '/' + slug + '/' + (n > 1 ? n + '/' : '');
      const main = '<div class="wrap">'
        + '<header class="page-head"><span class="kicker">Section</span><h1>' + esc(label) + '</h1><p class="meta" style="margin-top:.6rem">' + all.length + ' ' + (all.length === 1 ? 'article' : 'articles') + (last > 1 ? ' · Page ' + page + ' of ' + last : '') + '</p></header>'
        + (all.length === 0 ? '<p>Nothing has been published in this section yet.</p>' : '<div class="with-rail"><div>'
          + (showFeature ? '<div style="margin-bottom:1.6rem;padding-bottom:1.6rem;border-bottom:1px solid var(--rule-strong)">' + storyCard(first, { size: 'large', kicker: false, heading: 'h2', eager: true, sizes: '(min-width: 900px) 60vw, 100vw' }) + '</div>' : '')
          + '<div class="river">' + (showFeature ? list.slice(1) : list).map((a) => storyCard(a, { size: 'medium', kicker: a.kind === 'editorial', heading: 'h2', sizes: '240px' })).join('') + '</div>'
          + (last > 1 ? '<nav class="pagination" aria-label="Pagination"><span>' + (page > 1 ? link(pagePath(page - 1), '← Newer', ' rel="prev"') : '') + '</span><span class="meta">Page ' + page + ' of ' + last + '</span><span>' + (page < last ? link(pagePath(page + 1), 'Older →', ' rel="next"') : '') + '</span></nav>' : '')
          + '</div><aside aria-label="Other sections"><h2 class="label-head">Other sections</h2><ul class="plain-list">' + others.map((s) => '<li>' + link('/' + s.slug + '/', esc(s.label)) + '</li>').join('') + '</ul>'
          + '<p style="margin-top:1.5rem">' + link('/archives/', 'Browse the full archive', ' class="more-link"') + '</p></aside></div>')
        + '</div>';
      return { title: page > 1 ? label + ', page ' + page : label, main: main };
    }

    function articlePage(a, body) {
      const list = authorsOf(a);
      const cover = picture(a.cover);
      const issue = a.issueId ? issueById.get(a.issueId) : null;
      const isEditorial = a.kind === 'editorial';
      const related = articles.filter((x) => x.id !== a.id)
        .map((x) => ({ x: x, score: (x.section === a.section ? 2 : 0) + ((x.authors || []).some((s) => (a.authors || []).indexOf(s) >= 0) ? 1 : 0) }))
        .filter((r) => r.score > 0).sort((p, q) => q.score - p.score).slice(0, 3).map((r) => r.x);
      const main = '<article class="wrap">'
        + '<header class="article-head' + (a.section === 'opinion' ? ' is-opinion' : '') + '">'
        + link('/' + a.section + '/', esc(sectionLabel(a.section)), ' class="kicker"')
        + (isEditorial ? '<span class="kicker" style="color:var(--ink-soft)"> · Editorial</span>' : '')
        + '<h1>' + esc(a.title) + '</h1>'
        + (a.deck ? '<p class="deck">' + esc(a.deck) + '</p>' : '')
        + '<div class="byline-block">'
        + (list.length ? '<p class="names">By ' + byline(list) + '</p>' : '')
        + '<p><time datetime="' + esc(a.publishedAt) + '">' + formatDate(a.publishedAt) + '</time>'
        + (a.updatedAt ? '<span class="sep"> · Updated <time datetime="' + esc(a.updatedAt) + '">' + formatDate(a.updatedAt) + '</time></span>' : '')
        + '<span> · ' + (a.minutes || 1) + ' min read</span></p></div></header>'
        + (cover ? '<figure class="article-cover" style="margin-inline:auto;' + (cover.width ? 'max-width:min(42rem, ' + Math.round(cover.width * 0.75) + 'px)' : '') + '">'
          + imgTag(cover, '(min-width: 720px) 672px, 100vw', 'alt="' + esc(a.cover.alt || '') + '" fetchpriority="high" decoding="async"')
          + (a.cover.caption || a.cover.credit ? '<figcaption class="caption">' + esc(a.cover.caption || '') + ' ' + (a.cover.credit ? '<span class="credit">' + esc(a.cover.credit) + '</span>' : '') + '</figcaption>' : '')
          + '</figure>' : '')
        + '<div class="article-body">'
        + (a.correction ? '<p class="note" style="margin-bottom:1.5rem"><strong>Correction:</strong> ' + esc(a.correction) + '</p>' : '')
        + '<div class="prose">' + (body == null ? '<p class="meta" data-loading>Loading the article…</p>' : body) + '</div></div>'
        + '<footer class="article-foot">'
        + (issue ? '<p>' + (isEditorial ? 'The editorial of ' : 'Appeared in print in ') + link('/issues/' + issue.id + '/', esc(issue.title + (issue.dateLabel ? ', ' + issue.dateLabel : ' (' + issue.year + ')'))) + '.</p>' : '')
        + '<div class="row"><button class="copy-link" type="button" data-copy="' + esc(url(a.path)) + '">Copy link</button>'
        + '<span>Spotted an error? ' + link('/corrections/', 'Request a correction') + '.</span></div></footer>'
        + '</article>'
        + (related.length ? '<section class="wrap band related" aria-labelledby="related-head" style="margin-top:2rem"><div class="band-head"><h2 id="related-head">More from ' + esc(sectionLabel(a.section)) + '</h2>'
          + link('/' + a.section + '/', 'View all', ' class="more-link"') + '</div><div class="grid cols-3 collapse-rules">'
          + related.map((x) => storyCard(x, { size: 'small', sizes: '(min-width: 768px) 33vw, 100vw' })).join('') + '</div></section>' : '');
      return { title: a.title, main: main };
    }

    function archiveList(list) {
      const months = new Map();
      list.forEach((a) => { const key = a.publishedAt.slice(0, 7); months.set(key, (months.get(key) || []).concat([a])); });
      const authorIds = Array.from(new Set([].concat.apply([], list.map((a) => a.authors || []))))
        .filter((id) => authors[id] && authors[id].visible !== false).sort((x, y) => authors[x].name.localeCompare(authors[y].name));
      const sections = SECTIONS.filter((s) => list.some((a) => a.section === s.slug));
      return '<form class="filters" data-archive-filters><label>Section <select name="section"><option value="">All sections</option>'
        + sections.map((s) => '<option value="' + s.slug + '">' + esc(s.label) + '</option>').join('') + '</select></label>'
        + '<label>Writer <select name="author"><option value="">All writers</option>' + authorIds.map((id) => '<option value="' + esc(id) + '">' + esc(authors[id].name) + '</option>').join('') + '</select></label>'
        + '<p class="meta" data-archive-count aria-live="polite" style="margin:0 0 .55rem">' + list.length + (list.length === 1 ? ' article' : ' articles') + '</p></form>'
        + '<div data-archive-list>' + Array.from(months).map((entry) => '<section data-month><h2 class="month-head">' + monthLabel(entry[0]) + '</h2>'
          + entry[1].map((a) => '<div class="archive-row" data-section="' + esc(a.section) + '" data-authors="' + esc((a.authors || []).join(' ')) + '">'
            + '<time datetime="' + esc(a.publishedAt) + '">' + formatDate(a.publishedAt, 'short').replace(/, \d{4}$/, '') + '</time>'
            + '<div><h3>' + link(a.path, esc(a.title)) + '</h3><p class="meta"><span class="kicker">' + esc(a.kind === 'editorial' ? 'Editorial' : sectionLabel(a.section)) + '</span>'
            + authorsOf(a).map((au, i) => '<span class="sep">' + (i === 0 ? 'By ' : '') + esc(authorLabel(au)) + '</span>').join('') + '</p></div></div>').join('')
          + '</section>').join('') + '</div>';
    }

    function archivesPage() {
      const years = Array.from(new Set(articles.map((a) => academicYear(a.publishedAt)))).sort().reverse();
      const current = years[0];
      const main = '<div class="wrap">' + pageHead(kicker('Archives'), 'The article archive', articles.length + ' articles, newest first. Looking for a phrase or a name? ' + link('/search/', 'Search the full text') + '.')
        + '<div class="with-rail"><div>' + (current ? '<h2 class="label-head">' + academicYearLabel(current) + ' school year</h2>' + archiveList(articles.filter((a) => academicYear(a.publishedAt) === current)) : '<p>No articles have been published yet.</p>') + '</div>'
        + '<aside><h2 class="label-head">By school year</h2><ul class="plain-list">' + years.map((y) => '<li>' + link('/archives/' + y + '/', academicYearLabel(y)) + '<span class="count">' + articles.filter((a) => academicYear(a.publishedAt) === y).length + ' articles</span></li>').join('') + '</ul>'
        + '<h2 class="label-head" style="margin-top:2rem">Print issues</h2><p class="meta" style="margin-bottom:.8rem">Whole editions as they were printed are kept separately from web articles.</p>'
        + link('/issues/', 'Browse ' + issues.length + ' print ' + (issues.length === 1 ? 'issue' : 'issues'), ' class="button ghost"')
        + '<h2 class="label-head" style="margin-top:2rem">Writers</h2>' + link('/authors/', 'All writers', ' class="more-link"') + '</aside></div></div>';
      return { title: 'Archives', main: main };
    }

    function archiveYearPage(year) {
      const list = articles.filter((a) => academicYear(a.publishedAt) === year);
      if (!list.length) return null;
      return { title: academicYearLabel(year) + ' archive', main: '<div class="wrap">' + pageHead(kicker('Archives', '/archives/'), academicYearLabel(year), list.length + ' articles from the ' + academicYearLabel(year) + ' school year.') + '<div style="max-width:52rem">' + archiveList(list) + '</div></div>' };
    }

    function authorsPage() {
      const rows = Object.keys(authors).filter((id) => authors[id].visible !== false)
        .map((id) => ({ id: id, count: articles.filter((a) => (a.authors || []).indexOf(id) >= 0).length }))
        .filter((r) => r.count > 0)
        .sort((x, y) => authors[x.id].name.split(' ').slice(-1)[0].localeCompare(authors[y.id].name.split(' ').slice(-1)[0]));
      return { title: 'Writers', main: '<div class="wrap">' + pageHead(kicker('Archives'), 'Writers', 'Everyone with a byline in the online archive, by last name.')
        + '<ul class="plain-list" style="columns:18rem 3;column-gap:var(--gap)">' + rows.map((r) => '<li style="break-inside:avoid">' + link('/authors/' + r.id + '/', esc(authorLabel(authors[r.id]))) + '<span class="count">' + r.count + ' ' + (r.count === 1 ? 'article' : 'articles') + '</span></li>').join('') + '</ul></div>' };
    }

    function authorPage(slug) {
      const au = authors[slug];
      if (!au || au.visible === false) return null;
      const list = articles.filter((a) => (a.authors || []).indexOf(slug) >= 0);
      const photo = picture(au.photo);
      return { title: au.name, main: '<div class="wrap"><header class="page-head">' + link('/authors/', 'Writers', ' class="kicker"') + '<h1>' + esc(au.name) + '</h1>'
        + '<p class="meta" style="margin-top:.6rem">' + (au.classYear ? '<span>Class of ' + au.classYear + '</span>' : '') + '<span' + (au.classYear ? ' class="sep"' : '') + '>' + list.length + ' ' + (list.length === 1 ? 'article' : 'articles') + '</span></p>'
        + (photo ? imgTag(photo, '160px', 'alt="Portrait of ' + esc(au.name) + '" style="width:160px;margin-top:1rem" loading="lazy"') : '')
        + (au.bio ? '<p>' + esc(au.bio) + '</p>' : '') + '</header>'
        + '<div class="river" style="max-width:56rem">' + list.map((a) => storyCard(a, { size: 'medium', heading: 'h2', sizes: '240px' })).join('') + '</div></div>' };
    }

    const SEASON = { Winter: 0, Spring: 1, Summer: 2, Fall: 3 };
    function issuesPage() {
      const sorted = issues.slice().sort((a, b) => b.year - a.year || (SEASON[b.season] || 0) - (SEASON[a.season] || 0) || (b.number || 0) - (a.number || 0));
      const years = Array.from(new Set(sorted.map((i) => i.year)));
      return { title: 'Print issues', main: '<div class="wrap">' + pageHead(kicker('Archives'), 'Print issues', 'Editions of the paper as they were printed. Only issues the staff can document are listed; an issue without a scan is marked as such.')
        + (sorted.length ? '' : '<p>No print issues have been added yet.</p>')
        + years.map((year) => '<section style="margin-bottom:2.5rem"><h2 class="label-head">' + year + '</h2><div class="issue-grid">'
          + sorted.filter((i) => i.year === year).map((issue) => {
            const cover = coverOf(issue);
            return link('/issues/' + issue.id + '/', (cover ? '<span class="cover">' + imgTag(cover, '220px') + '</span>' : '<span class="cover empty">No scan in the archive yet</span>')
              + '<span><h3>' + esc(issue.title) + '</h3><span class="meta">' + esc(issue.dateLabel || ((issue.season || '') + ' ' + issue.year).trim()) + (issue.pdf ? ' · PDF' : '') + '</span></span>', ' class="issue-card"');
          }).join('') + '</div></section>').join('') + '</div>' };
    }

    function issuePage(id) {
      const issue = issueById.get(id);
      if (!issue) return null;
      const list = articles.filter((a) => a.issueId === id);
      const pages = (issue.pages || []).map(picture).filter(Boolean);
      const when = issue.dateLabel || ((issue.season || '') + ' ' + issue.year).trim();
      const notes = issue.notes || [];
      return { title: issue.title + ', ' + when, main: '<div class="wrap"><header class="page-head">' + link('/issues/', 'Print issues', ' class="kicker"') + '<h1>' + esc(issue.title) + '</h1>'
        + '<p>' + esc(when) + (issue.volume ? ' · Volume ' + issue.volume : '') + (pages.length ? ' · ' + pages.length + ' pages' : '') + '</p>'
        + (issue.pdf ? '<p style="margin-top:1rem">' + external('https://drive.google.com/file/d/' + encodeURIComponent(issue.pdf.id) + '/view', 'Download PDF', ' class="button"') + '</p>' : '') + '</header>'
        + (!issue.pdf && !pages.length ? '<p class="note" style="max-width:var(--measure)">This edition is known from the editorial published with it, but no PDF or page scans are in the archive yet. If you have a copy, please ' + link('/contact/', 'get in touch') + '.</p>' : '')
        + (list.length ? '<section style="max-width:52rem;margin-bottom:2.5rem"><h2 class="label-head">' + (pages.length ? 'Articles from this issue, online' : 'From this issue, online') + '</h2><ul class="plain-list">'
          + list.map((a) => { const au = authorsOf(a); return '<li>' + link(a.path, esc(a.title)) + '<span class="count">' + esc(a.kind === 'editorial' ? 'Editorial' : sectionLabel(a.section)) + (au[0] ? ' · ' + esc(authorLabel(au[0])) + (au.length > 1 ? ' and others' : '') : '') + '</span></li>'; }).join('')
          + '</ul>' + notes.map((n) => '<p class="meta" style="margin-top:.8rem">' + esc(n) + '</p>').join('') + '</section>'
          : notes.length ? '<div style="max-width:52rem;margin-bottom:2.5rem">' + notes.map((n) => '<p class="note">' + esc(n) + '</p>').join('') + '</div>' : '')
        + (!pages.length && issue.pdf ? '<section aria-label="The issue"><h2 class="label-head" style="max-width:56rem;margin-inline:auto">The issue</h2>'
          + '<iframe class="issue-viewer" src="https://drive.google.com/file/d/' + encodeURIComponent(issue.pdf.id) + '/preview" title="' + esc(issue.title) + ', the printed edition" loading="lazy" allow="fullscreen"></iframe></section>' : '')
        + (pages.length ? '<section aria-label="Pages"><h2 class="label-head" style="max-width:56rem;margin-inline:auto">The issue, page by page</h2><div class="issue-pages">'
          + pages.map((p, i) => '<figure style="margin:0">' + external(p.large, imgTag(p, '(min-width: 960px) 896px, 100vw', 'alt="' + esc(issue.title) + ', page ' + (i + 1) + '. The text of this page is in the PDF and in the linked articles." loading="' + (i === 0 ? 'eager' : 'lazy') + '" decoding="async"')) + '<figcaption>Page ' + (i + 1) + '</figcaption></figure>').join('')
          + '</div></section>' : '') + '</div>' };
    }

    const prose = (title, kickerText, intro, body) => '<div class="wrap">' + pageHead(kicker(kickerText || 'The paper'), title, intro) + '<div class="page-body prose">' + body + '</div></div>';
    const sectionList = () => '<ul>' + SECTIONS.map((s) => '<li>' + link('/' + s.slug + '/', esc(s.label)) + '</li>').join('') + '</ul>';

    function aboutPage() {
      const writers = new Set([].concat.apply([], articles.map((a) => a.authors || []))).size;
      return { title: 'About', main: prose('About The Governor', null, '',
        '<p><em>The Governor</em> is the student newspaper of ' + esc(SITE.school) + ' in ' + esc(SITE.location) + '. Students report, write, edit, photograph and lay out every issue.</p>'
        + '<p>The paper is published in print on campus and online here. This site holds ' + articles.length + ' articles by ' + writers + ' student writers, along with ' + link('/issues/', issues.length + ' print ' + (issues.length === 1 ? 'issue' : 'issues')) + ' the staff has on record.</p>'
        + '<h2>Sections</h2>' + sectionList()
        + '<h2>News and opinion</h2><p>News articles report what happened and who said it. Opinion pieces carry one writer’s view and are labelled Opinion. An Editorial is the shared position of the editors who sign it. Humor &amp; Fun is satire and entertainment and should be read that way.</p>'
        + '<h2>Get involved</h2><p>Any student can ' + link('/join/', 'write for the paper') + '. Readers can ' + link('/contact/', 'send a tip or a letter') + ', and anyone can ' + link('/corrections/', 'ask for a correction') + '.</p>'
        + '<h2>The archive</h2><p>Articles first published on the paper’s earlier website keep their original headlines, text and dates. See the ' + link('/archives/', 'archive') + '.</p>') };
    }

    function mastheadPage() {
      const groups = [];
      (settings.masthead || []).forEach((m) => {
        if (!m || !m.group || !m.name) return;
        let g = groups.find((x) => x.title === m.group);
        if (!g) { g = { title: m.group, members: [] }; groups.push(g); }
        g.members.push(m);
      });
      const year = siteSettings.mastheadYear;
      return { title: 'Masthead', main: '<div class="wrap">' + pageHead(kicker('The paper'), 'Masthead', year ? 'Editorial board and staff, ' + esc(year) + '.' : '') + '<div class="page-body">'
        + (groups.length ? groups.map((g) => '<section style="margin-bottom:2rem"><h2 class="label-head">' + esc(g.title) + '</h2><ul class="plain-list">'
          + g.members.map((m) => '<li><span style="font:500 1.0625rem var(--font-display)">' + esc(m.name) + '</span>' + (m.role ? '<span class="count">' + esc(m.role) + '</span>' : '') + '</li>').join('') + '</ul></section>').join('')
          : '<p class="note">This year’s editorial board has not been posted yet. Everyone who has written for the paper online is listed under ' + link('/authors/', 'Writers') + '.</p>')
        + '</div></div>' };
    }

    function correctionsPage() {
      const corrected = articles.filter((a) => a.correction);
      return { title: 'Corrections', main: prose('Corrections', null, 'If we got something wrong, we want to fix it and say so.',
        '<h2>Our policy</h2><p>When an article contains a factual error, the editors correct the text and add a note to the article saying what changed and when. Fixes to spelling or punctuation that do not change meaning are made without a note. Articles are not removed because someone disagrees with them.</p>'
        + '<h2>Ask for a correction</h2><p>Tell us which article, what is wrong, and how you know. An editor will check and reply.</p>' + contactLine('contact', 'Correction request', 'Email a correction request')
        + '<h2>Correction log</h2>' + (corrected.length ? '<ul>' + corrected.map((a) => '<li>' + link(a.path, esc(a.title)) + ' (' + formatDate(a.updatedAt || a.publishedAt) + '): ' + esc(a.correction) + '</li>').join('') + '</ul>' : '<p>No corrections have been logged on this site.</p>')) };
    }

    function contactPage() {
      return { title: 'Contact and tips', main: prose('Contact, tips and letters', null, 'Seen something the school should know about? Disagree with something we ran? Write to us.',
        '<h2>Send a news tip</h2><p>Say what happened, when, and who we could talk to. Tell us if you want your name kept out of it; we will ask before using it.</p>' + contactLine('tips', 'News tip', 'Email a tip')
        + '<h2>Letters to the editors</h2><p>Letters should carry your name and class year or role, and respond to something in the paper or on campus. The editors choose which letters run and may edit for length and clarity.</p>' + contactLine('contact', 'Letter to the editors', 'Email a letter')
        + '<h2>Corrections</h2><p>See the ' + link('/corrections/', 'corrections page') + '.</p>') };
    }

    function joinPage() {
      return { title: 'Join the staff', main: prose('Join the staff', null, 'You do not need experience. You need curiosity and a deadline.',
        '<p>The paper needs reporters, opinion writers, photographers, illustrators, page designers and editors. Pick a section that interests you:</p>' + sectionList()
        + '<p>Read a few recent pieces, then pitch an idea in a sentence or two: what the story is, and who you would talk to.</p>' + contactLine('contact', 'Joining The Governor', 'Email the editors')) };
    }

    function privacyPage() {
      return { title: 'Privacy', main: prose('Privacy', null, '',
        '<p>This website sets no cookies of its own, runs no advertising or analytics scripts, and has no reader accounts or comments.</p><ul>'
        + '<li><strong>Hosting.</strong> The pages are served by Google (Google Sites, Apps Script and Drive, in the school’s Google account). Like any web host, Google may log technical details such as IP addresses.</li>'
        + '<li><strong>Search</strong> sends what you type to the paper’s own script, only to find matching articles. It is not stored.</li>'
        + '<li><strong>Fonts</strong> come from Google Fonts; pictures and PDFs from Google Drive.</li>'
        + '<li><strong>Email.</strong> If you write to the staff, we see your address and message and use them only to reply or to consider your letter or tip.</li></ul>'
        + '<p>Subscriber lists and comments from the paper’s earlier website were not carried over to this one.</p>'
        + '<p>Students named or pictured in an article who have a concern can ' + link('/contact/', 'contact the editors') + '.</p>') };
    }

    function searchPage(q, results) {
      let body;
      if (!q) body = '<p class="meta">Type a headline, a writer or a phrase.</p>';
      else if (!results) body = '<p class="meta" data-loading>Searching…</p>';
      else if (!results.length) body = '<p>No articles match <strong>' + esc(q) + '</strong>. Try fewer words, or browse the ' + link('/archives/', 'archive') + '.</p>';
      else body = '<p class="meta" style="margin-bottom:1rem">' + results.length + (results.length === 1 ? ' article matches' : ' articles match') + ' <strong>' + esc(q) + '</strong></p>'
        + results.map((r) => { const a = byId.get(r.id); return a ? '<div class="archive-row"><time datetime="' + esc(a.publishedAt) + '">' + formatDate(a.publishedAt, 'short') + '</time><div><h3>' + link(a.path, esc(a.title)) + '</h3>'
          + (r.snippet ? '<p class="dek" style="margin-top:.3rem">' + esc(r.snippet) + '</p>' : '') + '<p class="meta"><span class="kicker">' + esc(a.kind === 'editorial' ? 'Editorial' : sectionLabel(a.section)) + '</span>'
          + authorsOf(a).map((au, i) => '<span class="sep">' + (i === 0 ? 'By ' : '') + esc(authorLabel(au)) + '</span>').join('') + '</p></div></div>' : ''; }).join('');
      return { title: q ? 'Search: ' + q : 'Search', main: '<div class="wrap">' + pageHead(kicker('Archives'), 'Search', 'Full text of every published article, by headline, writer or phrase.')
        + '<form class="search-form" data-search role="search"><input type="search" name="q" value="' + esc(q) + '" placeholder="Search The Governor" aria-label="Search The Governor" autocomplete="off"><button class="button" type="submit">Search</button></form>'
        + '<div class="search-results" style="max-width:52rem">' + body + '</div></div>' };
    }

    function notFoundPage() {
      return { title: 'Page not found', main: '<div class="wrap">' + pageHead(kicker('Error 404'), 'We can’t find that page', 'The address may be mistyped, or the page may have moved when the paper’s website was rebuilt.')
        + '<div class="actions" style="margin-bottom:2.5rem">' + link('/search/', 'Search the archive', ' class="button"') + link('/archives/', 'Browse by date', ' class="button ghost"') + link('/', 'Front page', ' class="button ghost"') + '</div>'
        + '<h2 class="label-head">Latest</h2><div class="grid cols-3 collapse-rules">' + articles.slice(0, 3).map((a) => storyCard(a, { size: 'small', image: false })).join('') + '</div></div>' };
    }

    /** What a path shows. Old addresses from the paper's earlier websites lead to their new places. */
    function resolve(rawPath) {
      const [pathPart, query] = String(rawPath || '/').split('?');
      let path = pathPart || '/';
      if (path[0] !== '/') path = '/' + path;
      if (!/\/$/.test(path)) path += '/';
      const q = query ? (new RegExp('(?:^|&)q=([^&]*)').exec(query) || [])[1] : '';
      const legacy = /^\/category\/([^/]+)\/$/.exec(path);
      if (legacy) return { redirect: '/' + legacy[1] + '/' };
      if (path === '/news-2/') return { redirect: '/news/' };
      if (path === '/') return { kind: 'home', path: path };
      const article = byPath.get(path);
      if (article) return { kind: 'article', path: path, article: article };
      const section = /^\/([a-z-]+)\/(?:(\d+)\/)?$/.exec(path);
      if (section && SECTIONS.some((s) => s.slug === section[1])) return { kind: 'section', path: path, slug: section[1], page: Number(section[2] || 1) };
      let m;
      if (path === '/archives/') return { kind: 'archives', path: path };
      if ((m = /^\/archives\/(\d{4}-\d{4})\/$/.exec(path))) return { kind: 'archive-year', path: path, year: m[1] };
      if (path === '/authors/') return { kind: 'authors', path: path };
      if ((m = /^\/authors\/([a-z0-9-]+)\/$/.exec(path))) return { kind: 'author', path: path, slug: m[1] };
      if (path === '/issues/') return { kind: 'issues', path: path };
      if ((m = /^\/issues\/([a-z0-9-]+)\/$/.exec(path))) return { kind: 'issue', path: path, id: m[1] };
      if (path === '/search/') return { kind: 'search', path: path, q: q ? decodeURIComponent(q.replace(/\+/g, ' ')) : '' };
      const page = { '/about/': 'about', '/masthead/': 'masthead', '/corrections/': 'corrections', '/contact/': 'contact', '/join/': 'join', '/privacy/': 'privacy' }[path];
      if (page) return { kind: page, path: path };
      return { kind: 'not-found', path: path };
    }

    /** The whole page for a path. extra.bodies: article texts loaded so far; extra.results: search results. */
    function render(rawPath, extra) {
      extra = extra || {};
      const r = resolve(rawPath);
      if (r.redirect) return render(r.redirect, extra);
      let page = null;
      switch (r.kind) {
        case 'home': page = { title: '', main: homePage() }; break;
        case 'article': page = articlePage(r.article, (extra.bodies || {})[r.article.id]); break;
        case 'section': page = sectionPage(r.slug, r.page); break;
        case 'archives': page = archivesPage(); break;
        case 'archive-year': page = archiveYearPage(r.year); break;
        case 'authors': page = authorsPage(); break;
        case 'author': page = authorPage(r.slug); break;
        case 'issues': page = issuesPage(); break;
        case 'issue': page = issuePage(r.id); break;
        case 'search': page = searchPage(r.q, (extra.results || {})[r.q]); break;
        case 'about': page = aboutPage(); break;
        case 'masthead': page = mastheadPage(); break;
        case 'corrections': page = correctionsPage(); break;
        case 'contact': page = contactPage(); break;
        case 'join': page = joinPage(); break;
        case 'privacy': page = privacyPage(); break;
        default: page = null;
      }
      if (!page) { page = notFoundPage(); r.kind = 'not-found'; }
      return { kind: r.kind, path: r.path, title: page.title ? page.title + ' | ' + SITE.name : SITE.name + ' | ' + SITE.description.replace(/\.$/, ''), html: frame(r.path, page.main), article: r.article || null, q: r.q || '' };
    }

    return { render: render, resolve: resolve, url: url };
  }

  // ---- in the browser --------------------------------------------------------------------
  /** Starts the site inside the publisher's page. boot = { path, data, bodies, appUrl } from Page.html. */
  function start(boot) {
    const doc = global.document;
    const run = global.google && global.google.script;
    const app = createApp(boot.data, { appUrl: boot.appUrl });
    const bodies = Object.assign({}, boot.bodies || {});
    const results = {};
    const root = doc.getElementById('app');
    let currentPath = null;

    function draw(path) {
      const out = app.render(path, { bodies: bodies, results: results });
      currentPath = path;
      root.innerHTML = out.html;
      doc.title = out.title;
      hydrate(out);
      return out;
    }

    function show(path, push) {
      const out = draw(path);
      if (out.article && !(out.article.id in bodies) && run) {
        run.run.withSuccessHandler((res) => { bodies[out.article.id] = res && res.body != null ? res.body : '<p>The article could not be loaded. Try again in a moment.</p>'; if (currentPath === path) draw(path); })
          .withFailureHandler(() => { bodies[out.article.id] = '<p>The article could not be loaded. Try again in a moment.</p>'; if (currentPath === path) draw(path); })
          .api({ op: 'body', id: out.article.id });
      }
      if (out.kind === 'search' && out.q && !(out.q in results) && run) {
        run.run.withSuccessHandler((res) => { results[out.q] = (res && res.results) || []; if (currentPath === path) draw(path); })
          .withFailureHandler(() => { results[out.q] = []; if (currentPath === path) draw(path); })
          .api({ op: 'search', q: out.q });
      }
      if (push && run && run.history) {
        try { run.history.push({ p: path }, { p: path }); } catch (e) { /* inside an embed the address bar belongs to the page around it */ }
      }
      if (push) global.scrollTo(0, 0);
    }

    function hydrate() {
      const today = doc.querySelector('[data-today]');
      if (today) today.textContent = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
      doc.querySelectorAll('[data-copy]').forEach((btn) => btn.addEventListener('click', () => {
        const text = btn.getAttribute('data-copy');
        const done = () => { btn.textContent = 'Link copied'; };
        if (global.navigator.clipboard) global.navigator.clipboard.writeText(text).then(done, () => global.prompt('Copy this link', text));
        else global.prompt('Copy this link', text);
      }));
      const filters = doc.querySelector('[data-archive-filters]');
      if (filters) {
        const rows = Array.from(doc.querySelectorAll('.archive-row'));
        const count = filters.querySelector('[data-archive-count]');
        const apply = () => {
          const section = filters.elements.section.value;
          const author = filters.elements.author.value;
          let shown = 0;
          rows.forEach((row) => {
            const ok = (!section || row.dataset.section === section) && (!author || row.dataset.authors.split(' ').indexOf(author) >= 0);
            row.hidden = !ok;
            if (ok) shown++;
          });
          doc.querySelectorAll('[data-month]').forEach((m) => { m.hidden = !m.querySelector('.archive-row:not([hidden])'); });
          count.textContent = shown + (shown === 1 ? ' article' : ' articles');
        };
        filters.addEventListener('change', apply);
        filters.addEventListener('submit', (e) => e.preventDefault());
      }
      const search = doc.querySelector('[data-search]');
      if (search) {
        search.addEventListener('submit', (e) => {
          e.preventDefault();
          const q = search.elements.q.value.trim();
          show('/search/' + (q ? '?q=' + encodeURIComponent(q) : ''), true);
        });
        if (!search.elements.q.value) search.elements.q.focus();
      }
    }

    doc.addEventListener('click', (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target.closest && e.target.closest('a');
      if (!a) return;
      const href = a.getAttribute('href') || '';
      const route = a.getAttribute('data-route') || (/^\/(?!\/)/.test(href) ? href : null);
      if (route) { e.preventDefault(); show(route, true); return; }
      if (href[0] === '#') return;
      // Everything else opens in a new tab, so the reader keeps their place in the paper.
      if (!a.target) a.target = '_blank';
    });
    doc.addEventListener('keydown', (e) => {
      const menu = doc.querySelector('.nav-toggle');
      if (e.key === 'Escape' && menu && menu.open) { menu.open = false; menu.querySelector('summary').focus(); }
    });
    if (run && run.history) {
      try { run.history.setChangeHandler((e) => show((e.location && e.location.parameter && e.location.parameter.p) || '/', false)); } catch (e) { /* not available inside every frame */ }
    }
    show(boot.path || '/', false);
  }

  global.GovernorApp = { createApp: createApp, start: start, summary: summary, formatDate: formatDate, picture: picture, driveImage: driveImage, SECTIONS: SECTIONS };
})(typeof window !== 'undefined' ? window : globalThis);
