/* Personal Notes — front end. Vanilla JS, no dependencies. */
(() => {
  'use strict';

  /* ================================================================ helpers */

  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  };

  const svg = (inner, size = 18) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

  const pinSvg = (size = 16, filled = false) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="${filled ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1z"/></svg>`;

  const ICONS = {
    book: (s = 20) => svg(`<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>`, s),
    search: (s = 16) => svg(`<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>`, s),
    plus: (s = 17) => svg(`<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>`, s),
    sun: (s = 17) => svg(`<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>`, s),
    moon: (s = 17) => svg(`<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>`, s),
    logout: (s = 17) => svg(`<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>`, s),
    share: (s = 16) => svg(`<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>`, s),
    folder: (s = 15) => svg(`<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>`, s),
    edit: (s = 13) => svg(`<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>`, s),
    grip: (s = 12) => svg(`<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/><circle cx="19" cy="5" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="19" cy="19" r="1"/><circle cx="5" cy="5" r="1"/><circle cx="5" cy="12" r="1"/><circle cx="5" cy="19" r="1"/>`, s),
    menu: (s = 19) => svg(`<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>`, s),
    trash: (s = 17) => svg(`<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>`, s),
    x: (s = 14) => svg(`<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>`, s),
    download: (s = 14) => svg(`<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>`, s),
    pen: (s = 26) => svg(`<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>`, s),
    history: (s = 17) => svg(`<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/>`, s),
    chevron: (s = 14) => svg(`<polyline points="6 9 12 15 18 9"/>`, s),
  };

  /* ================================================================ markdown
     A small, safe markdown subset: headings, bold/italic/strike, inline code,
     fenced code blocks, lists (nested + task items), blockquotes, tables,
     links, images, horizontal rules, and LaTeX math ($…$, \(…\), $$…$$,
     \[…\] — Greek letters, sub/superscripts, fractions, roots, operators).
     All input is HTML-escaped before use; math output escapes itself. */

  const MD = (() => {
    const escapeHtml = (s) =>
      s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    // Document-link chips (paperclip + name); rendered as download links.
    const ATTACH_SVG =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>';
    const ATTACH_URL_RE =
      /\[([^\]]+)\]\((\/uploads\/[a-f0-9]{32}\.(?:pdf|docx?|pptx?|xlsx?|csv|txt|zip|odt|odp|ods))\)/g;

    const safeUrl = (raw) => {
      const url = raw.trim();
      if (/^(https?:|mailto:)/i.test(url)) return url;
      if (url.startsWith('/') || url.startsWith('#')) return url;
      return '#';
    };

    /* ---------- LaTeX math (lightweight subset renderer) ----------
       Supports: $inline$ and \(inline\); $$…$$ and \[…\] display blocks;
       _{sub} ^{sup}, Greek letters, common operators/arrows, \frac, \sqrt,
       \mathbb/\mathbf/\text, function names, \left/\right, spacing, accents.
       Unknown commands render upright (visible, never silently dropped).
       Every literal chunk is HTML-escaped — safe by construction. */

    const MATH_SYMS = {
      alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε',
      zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ', lambda: 'λ',
      mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', varpi: 'ϖ', rho: 'ρ', varrho: 'ϱ', sigma: 'σ',
      varsigma: 'ς', tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
      Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ',
      Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
      times: '×', div: '÷', pm: '±', mp: '∓', cdot: '·', ast: '∗', star: '⋆', circ: '∘',
      bullet: '•', oplus: '⊕', ominus: '⊖', otimes: '⊗',
      leq: '≤', le: '≤', geq: '≥', ge: '≥', neq: '≠', ne: '≠', approx: '≈', equiv: '≡',
      sim: '∼', simeq: '≃', cong: '≅', propto: '∝', ll: '≪', gg: '≫',
      in: '∈', notin: '∉', ni: '∋', subset: '⊂', subseteq: '⊆', supset: '⊃', supseteq: '⊇',
      cup: '∪', cap: '∩', emptyset: '∅', varnothing: '∅',
      forall: '∀', exists: '∃', nexists: '∄', neg: '¬', lnot: '¬', land: '∧', lor: '∨',
      infty: '∞', partial: '∂', nabla: '∇', aleph: 'ℵ', hbar: 'ℏ', ell: 'ℓ', prime: '′',
      degree: '°', angle: '∠', perp: '⊥', parallel: '∥',
      sum: '∑', prod: '∏', coprod: '∐', int: '∫', iint: '∬', iiint: '∭', oint: '∮',
      to: '→', rightarrow: '→', longrightarrow: '⟶', rightarrowtail: '↪',
      leftarrow: '←', longleftarrow: '⟵', leftrightarrow: '↔',
      Rightarrow: '⇒', Longrightarrow: '⟹', Leftarrow: '⇐', Leftrightarrow: '⇔',
      mapsto: '↦', uparrow: '↑', downarrow: '↓', updownarrow: '↕',
      ldots: '…', cdots: '⋯', vdots: '⋮', ddots: '⋱', dots: '…', dotsc: '…', dotso: '…',
      langle: '⟨', rangle: '⟩', lceil: '⌈', rceil: '⌉', lfloor: '⌊', rfloor: '⌋',
      triangle: '△', square: '□', imath: 'ı', jmath: 'ȷ', Re: 'ℜ', Im: 'ℑ',
      checkmark: '✓', dagger: '†', ddagger: '‡', S: '§', P: '¶',
      quad: ' ', qquad: ' ', displaystyle: '', textstyle: '', limits: '', nolimits: '',
      nonumber: '', notag: '', centering: '',
    };
    const MATH_BIG = new Set(['sum', 'prod', 'coprod', 'int', 'iint', 'iiint', 'oint']);
    const MATH_FUNCS = new Set([
      'log', 'ln', 'lg', 'exp', 'sin', 'cos', 'tan', 'cot', 'sec', 'csc',
      'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh', 'coth',
      'max', 'min', 'sup', 'inf', 'det', 'dim', 'deg', 'gcd', 'mod', 'arg', 'lim', 'Pr',
    ]);
    const MATH_ACCENTS = {
      hat: '\u0302', widehat: '\u0302', bar: '\u0304', overline: '\u0304',
      vec: '\u20D7', dot: '\u0307', ddot: '\u0308', tilde: '\u0303', widetilde: '\u0303',
    };

    function mathToHtml(src) {
      const s = String(src == null ? '' : src);
      let i = 0;
      let out = '';
      const lit = (t) => { out += escapeHtml(t); };
      const up = (t) => { out += `<span class="mup">${escapeHtml(t)}</span>`; };

      const readGroupRaw = () => {
        if (s[i] !== '{') return '';
        let depth = 0;
        const start = ++i;
        while (i < s.length) {
          if (s[i] === '{') depth += 1;
          else if (s[i] === '}') { if (depth === 0) break; depth -= 1; }
          i += 1;
        }
        const inner = s.slice(start, i);
        if (s[i] === '}') i += 1;
        return inner;
      };
      const readArgRaw = () => {
        while (s[i] === ' ') i += 1;
        if (s[i] === '{') return readGroupRaw();
        if (s[i] === '\\') {
          const start = i;
          i += 1;
          if (/[a-zA-Z]/.test(s[i] || '')) { while (i < s.length && /[a-zA-Z]/.test(s[i])) i += 1; }
          else if (i < s.length) i += 1;
          return s.slice(start, i);
        }
        return i < s.length ? s[i++] : '';
      };

      while (i < s.length) {
        const c = s[i];

        if (c === '\\') {
          i += 1;
          let name = '';
          if (/[a-zA-Z]/.test(s[i] || '')) { while (i < s.length && /[a-zA-Z]/.test(s[i])) name += s[i++]; }
          else if (i < s.length) { name = s[i]; i += 1; }

          if (name === '\\') { out += '<br>'; continue; }
          if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
            const num = readArgRaw();
            const den = readArgRaw();
            out += `<span class="mfrac"><span class="mnum">${mathToHtml(num)}</span><span class="mden">${mathToHtml(den)}</span></span>`;
            continue;
          }
          if (name === 'sqrt') {
            if (s[i] === '[') { while (i < s.length && s[i] !== ']') i += 1; i += 1; }
            const arg = readArgRaw();
            out += `<span class="msqrt">${mathToHtml(arg)}</span>`;
            continue;
          }
          if (name === 'text' || name === 'mathrm' || name === 'operatorname' || name === 'textrm' || name === 'mbox' || name === 'textbf') {
            up(readGroupRaw().replace(/\s+/g, ' '));
            continue;
          }
          if (name === 'mathbb') {
            const g = readGroupRaw();
            let ds = '';
            for (const ch of g) {
              const code = ch.codePointAt(0);
              if (code >= 65 && code <= 90) ds += String.fromCodePoint(0x1D538 + code - 65);
              else if (code >= 97 && code <= 122) ds += String.fromCodePoint(0x1D552 + code - 97);
              else if (code >= 48 && code <= 57) ds += String.fromCodePoint(0x1D7D8 + code - 48);
              else ds += ch;
            }
            lit(ds);
            continue;
          }
          if (name === 'mathbf' || name === 'bm' || name === 'boldsymbol' || name === 'pmb') {
            out += `<b>${mathToHtml(readArgRaw())}</b>`;
            continue;
          }
          if (MATH_ACCENTS[name] != null) {
            out += `<span class="macc">${mathToHtml(readArgRaw())}<span class="maccmark">${MATH_ACCENTS[name]}</span></span>`;
            continue;
          }
          if (name === 'left' || name === 'right' || name === 'big' || name === 'Big' ||
              name === 'bigg' || name === 'Bigg' || name === 'bigl' || name === 'bigr' ||
              name === 'Bigl' || name === 'Bigr') {
            const delim = readArgRaw();
            lit(delim.startsWith('\\') ? (MATH_SYMS[delim.slice(1)] != null ? MATH_SYMS[delim.slice(1)] : delim.slice(1)) : delim);
            continue;
          }
          if (name === 'begin' || name === 'end') { readGroupRaw(); continue; }
          if (name === 'label' || name === 'tag' || name === 'ref' || name === 'color' || name === 'operatorname*') {
            readArgRaw();
            continue;
          }
          if (name === ',' || name === ':') { out += '<span class="mspc mspc-thin"></span>'; continue; }
          if (name === ';') { out += '<span class="mspc mspc-thick"></span>'; continue; }
          if (name === '!') { continue; }
          if (name === ' ') { out += ' '; continue; }
          if (name === 'quad') { out += '<span class="mspc mspc-quad"></span>'; continue; }
          if (name === 'qquad') { out += '<span class="mspc mspc-qquad"></span>'; continue; }
          if (MATH_SYMS[name] != null) {
            if (MATH_BIG.has(name)) out += `<span class="mbig">${MATH_SYMS[name]}</span>`;
            else lit(MATH_SYMS[name]);
            continue;
          }
          if (MATH_FUNCS.has(name)) { up(name); out += '<span class="mspc mspc-thin"></span>'; continue; }
          up(name); // unknown command: keep the name visible
          continue;
        }

        if (c === '{') { out += mathToHtml(readGroupRaw()); continue; }
        if (c === '}') { i += 1; continue; }

        if (c === '_' || c === '^') {
          i += 1;
          const argHtml = mathToHtml(readArgRaw());
          out += c === '_' ? `<sub>${argHtml}</sub>` : `<sup>${argHtml}</sup>`;
          continue;
        }

        if (c === '&' || c === '~') { i += 1; out += ' '; continue; }
        if (c === '%') { while (i < s.length && s[i] !== '\n') i += 1; continue; }
        if (c === '\n') { i += 1; out += ' '; continue; }

        if (/[a-zA-Z]/.test(c)) {
          let run = '';
          while (i < s.length && /[a-zA-Z]/.test(s[i])) run += s[i++];
          out += `<i>${escapeHtml(run)}</i>`;
          continue;
        }
        if (/[0-9.]/.test(c)) {
          let run = '';
          while (i < s.length && /[0-9.]/.test(s[i])) run += s[i++];
          lit(run);
          continue;
        }
        lit(c);
        i += 1;
      }
      return out;
    }


    const listRe = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

    function render(src) {
      if (!src) return '';
      const lines = String(src).replace(/\r\n?/g, '\n').split('\n');
      const out = [];
      let i = 0;

      const inline = (text) => {
        let s = String(text);
        const codeSpans = [];
        s = s.replace(/`([^`\n]+)`/g, (_, code) => {
          codeSpans.push(`<code>${escapeHtml(code)}</code>`);
          return `\uE000${codeSpans.length - 1}\uE001`;
        });
        // LaTeX math, extracted before escaping (mathToHtml escapes itself).
        const mathSpans = [];
        s = s.replace(/\\\(([^]+?)\\\)/g, (_, tex) => {
          mathSpans.push(`<span class="math-inline">${mathToHtml(tex)}</span>`);
          return `\uE100${mathSpans.length - 1}\uE101`;
        });
        s = s.replace(/\$\$([^$]+)\$\$/g, (_, tex) => {
          mathSpans.push(`<span class="math-inline math-inpara">${mathToHtml(tex)}</span>`);
          return `\uE100${mathSpans.length - 1}\uE101`;
        });
        s = s.replace(/\$([^$\n]+)\$/g, (m, tex) => {
          // "$5 to $10" stays text; "$x+1$" becomes math.
          if (!tex.trim() || /^\s/.test(tex) || /\s$/.test(tex)) return m;
          mathSpans.push(`<span class="math-inline">${mathToHtml(tex)}</span>`);
          return `\uE100${mathSpans.length - 1}\uE101`;
        });
        s = escapeHtml(s);
        s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, url) =>
          `<img src="${safeUrl(url)}" alt="${alt}" loading="lazy">`);
        s = s.replace(ATTACH_URL_RE, (_, txt, url) =>
          `<a class="attachment" href="${url}" download="${txt}">${ATTACH_SVG}<span>${txt}</span></a>`);
        s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, txt, url) =>
          `<a href="${safeUrl(url)}" target="_blank" rel="noopener noreferrer">${txt}</a>`);
        s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        s = s.replace(/(^|\W)\*([^ *\n][^*\n]*?)\*(?!\w)/g, '$1<em>$2</em>');
        s = s.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
        s = s.replace(/\uE000(\d+)\uE001/g, (_, idx) => codeSpans[Number(idx)] || '');
        s = s.replace(/\uE100(\d+)\uE101/g, (_, idx) => mathSpans[Number(idx)] || '');
        return s;
      };

      const buildList = (items, pos, level) => {
        const ordered = /\d/.test(items[pos].marker[0]);
        let html = ordered ? '<ol>' : '<ul>';
        while (pos < items.length && items[pos].indent >= level) {
          if (items[pos].indent > level) {
            const [nested, next] = buildList(items, pos, items[pos].indent);
            html = html.replace(/<\/li>$/, nested + '</li>');
            pos = next;
          } else {
            const task = items[pos].text.match(/^\[([ xX])\]\s+(.*)$/);
            if (task) {
              html += `<li class="task"><input type="checkbox"${task[1] === ' ' ? '' : ' checked'}> ${inline(task[2])}</li>`;
            } else {
              html += `<li>${inline(items[pos].text)}</li>`;
            }
            pos += 1;
          }
        }
        return [html + (ordered ? '</ol>' : '</ul>'), pos];
      };

      while (i < lines.length) {
        const line = lines[i];

        if (!line.trim()) { i += 1; continue; }

        // Display math block: \[ … \] or $$ … $$, possibly spanning lines.
        const tv = line.trim();
        if (tv.startsWith('\\[') || tv.startsWith('$$')) {
          const closer = tv.startsWith('$$') ? '$$' : '\\]';
          const parts = [];
          let closed = false;
          const first = tv.slice(2);
          const endInFirst = first.indexOf(closer);
          if (endInFirst >= 0) {
            parts.push(first.slice(0, endInFirst));
            i += 1;
            closed = true;
          } else {
            parts.push(first);
            i += 1;
            while (i < lines.length) {
              const idx = lines[i].indexOf(closer);
              if (idx >= 0) { parts.push(lines[i].slice(0, idx)); i += 1; closed = true; break; }
              parts.push(lines[i]);
              i += 1;
            }
          }
          if (!closed) {
            // No closer found: fall back to rendering the lines as a paragraph.
            const para = [tv].concat(parts.slice(1));
            out.push(`<p>${inline(para.join('\n')).replace(/\n/g, '<br>')}</p>`);
            continue;
          }
          out.push(`<div class="math-block"><span class="math-inner">${mathToHtml(parts.join('\n'))}</span></div>`);
          continue;
        }

        const fence = line.match(/^```([\w+#-]*)\s*$/);
        if (fence) {
          const lang = fence[1];
          const buf = [];
          i += 1;
          while (i < lines.length && !/^```\s*$/.test(lines[i])) { buf.push(lines[i]); i += 1; }
          i += 1;
          out.push(`<pre><code${lang ? ` class="language-${lang}"` : ''}>${escapeHtml(buf.join('\n'))}</code></pre>`);
          continue;
        }

        const heading = line.match(/^(#{1,6})\s+(.*)$/);
        if (heading) {
          const lvl = heading[1].length;
          out.push(`<h${lvl}>${inline(heading[2].replace(/\s+#+\s*$/, ''))}</h${lvl}>`);
          i += 1;
          continue;
        }

        if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) { out.push('<hr>'); i += 1; continue; }

        if (/^\s{0,3}>/.test(line)) {
          const buf = [];
          while (i < lines.length && /^\s{0,3}>/.test(lines[i])) {
            buf.push(lines[i].replace(/^\s{0,3}>\s?/, ''));
            i += 1;
          }
          out.push(`<blockquote>${render(buf.join('\n'))}</blockquote>`);
          continue;
        }

        if (line.includes('|') && i + 1 < lines.length &&
            /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/.test(lines[i + 1])) {
          const cells = (row) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
          const head = cells(line);
          i += 2;
          const rows = [];
          while (i < lines.length && lines[i].includes('|') && lines[i].trim()) { rows.push(cells(lines[i])); i += 1; }
          let html = '<div class="table-wrap"><table><thead><tr>';
          html += head.map((c) => `<th>${inline(c)}</th>`).join('');
          html += '</tr></thead><tbody>';
          for (const row of rows) {
            html += '<tr>' + head.map((_, idx) => `<td>${inline(row[idx] || '')}</td>`).join('') + '</tr>';
          }
          html += '</tbody></table></div>';
          out.push(html);
          continue;
        }

        if (listRe.test(line)) {
          const items = [];
          while (i < lines.length) {
            const m = lines[i].match(listRe);
            if (!m) break;
            items.push({ indent: Math.floor(m[1].replace(/\t/g, '  ').length / 2), marker: m[2], text: m[3] });
            i += 1;
          }
          const [html] = buildList(items, 0, items[0].indent);
          out.push(html);
          continue;
        }

        const buf = [line];
        i += 1;
        while (i < lines.length && lines[i].trim() &&
               !/^(#{1,6}\s|```|\s{0,3}>)/.test(lines[i]) &&
               !listRe.test(lines[i]) &&
               !/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(lines[i])) {
          buf.push(lines[i]);
          i += 1;
        }
        out.push(`<p>${inline(buf.join('\n')).replace(/\n/g, '<br>')}</p>`);
      }
      return out.join('\n');
    }

    return { render };
  })();

  /* ================================================================ state */

  const state = {
    notes: [],
    currentId: null,
    query: '',
    tagFilter: null,
    mode: 'write',
    authMode: 'login',
    user: null,
    registrationOpen: true,
    usersCache: [],
    folders: [],
    folderFilter: null,
    saveTimer: null,
    saving: false,
    conflict: null,
    trashCache: [],
    trashRetentionDays: 30,
    foldersCollapsed: localStorage.getItem('foldersCollapsed') === '1',
    publicBaseUrl: null, // server-configured origin for absolute share links
    previewFont: (() => {
      const v = parseFloat(localStorage.getItem('previewFontSize'));
      return v >= 12 && v <= 24 ? v : 15.5;
    })(),
    theme: localStorage.getItem('theme') ||
      (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
  };

  const ui = {
    auth: $('view-auth'), authLogo: $('auth-logo'), authSub: $('auth-sub'), authForm: $('auth-form'),
    authUser: $('auth-username'), authPass: $('auth-password'), authPass2: $('auth-password2'),
    authSubmit: $('auth-submit'), authError: $('auth-error'), authAlt: $('auth-alt'),
    app: $('app'), sidebar: $('sidebar'), backdrop: $('sidebar-backdrop'), brand: $('brand-icon'),
    themeBtn: $('theme-btn'), logoutBtn: $('logout-btn'), newBtn: $('new-note-btn'), newIc: $('new-note-ic'),
    searchIcon: $('search-icon'), search: $('search-input'), tagFilter: $('tag-filter'), list: $('note-list'),
    addFolderBtn: $('add-folder-btn'), folderList: $('folder-list'), folderFilterEl: $('folder-filter'),
    foldersHead: $('folders-head'), foldersToggle: $('folders-toggle'), foldersLabel: $('folders-label'),
    folderSelect: $('folder-select'),
    exportBtn: $('export-btn'), exportIc: $('export-ic'), count: $('note-count'),
    userChip: $('user-chip'), userAvatar: $('user-avatar'), userNameEl: $('user-name'), adminBadge: $('admin-badge'),
    menuBtn: $('menu-btn'), empty: $('empty-state'), emptyIc: $('empty-ic'), emptyBtn: $('empty-create-btn'),
    editor: $('editor'), title: $('note-title'), pinBtn: $('pin-btn'), tabWrite: $('tab-write'),
    tabPreview: $('tab-preview'), delBtn: $('delete-btn'), tagChips: $('tag-chips'), tagInput: $('tag-input'),
    content: $('note-content'), preview: $('preview'), toolbar: $('editor-toolbar'),
    fontCtl: $('font-ctl'), fontMinus: $('font-minus'), fontPlus: $('font-plus'), fontReset: $('font-reset'),
    shareBtn: $('share-btn'), shareModal: $('share-modal'), shareExpl: $('share-expl'),
    shareRow: $('share-row'), shareLink: $('share-link'), shareCopy: $('share-copy'),
    shareQrRow: $('share-qr-row'), shareQr: $('share-qr'),
    shareCreate: $('share-create'), shareRevoke: $('share-revoke'), shareClose: $('share-close'),
    viewShare: $('view-share'), shareLogo: $('share-logo'), shareTitle: $('share-title'),
    shareMeta: $('share-meta'), shareContent: $('share-content'), shareError: $('share-error'),
    saveStatus: $('save-status'), wordCount: $('word-count'),
    modal: $('modal'), modalTitle: $('modal-title'), modalText: $('modal-text'),
    modalCancel: $('modal-cancel'), modalConfirm: $('modal-confirm'),
    conflictModal: $('conflict-modal'), conflictText: $('conflict-text'),
    conflictMine: $('conflict-mine'), conflictTheirs: $('conflict-theirs'), conflictBoth: $('conflict-both'),
    trashBtn: $('trash-btn'), trashIc: $('trash-ic'), trashCount: $('trash-count'),
    trashModal: $('trash-modal'), trashList: $('trash-list'), trashEmpty: $('trash-empty'),
    trashClose: $('trash-close'), trashRetention: $('trash-retention'),
    historyBtn: $('history-btn'), historyModal: $('history-modal'), historyList: $('history-list'),
    historyDetail: $('history-detail'), historyContent: $('history-content'),
    historyBack: $('history-back'), historyRestoreBtn: $('history-restore'),
    historyClose: $('history-close'), historyCloseRow: $('history-close-row'),
    accountModal: $('account-modal'), acctUser: $('acct-user'),
    pwForm: $('pw-form'), pwCurrent: $('pw-current'), pwNew: $('pw-new'), pwNew2: $('pw-new2'),
    pwSubmit: $('pw-submit'), pwMsg: $('pw-msg'),
    logoutAllBtn: $('logout-all-btn'),
    deleteAcctRow: $('delete-acct-row'), deleteAcctBtn: $('delete-acct-btn'), deleteAcctForm: $('delete-acct-form'),
    deleteAcctPw: $('delete-acct-pw'), deleteAcctCancel: $('delete-acct-cancel'), deleteAcctMsg: $('delete-acct-msg'),
    manageUsersRow: $('manage-users-row'), manageUsersBtn: $('manage-users-btn'), accountClose: $('account-close'),
    usersModal: $('users-modal'), usersList: $('users-list'), usersClose: $('users-close'), regToggle: $('reg-toggle'),
    toast: $('toast'), toastMsg: $('toast-msg'), toastAction: $('toast-action'), metaTheme: $('meta-theme-color'),
  };

  const current = () => state.notes.find((n) => n.id === state.currentId) || null;

  /* ================================================================ api */

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      method: opts.method || 'GET',
      headers: opts.body ? { 'Content-Type': 'application/json' } : {},
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (res.status === 401 && !path.startsWith('/api/login') && !path.startsWith('/api/session') && !path.startsWith('/api/setup')) {
      showAuth('login');
      throw new Error('Signed out');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `Request failed (${res.status})`);
      err.status = res.status;
      err.code = data.code;
      err.payload = data;
      throw err;
    }
    return data;
  }

  /* ================================================================ toast / modal */

  let toastTimer = null;
  function toast(msg, opts = {}) {
    ui.toastMsg.textContent = msg;
    ui.toastAction.classList.toggle('hidden', !opts.action);
    if (opts.action) {
      ui.toastAction.textContent = opts.action;
      ui.toastAction.onclick = () => {
        hideToast();
        opts.onAction && opts.onAction();
      };
    } else {
      ui.toastAction.onclick = null;
    }
    ui.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, 2600);
  }

  function hideToast() {
    clearTimeout(toastTimer);
    ui.toast.classList.remove('show');
    ui.toastAction.onclick = null;
  }

  function confirmModal({ title, text, confirmText = 'Delete' }) {
    return new Promise((resolve) => {
      ui.modalTitle.textContent = title;
      ui.modalText.textContent = text;
      ui.modalConfirm.textContent = confirmText;
      ui.modal.classList.remove('hidden');
      ui.modalConfirm.focus();
      const done = (ok) => {
        ui.modal.classList.add('hidden');
        ui.modalConfirm.onclick = ui.modalCancel.onclick = ui.modal.onclick = null;
        resolve(ok);
      };
      ui.modalConfirm.onclick = () => done(true);
      ui.modalCancel.onclick = () => done(false);
      ui.modal.onclick = (e) => { if (e.target === ui.modal) done(false); };
    });
  }

  /* ================================================================ theme */

  function applyTheme(theme) {
    state.theme = theme;
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    localStorage.setItem('theme', theme);
    ui.themeBtn.innerHTML = theme === 'dark' ? ICONS.sun() : ICONS.moon();
    ui.metaTheme.setAttribute('content', theme === 'dark' ? '#0e0e11' : '#6366f1');
  }

  /* ================================================================ auth */

  function showAuth(mode) {
    state.authMode = mode;
    ui.app.classList.add('hidden');
    ui.auth.classList.remove('hidden');
    ui.authSub.textContent = {
      setup: 'Create the admin account for your server.',
      login: 'Sign in to access your notes.',
      register: 'Register a new account.',
    }[mode] || '';
    const withConfirm = mode !== 'login';
    ui.authPass2.classList.toggle('hidden', !withConfirm);
    ui.authPass2.required = withConfirm;
    ui.authSubmit.textContent = mode === 'login' ? 'Sign in' : 'Create account';
    ui.authPass.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
    const showAlt = mode === 'register' || (mode === 'login' && state.registrationOpen);
    ui.authAlt.classList.toggle('hidden', !showAlt);
    ui.authAlt.textContent = mode === 'login' ? 'New here? Create an account' : 'Back to sign in';
    ui.authError.textContent = '';
    ui.authUser.value = '';
    ui.authPass.value = '';
    ui.authPass2.value = '';
    setTimeout(() => ui.authUser.focus(), 60);
  }

  ui.authAlt.addEventListener('click', () => {
    showAuth(state.authMode === 'login' ? 'register' : 'login');
  });

  ui.authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fail = (msg) => { ui.authError.textContent = msg; };
    const username = ui.authUser.value.trim();
    const pw = ui.authPass.value;
    if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username)) {
      return fail('Username must be 3–32 characters (letters, digits, . _ -).');
    }
    if (pw.length < 8) return fail('Password must be at least 8 characters.');
    if (state.authMode !== 'login' && pw !== ui.authPass2.value) {
      return fail('Passwords do not match.');
    }
    ui.authSubmit.disabled = true;
    try {
      const endpoint = state.authMode === 'login' ? '/api/login' : '/api/register';
      const { user } = await api(endpoint, { method: 'POST', body: { username, password: pw } });
      state.user = user;
      await enterApp();
    } catch (err) {
      fail(err.message);
    } finally {
      ui.authSubmit.disabled = false;
    }
  });

  function resetToAuth(mode) {
    state.notes = [];
    state.currentId = null;
    state.user = null;
    state.query = '';
    ui.search.value = '';
    setTagFilter(null);
    state.folders = [];
    state.folderFilter = null;
    showAuth(mode);
  }

  ui.logoutBtn.addEventListener('click', async () => {
    try { await api('/api/logout', { method: 'POST' }); } catch { /* ignore */ }
    resetToAuth('login');
  });

  /* ================================================================ app entry */

  async function enterApp(user) {
    if (user) state.user = user;
    const [data, foldersData] = await Promise.all([api('/api/notes'), api('/api/folders').catch(() => ({ folders: [] }))]);
    state.notes = data.notes;
    state.folders = foldersData.folders;
    // A fresh session should not inherit a stale search/filter.
    state.query = '';
    ui.search.value = '';
    setTagFilter(null);
    state.folderFilter = null;
    ui.auth.classList.add('hidden');
    ui.app.classList.remove('hidden');
    renderUserChip();
    renderFolders();
    renderFolderFilterBar();
    renderList();
    updateCount();
    const last = localStorage.getItem('lastNoteId');
    const target = state.notes.find((n) => n.id === last) || visibleNotes()[0];
    if (target) selectNote(target.id);
    else showEmptyState();
    refreshTrashCount(); // sidecar to the first paint — never block on it
  }

  function showEmptyState() {
    state.currentId = null;
    ui.editor.classList.add('hidden');
    ui.empty.classList.remove('hidden');
    renderList();
  }

  /* ================================================================ folders */

  const folderCount = (id) => state.notes.filter((n) => n.folderId === id).length;

  // Pinned folders first, otherwise the stored (manually arranged) order.
  const folderDisplayIds = () =>
    [...state.folders]
      .sort((a, b) => (b.pinned === true) - (a.pinned === true))
      .map((f) => f.id);

  async function applyFolderOrder(ids) {
    state.folders = ids.map((id) => state.folders.find((f) => f.id === id));
    renderFolders();
    try {
      await api('/api/folders/reorder', { method: 'POST', body: { ids } });
    } catch (err) {
      toast(err.message);
    }
  }

  function renderFolders() {
    ui.folderList.innerHTML = '';
    let dragId = null;
    const clearDropMarks = () => {
      [...ui.folderList.children].forEach((r) => r.classList.remove('drop-above', 'drop-below'));
    };

    for (const folder of folderDisplayIds().map((id) => state.folders.find((f) => f.id === id))) {
      const row = el('div', 'folder-item' + (state.folderFilter === folder.id ? ' active' : ''));
      row.title = folder.name;
      const ic = el('span', 'f-ic');
      ic.innerHTML = ICONS.folder(14);
      const name = el('span', 'f-name', folder.name);
      const count = el('span', 'f-count', String(folderCount(folder.id)));
      const actions = el('span', 'f-actions');

      const grip = el('button', 'icon-btn f-grip');
      grip.type = 'button';
      grip.title = 'Drag to reorder';
      grip.innerHTML = ICONS.grip(12);

      const pinBtn = el('button', 'icon-btn' + (folder.pinned ? ' active' : ''));
      pinBtn.type = 'button';
      pinBtn.title = folder.pinned ? 'Unpin folder' : 'Pin folder';
      pinBtn.innerHTML = pinSvg(12, folder.pinned === true);

      const renameBtn = el('button', 'icon-btn');
      renameBtn.type = 'button';
      renameBtn.title = 'Rename folder';
      renameBtn.innerHTML = ICONS.edit(12);

      const delBtn = el('button', 'icon-btn danger');
      delBtn.type = 'button';
      delBtn.title = 'Delete folder';
      delBtn.innerHTML = ICONS.trash(12);

      actions.append(grip, pinBtn, renameBtn, delBtn);
      row.append(ic, name, count, actions);
      if (folder.pinned) {
        const pinMark = el('span', 'f-pin');
        pinMark.innerHTML = pinSvg(11, true);
        pinMark.title = 'Pinned';
        row.append(pinMark);
      }

      row.addEventListener('click', () => {
        setFolderFilter(state.folderFilter === folder.id ? null : folder.id);
      });

      grip.addEventListener('mousedown', () => { row.draggable = true; });
      grip.addEventListener('click', (e) => e.stopPropagation());
      row.addEventListener('dragstart', (e) => {
        dragId = folder.id;
        row.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', folder.id);
      });
      row.addEventListener('dragend', () => {
        dragId = null;
        row.draggable = false;
        row.classList.remove('dragging');
        clearDropMarks();
      });
      row.addEventListener('dragover', (e) => {
        if (!dragId || dragId === folder.id) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const rect = row.getBoundingClientRect();
        const above = e.clientY < rect.top + rect.height / 2;
        row.classList.toggle('drop-above', above);
        row.classList.toggle('drop-below', !above);
      });
      row.addEventListener('dragleave', () => row.classList.remove('drop-above', 'drop-below'));
      row.addEventListener('drop', (e) => {
        e.preventDefault();
        const rect = row.getBoundingClientRect();
        const above = e.clientY < rect.top + rect.height / 2;
        clearDropMarks();
        if (!dragId || dragId === folder.id) return;
        const ids = folderDisplayIds();
        const from = ids.indexOf(dragId);
        let to = ids.indexOf(folder.id);
        ids.splice(from, 1);
        if (from < to) to -= 1;
        ids.splice(above ? to : to + 1, 0, dragId);
        applyFolderOrder(ids);
      });

      pinBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          const { folder: updated } = await api(`/api/folders/${folder.id}/pin`, {
            method: 'POST',
            body: { pinned: !(folder.pinned === true) },
          });
          folder.pinned = updated.pinned === true;
          renderFolders();
        } catch (err) {
          toast(err.message);
        }
      });
      renameBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        startFolderEdit({ folder, nameEl: name, mode: 'rename' });
      });
      delBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const ok = await confirmModal({
          title: `Delete folder “${folder.name}”?`,
          text: 'The notes inside are not deleted — they move back to “No folder”.',
          confirmText: 'Delete',
        });
        if (!ok) return;
        try {
          await api(`/api/folders/${folder.id}`, { method: 'DELETE' });
          state.folders = state.folders.filter((f) => f.id !== folder.id);
          for (const n of state.notes) {
            if (n.folderId === folder.id) n.folderId = null;
          }
          if (state.folderFilter === folder.id) setFolderFilter(null);
          renderFolders();
          renderFolderOptions();
          renderList();
          toast('Folder deleted');
        } catch (err) {
          toast(err.message);
        }
      });
      ui.folderList.append(row);
    }
  }

  function startFolderEdit({ folder, nameEl, mode }) {
    const row = mode === 'create' ? el('div', 'folder-item creating') : nameEl.closest('.folder-item');
    const input = el('input', 'folder-input');
    input.maxLength = 64;
    input.placeholder = mode === 'create' ? 'Folder name…' : '';
    if (folder) input.value = folder.name;
    row.classList.add('creating');
    if (mode === 'create') {
      row.append(input);
      ui.folderList.prepend(row);
    } else {
      nameEl.replaceWith(input);
    }
    input.focus();
    if (folder) input.select();
    let done = false;
    const finish = (commit) => {
      if (done) return;
      done = true;
      const value = input.value.trim();
      input.remove();
      row.classList.remove('creating');
      if (mode === 'create') row.remove();
      if (!commit || !value) { if (mode === 'rename') renderFolders(); return; }
      if (mode === 'create') createFolder(value);
      else renameFolder(folder, value);
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('click', (e) => e.stopPropagation());
  }

  async function createFolder(name) {
    try {
      const { folder } = await api('/api/folders', { method: 'POST', body: { name } });
      state.folders.push(folder);
      renderFolders();
      renderFolderOptions();
      setFolderFilter(folder.id);
      toast(`Folder “${folder.name}” created`);
    } catch (err) {
      toast(err.message);
      renderFolders();
    }
  }

  async function renameFolder(folder, name) {
    try {
      const { folder: updated } = await api(`/api/folders/${folder.id}`, { method: 'PUT', body: { name } });
      folder.name = updated.name;
      renderFolders();
      renderFolderOptions();
      renderFolderFilterBar();
    } catch (err) {
      toast(err.message);
      renderFolders();
    }
  }

  ui.addFolderBtn.addEventListener('click', () => {
    if (ui.folderList.querySelector('.folder-input')) return; // one editor at a time
    startFolderEdit({ mode: 'create' });
  });

  /* ---------- fold / unfold the folder list (remembered per browser) ---------- */

  function applyFoldersCollapsed() {
    ui.foldersHead.classList.toggle('collapsed', state.foldersCollapsed);
    ui.foldersToggle.setAttribute('aria-expanded', String(!state.foldersCollapsed));
  }

  function toggleFolders() {
    state.foldersCollapsed = !state.foldersCollapsed;
    localStorage.setItem('foldersCollapsed', state.foldersCollapsed ? '1' : '0');
    applyFoldersCollapsed();
  }

  ui.foldersToggle.addEventListener('click', toggleFolders);
  ui.foldersLabel.addEventListener('click', toggleFolders);
  applyFoldersCollapsed();

  function setFolderFilter(id) {
    state.folderFilter = id;
    renderFolderFilterBar();
    renderFolders();
    renderList();
  }

  function renderFolderFilterBar() {
    ui.folderFilterEl.innerHTML = '';
    if (!state.folderFilter) {
      ui.folderFilterEl.classList.add('hidden');
      return;
    }
    const folder = state.folders.find((f) => f.id === state.folderFilter);
    ui.folderFilterEl.append(el('span', null, folder ? folder.name : 'Folder'));
    const clear = el('button');
    clear.type = 'button';
    clear.title = 'Show all notes';
    clear.innerHTML = ICONS.x(13);
    clear.addEventListener('click', () => setFolderFilter(null));
    ui.folderFilterEl.append(clear);
    ui.folderFilterEl.classList.remove('hidden');
  }

  function renderFolderOptions() {
    const note = current();
    const sel = ui.folderSelect;
    sel.innerHTML = '';
    const none = el('option', null, 'No folder');
    none.value = '';
    sel.append(none);
    for (const f of state.folders) {
      const o = el('option', null, f.name);
      o.value = f.id;
      sel.append(o);
    }
    sel.value = note && note.folderId && state.folders.some((f) => f.id === note.folderId) ? note.folderId : '';
  }

  ui.folderSelect.addEventListener('change', () => {
    const note = current();
    if (!note) return;
    note.folderId = ui.folderSelect.value || null;
    scheduleSave();
    renderFolders();
    renderList();
    const f = state.folders.find((x) => x.id === note.folderId);
    toast(f ? `Moved to “${f.name}”` : 'Moved to No folder');
  });

  /* ================================================================ list */

  function visibleNotes() {
    let list = state.notes;
    if (state.folderFilter) list = list.filter((n) => n.folderId === state.folderFilter);
    if (state.tagFilter) list = list.filter((n) => n.tags.includes(state.tagFilter));
    const q = state.query.trim().toLowerCase();
    if (q) list = list.filter((n) => `${n.title}\n${n.content}\n${n.tags.join(' ')}`.toLowerCase().includes(q));
    return [...list].sort((a, b) => (b.pinned === true) - (a.pinned === true) || b.updatedAt - a.updatedAt);
  }

  function noteSnippet(note) {
    return note.content
      .split('\n')
      .map((l) => l.replace(/^\s*(#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/, ''))
      .join(' ')
      .replace(/[*_`~]+/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);
  }

  function fmtRel(ts) {
    const diff = Date.now() - ts;
    if (diff < 60e3) return 'just now';
    if (diff < 3600e3) return `${Math.floor(diff / 60e3)}m ago`;
    if (diff < 86400e3) return `${Math.floor(diff / 3600e3)}h ago`;
    const d = new Date(ts);
    const opts = d.getFullYear() === new Date().getFullYear()
      ? { month: 'short', day: 'numeric' }
      : { year: 'numeric', month: 'short', day: 'numeric' };
    return d.toLocaleDateString(undefined, opts);
  }

  function renderList() {
    ui.list.innerHTML = '';
    const notes = visibleNotes();
    if (!notes.length) {
      const msg = state.query || state.tagFilter ? 'No notes match.' : 'No notes yet.';
      ui.list.append(el('div', 'list-empty', msg));
      return;
    }
    const pinned = notes.filter((n) => n.pinned);
    const rest = notes.filter((n) => !n.pinned);
    const group = (items, label) => {
      if (!items.length) return;
      ui.list.append(el('div', 'list-label', label));
      for (const note of items) ui.list.append(noteItem(note));
    };
    group(pinned, 'Pinned');
    group(rest, 'Notes');
  }

  function noteItem(note) {
    const item = el('div', 'note-item' + (note.id === state.currentId ? ' active' : ''));
    item.dataset.id = note.id;

    const row = el('div', 'note-item-title');
    const t = el('span', 't' + (note.title ? '' : ' untitled'), note.title || 'Untitled');
    row.append(t);
    if (note.pinned) {
      const pin = el('span', 'pin');
      pin.innerHTML = pinSvg(13, true);
      row.append(pin);
    }
    const snippetText = noteSnippet(note);
    const snippet = el('div', 'note-item-snippet', snippetText || 'No additional text');

    const meta = el('div', 'note-item-meta');
    meta.append(el('span', 'note-time', fmtRel(note.updatedAt)));
    for (const tag of note.tags.slice(0, 4)) {
      const b = el('button', 'mini-tag', tag);
      b.type = 'button';
      b.title = `Filter by “${tag}”`;
      b.addEventListener('click', (e) => { e.stopPropagation(); setTagFilter(tag); });
      meta.append(b);
    }

    item.append(row, snippet, meta);
    item.addEventListener('click', () => selectNote(note.id));
    return item;
  }

  function updateCount() {
    const n = state.notes.length;
    ui.count.textContent = `${n} note${n === 1 ? '' : 's'}`;
    if (state.folders.length) renderFolders(); // keep per-folder counts fresh
  }

  /* ---------- search & tag filter ---------- */

  let searchTimer = null;
  ui.search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.query = ui.search.value;
      renderList();
    }, 120);
  });

  function setTagFilter(tag) {
    state.tagFilter = tag;
    renderTagFilter();
    renderList();
  }

  function renderTagFilter() {
    ui.tagFilter.innerHTML = '';
    if (!state.tagFilter) { ui.tagFilter.classList.add('hidden'); return; }
    ui.tagFilter.append(el('span', null, `#${state.tagFilter}`));
    const clear = el('button');
    clear.type = 'button';
    clear.title = 'Clear filter';
    clear.innerHTML = ICONS.x(13);
    clear.addEventListener('click', () => setTagFilter(null));
    ui.tagFilter.append(clear);
    ui.tagFilter.classList.remove('hidden');
  }

  /* ================================================================ editor */

  async function selectNote(id, opts = {}) {
    await flushSave();
    await pruneIfEmpty(state.currentId);
    const note = state.notes.find((n) => n.id === id);
    if (!note) {
      const fallback = visibleNotes()[0];
      if (fallback) return selectNote(fallback.id);
      showEmptyState();
      return;
    }
    state.currentId = id;
    localStorage.setItem('lastNoteId', id);
    ui.empty.classList.add('hidden');
    ui.editor.classList.remove('hidden');
    ui.title.value = note.title;
    ui.content.value = note.content;
    renderTagChips();
    renderFolderOptions();
    updatePinBtn();
    updateShareBtn();
    updateWordCount();
    // Opening an existing note lands in preview; only new notes start in edit mode.
    setMode(opts.edit ? 'write' : 'preview');
    renderList();
    closeDrawer();
    if (opts.focusTitle) ui.title.focus();
  }

  function setSaveStatus(status, extra = '') {
    ui.saveStatus.className = status;
    ui.saveStatus.querySelector('.status-text').textContent = {
      idle: '',
      pending: 'Unsaved changes',
      saving: 'Saving…',
      saved: extra || 'All changes saved',
      error: 'Save failed — will retry on next edit',
    }[status] || '';
  }

  function pendingSave() {
    return state.saveTimer !== null || state.saving;
  }

  async function flushSave() {
    state.conflict = null;
    ui.conflictModal.classList.add('hidden');
    if (state.saveTimer !== null) {
      clearTimeout(state.saveTimer);
      state.saveTimer = null;
      await saveCurrentNote();
    }
  }

  async function saveCurrentNote() {
    const note = current();
    if (!note) return;
    await saveNote(note);
  }

  async function saveNote(note) {
    state.saving = true;
    setSaveStatus('saving');
    try {
      const { note: updated } = await api(`/api/notes/${note.id}`, {
        method: 'PUT',
        body: {
          title: note.title, content: note.content, tags: note.tags,
          pinned: note.pinned, folderId: note.folderId || null, rev: note.rev,
        },
      });
      note.updatedAt = updated.updatedAt;
      note.rev = updated.rev;
      state.saving = false;
      const time = new Date(note.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      setSaveStatus('saved', `Saved ${time}`);
      renderList();
    } catch (err) {
      state.saving = false;
      if (err.code === 'conflict' && err.payload && err.payload.note) {
        handleConflict(note, err.payload.note);
        setSaveStatus('pending'); // not an error — waiting for the user to choose
        return;
      }
      if (err.code === 'trashed') {
        setSaveStatus('pending');
        toast('This note was deleted on another device', {
          action: 'Restore',
          onAction: async () => {
            try {
              const { note: restored } = await api(`/api/notes/${note.id}/restore`, { method: 'POST' });
              note.rev = restored.rev;
              await saveNote(note);
            } catch (e2) {
              toast(`Restore failed: ${e2.message}`);
            }
          },
        });
        return;
      }
      setSaveStatus('error');
      toast(`Save failed: ${err.message}`);
    }
  }

  function scheduleSave() {
    if (state.conflict) return; // autosave must not spin against a conflict
    setSaveStatus('pending');
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => {
      state.saveTimer = null;
      saveCurrentNote();
    }, 700);
  }

  // Remove a note that was created but never written in.
  async function pruneIfEmpty(id) {
    if (!id) return;
    const note = state.notes.find((n) => n.id === id);
    if (!note) return;
    if (!note.title.trim() && !note.content.trim() && !note.tags.length) {
      try { await api(`/api/notes/${id}`, { method: 'DELETE' }); } catch { /* ignore */ }
      state.notes = state.notes.filter((n) => n.id !== id);
      if (localStorage.getItem('lastNoteId') === id) localStorage.removeItem('lastNoteId');
      updateCount();
    }
  }

  /* ---------- conflict resolution ---------- */

  const fmtDateTime = (ts) =>
    new Date(ts).toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  function handleConflict(note, serverNote) {
    state.conflict = {
      noteId: note.id,
      server: serverNote,
      local: { title: note.title, content: note.content, tags: [...note.tags], pinned: note.pinned, folderId: note.folderId },
    };
    ui.conflictText.textContent =
      `Your copy was last saved ${fmtDateTime(note.updatedAt)}; the other device saved at ${fmtDateTime(serverNote.updatedAt)}. ` +
      'Nothing is lost either way — a version you discard stays in Version history.';
    ui.conflictModal.classList.remove('hidden');
    ui.conflictMine.focus();
  }

  function closeConflict() {
    state.conflict = null;
    ui.conflictModal.classList.add('hidden');
  }

  // Replace the local buffer with the server's state.
  function applyServerNote(note, serverNote) {
    note.title = serverNote.title;
    note.content = serverNote.content;
    note.tags = [...(serverNote.tags || [])];
    note.pinned = serverNote.pinned === true;
    note.folderId = serverNote.folderId != null ? serverNote.folderId : null;
    note.updatedAt = serverNote.updatedAt;
    note.rev = serverNote.rev;
    if (state.currentId === note.id) {
      ui.title.value = note.title;
      ui.content.value = note.content;
      renderTagChips();
      renderFolderOptions();
      updatePinBtn();
      updateWordCount();
      if (state.mode === 'preview') renderPreview();
    }
  }

  ui.conflictMine.addEventListener('click', async () => {
    const c = state.conflict;
    if (!c) return;
    const note = state.notes.find((n) => n.id === c.noteId);
    closeConflict();
    if (!note) return;
    note.rev = c.server.rev; // overwrite the newer version with ours
    setSaveStatus('pending');
    await saveNote(note);
  });

  ui.conflictTheirs.addEventListener('click', () => {
    const c = state.conflict;
    if (!c) return;
    const note = state.notes.find((n) => n.id === c.noteId);
    closeConflict();
    if (!note) return;
    applyServerNote(note, c.server);
    setSaveStatus('idle');
    renderList();
    toast('Loaded the newer version');
  });

  ui.conflictBoth.addEventListener('click', async () => {
    const c = state.conflict;
    if (!c) return;
    const note = state.notes.find((n) => n.id === c.noteId);
    closeConflict();
    if (!note) return;
    try {
      const { note: copy } = await api('/api/notes', {
        method: 'POST',
        body: {
          title: `${c.local.title || 'Untitled'} (conflict copy)`,
          content: c.local.content, tags: c.local.tags, pinned: c.local.pinned,
          folderId: c.local.folderId || null,
        },
      });
      state.notes.unshift(copy);
      updateCount();
    } catch (err) {
      toast(`Could not create the copy: ${err.message}`);
    }
    applyServerNote(note, c.server); // the original goes back to the server state
    setSaveStatus('idle');
    renderList();
    toast('Kept both — your version was saved as a copy');
  });

  function updateWordCount() {
    const note = current();
    if (!note) { ui.wordCount.textContent = ''; return; }
    const words = note.content.trim() ? note.content.trim().split(/\s+/).length : 0;
    ui.wordCount.textContent = `${words.toLocaleString()} words · ${note.content.length.toLocaleString()} chars`;
  }

  function updatePinBtn() {
    const note = current();
    ui.pinBtn.innerHTML = pinSvg(16, !!note && note.pinned);
    ui.pinBtn.classList.toggle('active', !!note && note.pinned);
  }

  /* ---------- title & content bindings ---------- */

  ui.title.addEventListener('input', () => {
    const note = current();
    if (!note) return;
    note.title = ui.title.value;
    scheduleSave();
  });

  ui.title.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      ui.content.focus();
      ui.content.setSelectionRange(ui.content.value.length, ui.content.value.length);
    }
  });

  ui.content.addEventListener('input', () => {
    const note = current();
    if (!note) return;
    note.content = ui.content.value;
    updateWordCount();
    scheduleSave();
  });

  // Tab inserts two spaces; Enter continues lists.
  ui.content.addEventListener('keydown', (e) => {
    const note = current();
    if (!note) return;
    const { selectionStart: s, selectionEnd: en, value } = ui.content;

    if (e.key === 'Tab') {
      e.preventDefault();
      ui.content.setRangeText('  ', s, en, 'end');
      note.content = ui.content.value;
      scheduleSave();
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey && s === en) {
      const lineStart = value.lastIndexOf('\n', s - 1) + 1;
      const line = value.slice(lineStart, s);
      const m = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
      if (!m) return;
      e.preventDefault();
      if (!m[3].trim()) {
        // Empty list item — remove the marker and exit the list.
        ui.content.setRangeText('', lineStart, s, 'end');
      } else {
        let marker = m[2];
        const num = marker.match(/^(\d+)([.)])$/);
        if (num) marker = `${Number(num[1]) + 1}${num[2]}`;
        ui.content.setRangeText(`\n${m[1]}${marker} `, s, s, 'end');
      }
      note.content = ui.content.value;
      updateWordCount();
      scheduleSave();
    }
  });

  /* ---------- tags ---------- */

  function renderTagChips() {
    ui.tagChips.innerHTML = '';
    const note = current();
    if (!note) return;
    for (const tag of note.tags) {
      const chip = el('span', 'chip', tag);
      const x = el('button');
      x.type = 'button';
      x.title = `Remove ${tag}`;
      x.innerHTML = ICONS.x(12);
      x.addEventListener('click', () => removeTag(tag));
      chip.append(x);
      ui.tagChips.append(chip);
    }
  }

  function addTag() {
    const note = current();
    if (!note) return;
    const tag = ui.tagInput.value.trim().replace(/,+$/, '').slice(0, 32);
    ui.tagInput.value = '';
    if (!tag) return;
    if (!note.tags.includes(tag)) {
      note.tags.push(tag);
      renderTagChips();
      scheduleSave();
    }
  }

  function removeTag(tag) {
    const note = current();
    if (!note) return;
    note.tags = note.tags.filter((t) => t !== tag);
    if (state.tagFilter === tag) setTagFilter(null);
    renderTagChips();
    scheduleSave();
  }

  ui.tagInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag();
    } else if (e.key === 'Backspace' && !ui.tagInput.value) {
      const note = current();
      if (note && note.tags.length) removeTag(note.tags[note.tags.length - 1]);
    }
  });
  ui.tagInput.addEventListener('blur', addTag);

  /* ---------- markdown toolbar ---------- */

  const TB_ICONS = {
    bold: (s) => svg(`<path d="M6 4h8a4 4 0 0 1 0 8H6z"/><path d="M6 12h9a4 4 0 0 1 0 8H6z"/>`, s),
    italic: (s) => svg(`<line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/>`, s),
    heading: (s) => svg(`<path d="M6 4v16"/><path d="M18 4v16"/><path d="M6 12h12"/>`, s),
    bullet: (s) => svg(`<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>`, s),
    ordered: (s) => svg(`<line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/>`, s),
    task: (s) => svg(`<polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>`, s),
    quote: (s) => svg(`<path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/>`, s),
    code: (s) => svg(`<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>`, s),
    fence: (s) => svg(`<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>`, s),
    image: (s) => svg(`<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>`, s),
    attach: (s) => svg(`<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>`, s),
    link: (s) => svg(`<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>`, s),
    table: (s) => svg(`<path d="M12 3v18"/><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/>`, s),
  };

  // Apply a programmatic edit: restore focus/selection, then sync autosave.
  function applyEdit(start, end) {
    ui.content.focus();
    ui.content.setSelectionRange(start, end);
    const note = current();
    if (note) {
      note.content = ui.content.value;
      updateWordCount();
      scheduleSave();
    }
  }

  function wrapSelection(marker) {
    const { selectionStart: s, selectionEnd: e, value } = ui.content;
    const sel = value.slice(s, e);
    const before = value.slice(0, s);
    const after = value.slice(e);
    // toggle off: markers inside the selection…
    if (sel.length >= marker.length * 2 && sel.startsWith(marker) && sel.endsWith(marker)) {
      const inner = sel.slice(marker.length, sel.length - marker.length);
      ui.content.setRangeText(inner, s, e);
      return applyEdit(s, s + inner.length);
    }
    // …or just outside it
    if (before.endsWith(marker) && after.startsWith(marker)) {
      ui.content.setRangeText(sel, s - marker.length, e + marker.length);
      return applyEdit(s - marker.length, e - marker.length);
    }
    ui.content.setRangeText(marker + sel + marker, s, e);
    if (sel) return applyEdit(s, s + sel.length + marker.length * 2);
    return applyEdit(s + marker.length, s + marker.length); // empty selection: cursor inside
  }

  const LINE_TYPES = {
    heading: /^#{1,6}\s+/,
    bullet: /^[-*+]\s+(?!\[)/,
    task: /^[-*+]\s+\[[ xX]\]\s+/,
    ordered: /^\d+[.)]\s+/,
    quote: /^>\s?/,
  };
  const MARKER_RE = /^(\s*)([-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+|#{1,6}\s+|>\s?)(.*)$/;

  function toggleLines(type) {
    const makers = {
      heading: () => '## ',
      bullet: () => '- ',
      task: () => '- [ ] ',
      ordered: (i) => `${i + 1}. `,
      quote: () => '> ',
    };
    const { selectionStart: s, selectionEnd: e, value } = ui.content;
    const ls = value.lastIndexOf('\n', s - 1) + 1;
    let le = value.indexOf('\n', e);
    if (le === -1) le = value.length;
    const lines = value.slice(ls, le).split('\n');
    const meaningful = lines.filter((l) => l.trim());
    const allOn = meaningful.length > 0 && meaningful.every((l) => LINE_TYPES[type].test(l));
    const out = lines.map((l, i) => {
      if (!l.trim()) return l;
      const m = l.match(MARKER_RE);
      const ws = m ? m[1] : l.match(/^\s*/)[0];
      const rest = m ? m[3] : l.slice(ws.length);
      return allOn ? ws + rest : ws + makers[type](i) + rest;
    }).join('\n');
    ui.content.setRangeText(out, ls, le);
    applyEdit(ls, ls + out.length);
  }

  function insertLink() {
    const { selectionStart: s, selectionEnd: e, value } = ui.content;
    const sel = value.slice(s, e);
    const label = sel || 'link text';
    const url = /^(https?:\/\/|mailto:|#|\/)/i.test(sel) ? sel : 'https://';
    ui.content.setRangeText(`[${label}](${url})`, s, e);
    const urlStart = s + label.length + 3;
    applyEdit(urlStart, urlStart + url.length);
  }

  function insertFence() {
    const { selectionStart: s, selectionEnd: e, value } = ui.content;
    const sel = value.slice(s, e);
    const nlb = s > 0 && value[s - 1] !== '\n' ? '\n\n' : '';
    const body = sel ? sel.replace(/\n?$/, '\n') : '\n';
    const insert = `${nlb}\`\`\`\n${body}\`\`\``;
    ui.content.setRangeText(insert, s, e);
    if (sel) applyEdit(s + nlb.length, s + nlb.length + insert.length);
    else applyEdit(s + nlb.length + 4, s + nlb.length + 4);
  }

  function insertTable() {
    const { selectionStart: s, value } = ui.content;
    const nlb = s > 0 && value[s - 1] !== '\n' ? '\n\n' : '';
    ui.content.setRangeText(`${nlb}| Column | Column |\n| --- | --- |\n|  |  |\n`, s, s);
    const first = s + nlb.length + 2;
    applyEdit(first, first + 'Column'.length);
  }

  /* ---------- image / document upload ---------- */

  async function uploadFile(file) {
    const res = await fetch('/api/uploads', {
      method: 'POST',
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
        // Header values may only hold ISO-8859-1, so fetch() throws on names
        // with Chinese (or other non-Latin-1) characters. Percent-encode the
        // name; the server decodes it back.
        'X-File-Name': encodeURIComponent(file.name || 'file'),
      },
      body: file,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Upload failed (${res.status})`);
    return data.url;
  }

  async function insertFiles(files) {
    const note = current();
    if (!note) return;
    const noteId = note.id;
    toast(files.length > 1 ? `Uploading ${files.length} files…` : 'Uploading…');
    const parts = [];
    for (const file of files) {
      try {
        const url = await uploadFile(file);
        const safeName = String(file.name || 'file').replace(/[[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100) || 'file';
        if (file.type && file.type.startsWith('image/')) {
          parts.push(`\n![${safeName}](${url})\n`);
        } else {
          parts.push(`\n[${safeName}](${url})\n`);
        }
      } catch (err) {
        toast(`Upload failed: ${err.message}`);
      }
    }
    if (!parts.length) return;
    const chunk = parts.join('');
    if (state.currentId === noteId) {
      const ta = ui.content;
      ta.setRangeText(chunk, ta.selectionStart, ta.selectionEnd, 'end');
      const end = ta.selectionStart;
      applyEdit(end, end);
    } else if (state.notes.includes(note)) {
      // The user switched notes while uploading: append to the original note.
      note.content += chunk;
      await saveNote(note);
    }
  }

  function initUploads() {
    const images = el('input');
    images.type = 'file';
    images.accept = 'image/png,image/jpeg,image/gif,image/webp';
    images.multiple = true;
    images.classList.add('hidden');
    document.body.append(images);
    ui.fileInput = images;
    images.addEventListener('change', () => {
      const files = [...images.files];
      images.value = '';
      if (files.length) insertFiles(files);
    });

    const docs = el('input');
    docs.type = 'file';
    docs.accept = '.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.csv,.odt,.odp,.ods';
    docs.multiple = true;
    docs.classList.add('hidden');
    document.body.append(docs);
    ui.docInput = docs;
    docs.addEventListener('change', () => {
      const files = [...docs.files];
      docs.value = '';
      if (files.length) insertFiles(files);
    });
  }

  // Paste a screenshot: if the clipboard has image files (and no text),
  // upload them instead of pasting nothing.
  ui.content.addEventListener('paste', (e) => {
    const items = e.clipboardData ? [...e.clipboardData.items] : [];
    const images = items.filter((it) => it.kind === 'file' && it.type.startsWith('image/'));
    const hasText = items.some((it) => it.kind === 'string' && it.type === 'text/plain');
    if (!images.length || hasText) return;
    e.preventDefault();
    const files = images.map((it) => it.getAsFile()).filter(Boolean);
    if (files.length) insertFiles(files);
  });

  const TOOLBAR = [
    { id: 'bold', label: 'Bold', run: () => wrapSelection('**') },
    { id: 'italic', label: 'Italic', run: () => wrapSelection('*') },
    { id: 'heading', label: 'Heading', run: () => toggleLines('heading') },
    { id: 'bullet', label: 'Bullet list', run: () => toggleLines('bullet') },
    { id: 'ordered', label: 'Numbered list', run: () => toggleLines('ordered') },
    { id: 'task', label: 'Task list', run: () => toggleLines('task') },
    { id: 'quote', label: 'Quote', run: () => toggleLines('quote') },
    { id: 'code', label: 'Inline code', run: () => wrapSelection('`') },
    { id: 'fence', label: 'Code block', run: insertFence },
    { id: 'image', label: 'Insert image', run: () => ui.fileInput && ui.fileInput.click() },
    { id: 'attach', label: 'Attach file (PDF, Word, PPT…)', run: () => ui.docInput && ui.docInput.click() },
    { id: 'link', label: 'Link', run: insertLink },
    { id: 'table', label: 'Table', run: insertTable },
  ];

  function initToolbar() {
    ui.toolbar.innerHTML = '';
    for (const item of TOOLBAR) {
      const b = el('button', 'icon-btn tb-btn');
      b.type = 'button';
      b.title = item.label;
      b.setAttribute('aria-label', item.label);
      b.innerHTML = TB_ICONS[item.id](16);
      // Keep the textarea's selection when clicking a toolbar button.
      b.addEventListener('mousedown', (ev) => ev.preventDefault());
      b.addEventListener('click', item.run);
      ui.toolbar.append(b);
    }
  }

  /* ---------- pin / delete ---------- */

  ui.pinBtn.addEventListener('click', () => {
    const note = current();
    if (!note) return;
    note.pinned = !note.pinned;
    updatePinBtn();
    scheduleSave();
    renderList();
  });

  ui.delBtn.addEventListener('click', async () => {
    const note = current();
    if (!note) return;
    await flushSave();
    const ok = await confirmModal({
      title: 'Move to trash?',
      text: `“${note.title || 'Untitled'}” will be moved to the trash. You can restore it for ${state.trashRetentionDays} days.`,
      confirmText: 'Move to trash',
    });
    if (!ok) return;
    const id = note.id;
    try {
      await api(`/api/notes/${id}`, { method: 'DELETE' });
    } catch (err) {
      toast(`Delete failed: ${err.message}`);
      return;
    }
    state.notes = state.notes.filter((n) => n.id !== id);
    if (localStorage.getItem('lastNoteId') === id) localStorage.removeItem('lastNoteId');
    updateCount();
    refreshTrashCount();
    const next = visibleNotes()[0];
    if (next) selectNote(next.id);
    else showEmptyState();
    toast('Moved to trash', {
      action: 'Undo',
      onAction: async () => {
        try {
          const { note: restored } = await api(`/api/notes/${id}/restore`, { method: 'POST' });
          state.notes.push(restored);
          updateCount();
          refreshTrashCount();
          renderList();
          toast('Note restored');
        } catch (err) {
          toast(`Restore failed: ${err.message}`);
        }
      },
    });
  });

  /* ---------- new note ---------- */

  async function newNote() {
    await flushSave();
    await pruneIfEmpty(state.currentId);
    try {
      const { note } = await api('/api/notes', { method: 'POST', body: { title: '', content: '', tags: [], folderId: state.folderFilter || null } });
      state.notes.unshift(note);
      updateCount();
      state.query = '';
      ui.search.value = '';
      setTagFilter(null);
      await selectNote(note.id, { focusTitle: true, edit: true });
    } catch (err) {
      toast(`Could not create note: ${err.message}`);
    }
  }

  ui.newBtn.addEventListener('click', newNote);
  ui.emptyBtn.addEventListener('click', newNote);

  /* ---------- write / preview ---------- */

  function setMode(mode) {
    state.mode = mode;
    ui.tabWrite.classList.toggle('active', mode === 'write');
    ui.tabPreview.classList.toggle('active', mode === 'preview');
    ui.content.classList.toggle('hidden', mode === 'preview');
    ui.toolbar.classList.toggle('hidden', mode !== 'write');
    ui.fontCtl.classList.toggle('hidden', mode !== 'preview');
    ui.preview.classList.toggle('hidden', mode !== 'preview');
    if (mode === 'preview') renderPreview();
  }

  function renderPreview() {
    const note = current();
    ui.preview.innerHTML = note ? MD.render(note.content) : '';
  }

  /* Interactive task checkboxes: clicking one flips the matching
     "- [ ]"/"- [x]" marker in the markdown source. Lines inside fenced
     code blocks are skipped, mirroring the renderer. */
  const TASK_LINE_RE = /^((?:\s{0,3}>\s?)*\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\](?=\s)/;
  const FENCE_OPEN_RE = /^```[\w+#-]*\s*$/;
  const FENCE_CLOSE_RE = /^```\s*$/;

  function toggleTaskLine(content, index) {
    const lines = content.split('\n');
    let inFence = false;
    let seen = 0;
    for (let i = 0; i < lines.length; i++) {
      const stripped = lines[i].replace(/^(\s{0,3}>\s?)+/, '');
      if (inFence) {
        if (FENCE_CLOSE_RE.test(stripped)) inFence = false;
        continue;
      }
      if (FENCE_OPEN_RE.test(stripped)) { inFence = true; continue; }
      const m = lines[i].match(TASK_LINE_RE);
      if (!m) continue;
      if (seen === index) {
        const flipped = m[2] === ' ' ? 'x' : ' ';
        lines[i] = lines[i].replace(TASK_LINE_RE, (full, prefix) => `${prefix}[${flipped}]`);
        return lines.join('\n');
      }
      seen += 1;
    }
    return null;
  }

  ui.preview.addEventListener('change', (e) => {
    if (e.target.tagName !== 'INPUT' || e.target.type !== 'checkbox') return;
    const note = current();
    if (!note) return;
    const index = [...ui.preview.querySelectorAll('input[type=checkbox]')].indexOf(e.target);
    const updated = toggleTaskLine(note.content, index);
    if (updated === null) {
      e.target.checked = !e.target.checked; // no matching source line: revert
      return;
    }
    note.content = updated;
    ui.content.value = updated;
    updateWordCount();
    scheduleSave();
    const scroll = ui.preview.scrollTop;
    renderPreview();
    ui.preview.scrollTop = scroll;
  });

  ui.tabWrite.addEventListener('click', () => setMode('write'));
  ui.tabPreview.addEventListener('click', () => setMode('preview'));

  /* ================================================================ misc ui */

  ui.themeBtn.addEventListener('click', () => {
    applyTheme(state.theme === 'dark' ? 'light' : 'dark');
  });

  function openDrawer() {
    ui.sidebar.classList.add('open');
    ui.backdrop.classList.remove('hidden');
  }
  function closeDrawer() {
    ui.sidebar.classList.remove('open');
    ui.backdrop.classList.add('hidden');
  }
  ui.menuBtn.addEventListener('click', openDrawer);
  ui.backdrop.addEventListener('click', closeDrawer);

  ui.exportBtn.addEventListener('click', () => {
    const data = JSON.stringify({ app: 'personal-notes', exportedAt: new Date().toISOString(), folders: state.folders, notes: state.notes }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `notes-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Backup downloaded');
  });

  /* ================================================================ trash */

  function renderTrashCount() {
    ui.trashCount.textContent = state.trashCache.length ? `(${state.trashCache.length})` : '';
  }

  async function refreshTrashCount() {
    try {
      const data = await api('/api/trash');
      state.trashCache = data.notes || [];
    } catch {
      state.trashCache = []; // old server without trash — nothing to count
    }
    renderTrashCount();
  }

  function openTrashModal() {
    ui.trashRetention.textContent = state.trashRetentionDays;
    renderTrashList();
    ui.trashModal.classList.remove('hidden');
  }

  function renderTrashList() {
    ui.trashList.innerHTML = '';
    if (!state.trashCache.length) {
      ui.trashList.append(el('div', 'list-empty', 'Trash is empty.'));
      ui.trashEmpty.classList.add('hidden');
      return;
    }
    ui.trashEmpty.classList.remove('hidden');
    for (const note of state.trashCache) {
      const row = el('div', 'trash-row');
      const meta = el('div', 'trash-meta');
      meta.append(el('span', 'trash-title', note.title || 'Untitled'));
      meta.append(el('span', 'trash-sub', `deleted ${fmtRel(note.deletedAt)}`));
      const actions = el('div', 'trash-actions');
      const restore = el('button', 'btn sm');
      restore.type = 'button';
      restore.textContent = 'Restore';
      restore.addEventListener('click', async () => {
        try {
          const { note: restoredNote } = await api(`/api/notes/${note.id}/restore`, { method: 'POST' });
          state.trashCache = state.trashCache.filter((n) => n.id !== note.id);
          state.notes.push(restoredNote);
          updateCount();
          renderTrashCount();
          renderTrashList();
          renderList();
          toast('Note restored');
        } catch (err) {
          toast(`Restore failed: ${err.message}`);
        }
      });
      const forever = el('button', 'btn sm danger-outline');
      forever.type = 'button';
      forever.textContent = 'Delete forever';
      forever.addEventListener('click', async () => {
        const ok = await confirmModal({
          title: 'Delete forever?',
          text: `“${note.title || 'Untitled'}” will be permanently removed, including its version history. This cannot be undone.`,
        });
        if (!ok) return;
        try {
          await api(`/api/notes/${note.id}/purge`, { method: 'POST' });
          state.trashCache = state.trashCache.filter((n) => n.id !== note.id);
          renderTrashCount();
          renderTrashList();
          toast('Deleted forever');
        } catch (err) {
          toast(`Delete failed: ${err.message}`);
        }
      });
      actions.append(restore, forever);
      row.append(meta, actions);
      ui.trashList.append(row);
    }
  }

  ui.trashBtn.addEventListener('click', () => {
    openTrashModal();
    refreshTrashCount().then(renderTrashList);
  });
  ui.trashClose.addEventListener('click', () => ui.trashModal.classList.add('hidden'));
  ui.trashModal.addEventListener('click', (e) => {
    if (e.target === ui.trashModal) ui.trashModal.classList.add('hidden');
  });

  ui.trashEmpty.addEventListener('click', async () => {
    const ok = await confirmModal({
      title: 'Empty trash?',
      text: `All ${state.trashCache.length} notes in the trash will be permanently removed, including their version history.`,
      confirmText: 'Empty trash',
    });
    if (!ok) return;
    try {
      await api('/api/trash/empty', { method: 'POST' });
      state.trashCache = [];
      renderTrashCount();
      renderTrashList();
      toast('Trash emptied');
    } catch (err) {
      toast(err.message);
    }
  });

  /* ================================================================ history */

  const fmtBytes = (n) => {
    if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
    if (n >= 1024) return `${(n / 1024).toFixed(1)} kB`;
    return `${n} B`;
  };

  let historyRev = null; // the revision currently shown in the detail view

  function closeHistoryModal() {
    ui.historyModal.classList.add('hidden');
    historyRev = null;
  }

  async function openHistoryModal() {
    const note = current();
    if (!note) return;
    ui.historyDetail.classList.add('hidden');
    ui.historyCloseRow.classList.remove('hidden');
    ui.historyList.innerHTML = '';
    ui.historyList.append(el('div', 'list-empty', 'Loading…'));
    ui.historyModal.classList.remove('hidden');
    try {
      const { revisions } = await api(`/api/notes/${note.id}/history`);
      ui.historyList.innerHTML = '';
      if (!revisions.length) {
        ui.historyList.append(el('div', 'list-empty', 'No saved versions yet'));
        return;
      }
      for (const r of revisions) {
        const row = el('button', 'history-row');
        row.type = 'button';
        row.append(el('span', 'history-when', fmtRel(r.ts)));
        row.append(el('span', 'history-size', `${fmtBytes(r.bytes || 0)} · ${r.kind}`));
        row.addEventListener('click', () => showRevision(note.id, r.rev));
        ui.historyList.append(row);
      }
    } catch (err) {
      ui.historyList.innerHTML = '';
      ui.historyList.append(el('div', 'list-empty', err.message));
    }
  }

  async function showRevision(noteId, rev) {
    try {
      const { revision } = await api(`/api/notes/${noteId}/history/${rev}`);
      historyRev = rev;
      ui.historyContent.innerHTML = MD.render(revision.content);
      ui.historyList.classList.add('hidden');
      ui.historyDetail.classList.remove('hidden');
      ui.historyCloseRow.classList.add('hidden');
    } catch (err) {
      toast(err.message);
    }
  }

  ui.historyBtn.addEventListener('click', openHistoryModal);
  ui.historyClose.addEventListener('click', closeHistoryModal);
  ui.historyModal.addEventListener('click', (e) => {
    if (e.target === ui.historyModal) closeHistoryModal();
  });
  ui.historyBack.addEventListener('click', () => {
    ui.historyDetail.classList.add('hidden');
    ui.historyList.classList.remove('hidden');
    ui.historyCloseRow.classList.remove('hidden');
    historyRev = null;
  });

  ui.historyRestoreBtn.addEventListener('click', async () => {
    const note = current();
    if (!note || historyRev == null) return;
    const ok = await confirmModal({
      title: 'Restore this version?',
      text: 'The current content will be kept in Version history, so this can be undone too.',
      confirmText: 'Restore',
    });
    if (!ok) return;
    try {
      const { note: restored } = await api(`/api/notes/${note.id}/history/${historyRev}/restore`, {
        method: 'POST',
        body: { rev: note.rev },
      });
      closeHistoryModal();
      applyServerNote(note, restored);
      setSaveStatus('idle');
      renderList();
      toast('Version restored');
    } catch (err) {
      if (err.code === 'conflict' && err.payload && err.payload.note) {
        closeHistoryModal();
        handleConflict(note, err.payload.note);
        return;
      }
      toast(`Restore failed: ${err.message}`);
    }
  });

  /* ================================================================ account */

  const AVATAR_COLORS = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#8b5cf6', '#ef4444'];
  function avatarColor(name) {
    let h = 0;
    for (const ch of String(name)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
    return AVATAR_COLORS[h % AVATAR_COLORS.length];
  }
  function avatarEl(name, lg = false) {
    const a = el('span', 'avatar' + (lg ? ' lg' : ''));
    a.textContent = (String(name || '?').trim().charAt(0) || '?').toUpperCase();
    a.style.background = avatarColor(name);
    return a;
  }

  function renderUserChip() {
    if (!state.user) return;
    ui.userAvatar.textContent = (state.user.name.trim().charAt(0) || '?').toUpperCase();
    ui.userAvatar.style.background = avatarColor(state.user.name);
    ui.userNameEl.textContent = state.user.name;
    ui.adminBadge.classList.toggle('hidden', !state.user.isAdmin);
  }

  function fmtDate(ts) {
    return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function closeAccountModal() {
    ui.accountModal.classList.add('hidden');
    ui.pwForm.reset();
    ui.pwMsg.textContent = '';
    ui.pwMsg.className = 'form-msg';
    ui.deleteAcctForm.classList.add('hidden');
    ui.deleteAcctForm.reset();
    ui.deleteAcctMsg.textContent = '';
    ui.deleteAcctRow.classList.remove('hidden');
  }

  ui.userChip.addEventListener('click', () => {
    if (!state.user) return;
    ui.acctUser.innerHTML = '';
    ui.acctUser.append(avatarEl(state.user.name, true));
    const info = el('div');
    const nameRow = el('div', 'acct-name', state.user.name);
    if (state.user.isAdmin) nameRow.append(el('span', 'mini-badge accent', 'Admin'));
    info.append(nameRow);
    info.append(el('div', 'acct-sub', `${state.notes.length} note${state.notes.length === 1 ? '' : 's'} · joined ${fmtDate(state.user.createdAt)}`));
    ui.acctUser.append(info);
    ui.manageUsersRow.classList.toggle('hidden', !state.user.isAdmin);
    ui.accountModal.classList.remove('hidden');
  });
  ui.accountClose.addEventListener('click', closeAccountModal);
  ui.accountModal.addEventListener('click', (e) => {
    if (e.target === ui.accountModal) closeAccountModal();
  });

  /* ---------- change password ---------- */

  ui.pwForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    ui.pwMsg.className = 'form-msg';
    ui.pwMsg.textContent = '';
    const current = ui.pwCurrent.value;
    const next = ui.pwNew.value;
    if (next.length < 8) { ui.pwMsg.textContent = 'New password must be at least 8 characters.'; return; }
    if (next !== ui.pwNew2.value) { ui.pwMsg.textContent = 'New passwords do not match.'; return; }
    ui.pwSubmit.disabled = true;
    try {
      await api('/api/password', { method: 'POST', body: { current, next } });
      ui.pwMsg.classList.add('ok');
      ui.pwMsg.textContent = 'Password updated. Other devices were signed out.';
      ui.pwForm.reset();
    } catch (err) {
      ui.pwMsg.textContent = err.message;
    } finally {
      ui.pwSubmit.disabled = false;
    }
  });

  /* ---------- sign out everywhere ---------- */

  ui.logoutAllBtn.addEventListener('click', async () => {
    const ok = await confirmModal({
      title: 'Sign out everywhere?',
      text: 'All devices — including this one — will be signed out.',
      confirmText: 'Sign out',
    });
    if (!ok) return;
    try { await api('/api/logout-all', { method: 'POST' }); } catch { /* ignore */ }
    closeAccountModal();
    resetToAuth('login');
  });

  /* ---------- delete own account ---------- */

  ui.deleteAcctBtn.addEventListener('click', () => {
    ui.deleteAcctRow.classList.add('hidden');
    ui.deleteAcctForm.classList.remove('hidden');
    ui.deleteAcctPw.focus();
  });
  ui.deleteAcctCancel.addEventListener('click', () => {
    ui.deleteAcctForm.classList.add('hidden');
    ui.deleteAcctForm.reset();
    ui.deleteAcctMsg.textContent = '';
    ui.deleteAcctRow.classList.remove('hidden');
  });
  ui.deleteAcctForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    ui.deleteAcctMsg.textContent = '';
    try {
      await api('/api/account', { method: 'DELETE', body: { password: ui.deleteAcctPw.value } });
      closeAccountModal();
      resetToAuth('login');
      toast('Account deleted');
    } catch (err) {
      ui.deleteAcctMsg.textContent = err.message;
    }
  });

  /* ---------- admin: manage users ---------- */

  async function refreshUsers() {
    const data = await api('/api/users');
    state.usersCache = data.users;
    ui.regToggle.checked = data.registrationOpen;
    renderUsers();
  }

  function renderUsers() {
    ui.usersList.innerHTML = '';
    for (const u of state.usersCache) {
      const row = el('div', 'user-row');
      row.append(avatarEl(u.name));
      const meta = el('div', 'meta');
      const n = el('div', 'n', u.name);
      if (u.id === state.user.id) n.append(el('span', 'mini-badge', 'You'));
      if (u.isAdmin) n.append(el('span', 'mini-badge accent', 'Admin'));
      meta.append(n);
      meta.append(el('div', 's', `${u.noteCount} note${u.noteCount === 1 ? '' : 's'} · joined ${fmtDate(u.createdAt)}`));
      row.append(meta);
      if (u.id !== state.user.id) {
        const actions = el('div', 'actions');
        const promo = el('button', 'btn sm', u.isAdmin ? 'Remove admin' : 'Make admin');
        promo.type = 'button';
        promo.addEventListener('click', async () => {
          try {
            await api(`/api/users/${u.id}/admin`, { method: 'POST', body: { admin: !u.isAdmin } });
            await refreshUsers();
          } catch (err) { toast(err.message); }
        });
        const del = el('button', 'btn sm danger-outline', 'Delete');
        del.type = 'button';
        del.addEventListener('click', async () => {
          const ok = await confirmModal({
            title: `Delete ${u.name}?`,
            text: 'Their account and all of their notes will be permanently removed.',
          });
          if (!ok) return;
          try {
            await api(`/api/users/${u.id}`, { method: 'DELETE' });
            await refreshUsers();
            toast('User deleted');
          } catch (err) { toast(err.message); }
        });
        actions.append(promo, del);
        row.append(actions);
      }
      ui.usersList.append(row);
    }
  }

  ui.manageUsersBtn.addEventListener('click', async () => {
    try {
      await refreshUsers();
      ui.usersModal.classList.remove('hidden');
    } catch (err) {
      toast(err.message);
    }
  });
  ui.usersClose.addEventListener('click', () => ui.usersModal.classList.add('hidden'));
  ui.usersModal.addEventListener('click', (e) => {
    if (e.target === ui.usersModal) ui.usersModal.classList.add('hidden');
  });

  ui.regToggle.addEventListener('change', async () => {
    const open = ui.regToggle.checked;
    try {
      const r = await api('/api/settings/registration', { method: 'POST', body: { open } });
      state.registrationOpen = r.registrationOpen;
      toast(open ? 'Registration opened' : 'Registration closed');
    } catch (err) {
      ui.regToggle.checked = !open;
      toast(err.message);
    }
  });

  /* ================================================================ sharing */

  function updateShareBtn() {
    const note = current();
    ui.shareBtn.innerHTML = ICONS.share(16);
    ui.shareBtn.classList.toggle('active', !!(note && note.share));
  }

  function renderShareModal(note) {
    ui.shareExpl.textContent = note.share
      ? 'Anyone with this link can read the note — no account needed. The link stops working if you revoke it or delete the note.'
      : 'Create a public link so anyone can read this note without an account. You can revoke it at any time.';
    ui.shareRow.classList.toggle('hidden', !note.share);
    ui.shareCreate.classList.toggle('hidden', !!note.share);
    ui.shareRevoke.classList.toggle('hidden', !note.share);
    ui.shareLink.value = note.share ? `${state.publicBaseUrl || location.origin}/share/${note.share.token}` : '';
    if (note.share) {
      ui.shareQr.src = `/share/${note.share.token}/qr.svg`;
      ui.shareQrRow.classList.remove('hidden');
    } else {
      ui.shareQr.removeAttribute('src');
      ui.shareQrRow.classList.add('hidden');
    }
  }

  function closeShareModal() {
    ui.shareModal.classList.add('hidden');
  }

  ui.shareBtn.addEventListener('click', () => {
    const note = current();
    if (!note) return;
    renderShareModal(note);
    ui.shareModal.classList.remove('hidden');
    if (note.share) { ui.shareLink.focus(); ui.shareLink.select(); }
  });
  ui.shareClose.addEventListener('click', closeShareModal);
  // An old server (or a disabled encoder) has no QR endpoint: hide the row.
  ui.shareQr.onerror = () => {
    ui.shareQr.removeAttribute('src');
    ui.shareQrRow.classList.add('hidden');
  };
  ui.shareModal.addEventListener('click', (e) => {
    if (e.target === ui.shareModal) closeShareModal();
  });

  ui.shareCreate.addEventListener('click', async () => {
    const note = current();
    if (!note) return;
    try {
      const r = await api(`/api/notes/${note.id}/share`, { method: 'POST' });
      note.share = r.share;
      renderShareModal(note);
      updateShareBtn();
      ui.shareLink.focus();
      ui.shareLink.select();
      toast('Share link created');
    } catch (err) {
      toast(err.message);
    }
  });

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const ta = el('textarea');
      ta.value = text;
      document.body.append(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch { /* ignore */ }
      ta.remove();
      return ok;
    }
  }

  ui.shareCopy.addEventListener('click', async () => {
    if (!ui.shareLink.value) return;
    toast(await copyText(ui.shareLink.value) ? 'Link copied' : 'Copy failed — select the link manually');
  });

  ui.shareRevoke.addEventListener('click', async () => {
    const note = current();
    if (!note || !note.share) return;
    const ok = await confirmModal({
      title: 'Revoke share link?',
      text: 'Everyone who has the link will immediately lose access.',
      confirmText: 'Revoke',
    });
    if (!ok) return;
    try {
      await api(`/api/notes/${note.id}/share`, { method: 'DELETE' });
      note.share = null;
      renderShareModal(note);
      updateShareBtn();
      toast('Share link revoked');
    } catch (err) {
      toast(err.message);
    }
  });

  /* ---------- public share page ---------- */

  async function showSharePage(token) {
    ui.auth.classList.add('hidden');
    ui.app.classList.add('hidden');
    ui.viewShare.classList.remove('hidden');
    ui.shareLogo.innerHTML = ICONS.book(18);
    try {
      const res = await fetch(`/api/share/${token}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      document.title = `${data.title || 'Shared note'} — Notes`;
      ui.shareTitle.textContent = data.title || 'Untitled';
      ui.shareMeta.textContent =
        `Shared note · last updated ${new Date(data.updatedAt).toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
      ui.shareContent.innerHTML = MD.render(data.content);
      // Attachments and images are only served to sessions or with the
      // share token — tag them so the server lets them through.
      for (const img of ui.shareContent.querySelectorAll('img')) {
        const src = img.getAttribute('src');
        if (src && src.startsWith('/uploads/')) img.src = `${src}?s=${token}`;
      }
      for (const a of ui.shareContent.querySelectorAll('a.attachment')) {
        const href = a.getAttribute('href');
        if (href && href.startsWith('/uploads/')) a.setAttribute('href', `${href}?s=${token}`);
      }
    } catch {
      document.title = 'Note unavailable — Notes';
      ui.shareTitle.textContent = 'Note unavailable';
      ui.shareMeta.textContent = '';
      ui.shareContent.innerHTML = '';
      ui.shareError.textContent = 'This link is invalid, or the owner has stopped sharing this note.';
      ui.shareError.classList.remove('hidden');
    }
  }

  /* ================================================================ preview font size */

  const PREVIEW_FONT = { def: 15.5, min: 12, max: 24 };

  function setPreviewFont(px) {
    state.previewFont = Math.min(PREVIEW_FONT.max, Math.max(PREVIEW_FONT.min, px));
    ui.preview.style.fontSize = `${state.previewFont}px`;
    ui.fontReset.textContent = `${Math.round((state.previewFont / PREVIEW_FONT.def) * 100)}%`;
    ui.fontMinus.title = `Smaller (now ${state.previewFont}px)`;
    ui.fontPlus.title = `Larger (now ${state.previewFont}px)`;
    localStorage.setItem('previewFontSize', String(state.previewFont));
  }

  ui.fontMinus.addEventListener('click', () => setPreviewFont(state.previewFont - 1));
  ui.fontPlus.addEventListener('click', () => setPreviewFont(state.previewFont + 1));
  ui.fontReset.addEventListener('click', () => setPreviewFont(PREVIEW_FONT.def));

  /* ---------- keyboard shortcuts ---------- */

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      const key = e.key.toLowerCase();
      if (key === 's') {
        e.preventDefault();
        flushSave();
      } else if (key === 'k' && !ui.app.classList.contains('hidden')) {
        e.preventDefault();
        ui.search.focus();
        ui.search.select();
      }
    }
    if (e.key === 'Escape') {
      if (!ui.modal.classList.contains('hidden')) ui.modalCancel.click();
      // the conflict modal deliberately has no Escape shortcut: every choice
      // discards something, so it must be picked explicitly
      else if (!ui.historyModal.classList.contains('hidden')) closeHistoryModal();
      else if (!ui.trashModal.classList.contains('hidden')) ui.trashModal.classList.add('hidden');
      else if (!ui.usersModal.classList.contains('hidden')) ui.usersModal.classList.add('hidden');
      else if (!ui.accountModal.classList.contains('hidden')) closeAccountModal();
      else if (!ui.shareModal.classList.contains('hidden')) closeShareModal();
    }
  });

  window.addEventListener('beforeunload', (e) => {
    if (pendingSave() && !ui.editor.classList.contains('hidden')) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  /* ================================================================ init */

  function initIcons() {
    ui.authLogo.innerHTML = ICONS.book(26);
    ui.brand.innerHTML = ICONS.book(20);
    ui.searchIcon.innerHTML = ICONS.search(16);
    ui.newIc.innerHTML = ICONS.plus();
    ui.addFolderBtn.innerHTML = ICONS.plus(14);
    ui.foldersToggle.innerHTML = ICONS.chevron();
    ui.logoutBtn.innerHTML = ICONS.logout();
    ui.menuBtn.innerHTML = ICONS.menu(20);
    ui.delBtn.innerHTML = ICONS.trash();
    ui.trashIc.innerHTML = ICONS.trash(14);
    ui.historyBtn.innerHTML = ICONS.history();
    ui.exportIc.innerHTML = ICONS.download();
    ui.emptyIc.innerHTML = ICONS.pen(26);
    updatePinBtn();
  }

  (async function init() {
    applyTheme(state.theme);

    // Public share link route: /share/<token> — render read-only, no app.
    const shareMatch = location.pathname.match(/^\/share\/([a-f0-9]{32})$/);
    if (shareMatch) {
      showSharePage(shareMatch[1]);
      return;
    }

    initIcons();
    initToolbar();
    initUploads();
    setPreviewFont(state.previewFont);
    updateShareBtn();
    applyTheme(state.theme);
    setSaveStatus('idle');
    try {
      const s = await api('/api/session');
      state.registrationOpen = s.registrationOpen !== false;
      if (Number.isFinite(s.trashRetentionDays)) state.trashRetentionDays = s.trashRetentionDays;
      state.publicBaseUrl = typeof s.publicBaseUrl === 'string' ? s.publicBaseUrl : null;
      if (s.needsSetup) showAuth('setup');
      else if (s.authenticated) {
        state.user = s.user;
        await enterApp();
      } else showAuth('login');
    } catch {
      showAuth('login');
    }
  })();
})();
