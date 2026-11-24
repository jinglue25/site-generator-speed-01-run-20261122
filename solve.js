// Independent implementation of the makefun-site dialect.
const own = Object.hasOwn;
const cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escape = s => s.replace(/[&<>"']/g, c => entities[c]);
const slugCache = new Map();
function slug(s) {
  let v = slugCache.get(s);
  if (v !== undefined) return v;
  // Lowercase only ASCII: Unicode lowercase can introduce ASCII (e.g. Kelvin
  // has already been normalized); preserve all other characters as separators.
  v = s.normalize('NFKD').replace(/\p{M}/gu, '').replace(/[A-Z]/g, c => c.toLowerCase())
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64).replace(/-+$/, '') || 'untitled';
  if (slugCache.size > 16384) slugCache.clear();
  slugCache.set(s, v);
  return v;
}
function unique(s, taken) {
  let v = s, n = 2;
  while (taken.has(v)) v = s + '-' + n++;
  taken.add(v);
  return v;
}
const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const longDate = d => `${+d.slice(8)} ${months[+d.slice(5, 7) - 1]} ${d.slice(0, 4)}`;
const dirOf = p => p.slice(0, Math.max(0, p.lastIndexOf('/')));

const fmKeys = new Set(['title', 'date', 'tags', 'draft', 'layout', 'slug', 'summary']);
function frontMatter(text) {
  const endFirst = text.indexOf('\n');
  if ((endFirst < 0 ? text : text.slice(0, endFirst)) !== '---') return { error: 'no front matter' };
  let pos = endFirst < 0 ? text.length : endFirst + 1, lineNo = 2;
  const lines = [];
  let body;
  while (pos <= text.length && endFirst >= 0) {
    let end = text.indexOf('\n', pos);
    if (end < 0) end = text.length;
    const line = text.slice(pos, end);
    if (line === '---') { body = end === text.length ? '' : text.slice(end + 1); break; }
    lines.push(line);
    if (end === text.length) break;
    pos = end + 1;
  }
  if (body === undefined) return { error: 'the front matter is not closed' };
  const data = {};
  for (const line of lines) {
    const no = lineNo++;
    if (/^[ \t]*$/.test(line) || line[0] === '#') continue;
    const m = /^([a-z_]+):(?: (.*))?$/.exec(line);
    if (!m) return { error: `line ${no} is not "key: value"` };
    const key = m[1], raw = (m[2] ?? '').replace(/[ \t]+$/, '');
    if (!fmKeys.has(key)) return { error: `unknown key "${key}"` };
    if (own(data, key)) return { error: `key "${key}" is given twice` };
    if (raw === '') return { error: `key "${key}" has no value` };
    let v = raw, error;
    switch (key) {
      case 'title': case 'summary':
        if (raw[0] === '"') {
          if (raw.length < 2 || !raw.endsWith('"')) error = 'a quoted string is not closed';
          else {
            v = '';
            for (let i = 1; i < raw.length - 1; i++) {
              const c = raw[i];
              if (c === '\\') {
                const next = raw[i + 1];
                if ((next !== '"' && next !== '\\') || i + 1 === raw.length - 1) { error = 'a quoted string holds an escape other than \\" or \\\\'; break; }
                v += next; i++;
              } else if (c === '"') { error = 'a quoted string holds a stray quote'; break; }
              else v += c;
            }
          }
        } else if (raw[0] === '[') error = 'a bare string opens on [';
        if (error) error = `key "${key}": ${error}`;
        break;
      case 'date': {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
        const y = m ? +m[1] : 0, mo = m ? +m[2] : 0, d = m ? +m[3] : 0;
        const days = mo === 2 ? (y % 4 === 0 && y % 100 !== 0 || y % 400 === 0 ? 29 : 28) : [4, 6, 9, 11].includes(mo) ? 30 : 31;
        if (!m || y < 1970 || y > 2099 || mo < 1 || mo > 12 || d < 1 || d > days) error = 'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)';
        break;
      }
      case 'tags':
        if (raw[0] !== '[' || !raw.endsWith(']')) error = 'key "tags": not a list [a, b]';
        else {
          const inner = raw.slice(1, -1);
          v = inner.trim() === '' ? [] : inner.split(',').map(t => t.trim());
          if (v.some(t => t === '' || !/^[^"[\]]+$/.test(t))) error = 'key "tags": an empty tag, or one holding " [ or ]';
        }
        break;
      case 'draft':
        if (raw === 'true' || raw === 'false') v = raw === 'true';
        else error = 'key "draft": true or false';
        break;
      case 'layout': if (!/^[a-z0-9-]+$/.test(raw)) error = 'key "layout": not a template name'; break;
      case 'slug': if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(raw) || raw.length > 64) error = 'key "slug": not a slug'; break;
    }
    if (error) return { error };
    data[key] = v;
  }
  return own(data, 'title') ? { data, body } : { error: 'no title' };
}

function lookup(scope, path) {
  let s = scope;
  while (s && !own(s.vars, path[0])) s = s.parent;
  if (!s) return undefined;
  let v = s.vars[path[0]];
  for (let i = 1; i < path.length; i++) {
    if (v === null || typeof v !== 'object' || !own(v, path[i])) return undefined;
    v = v[path[i]];
  }
  return v;
}
function asText(v) {
  switch (typeof v) {
    case 'string': return v;
    case 'number': return String(v);
    case 'boolean': return v ? 'true' : 'false';
    default: return Array.isArray(v) ? v.map(asText).join(', ') : '';
  }
}
const truth = v => Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null && v !== false && v !== '' && v !== 0;

// Parse all tokens before checking block structure: lexical errors take precedence.
function compileTemplate(name, src) {
  const fail = reason => { throw new Error(`template "${name}": ${reason}`); };
  const path = s => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(s)) fail(`${JSON.stringify(s)} is not a path`);
    return s.split('.');
  };
  const tokens = [];
  let pos = 0, text = '';
  while (pos < src.length) {
    const start = src.indexOf('{', pos);
    if (start < 0 || start === src.length - 1) { text += src.slice(pos); break; }
    const c = src[start + 1];
    if (c !== '{' && c !== '%') { text += src.slice(pos, start + 1); pos = start + 1; continue; }
    text += src.slice(pos, start);
    if (c === '{') {
      const raw = src[start + 2] === '{', width = raw ? 3 : 2;
      const end = src.indexOf(raw ? '}}}' : '}}', start + width);
      if (end < 0) fail(`a ${raw ? '{{{' : '{{'} is not closed`);
      if (text) tokens.push(['text', text]);
      text = '';
      tokens.push([raw ? 'raw' : 'var', path(src.slice(start + width, end).trim())]);
      pos = end + width;
    } else {
      const end = src.indexOf('%}', start + 2);
      if (end < 0) fail('a {% is not closed');
      const after = end + 2, ls = src.lastIndexOf('\n', start - 1) + 1;
      const nl = src.indexOf('\n', after), le = nl < 0 ? src.length : nl;
      const standalone = /^[ \t]*$/.test(src.slice(ls, start)) && /^[ \t]*$/.test(src.slice(after, le));
      if (standalone) text = text.slice(0, text.length - (start - ls));
      if (text) tokens.push(['text', text]);
      text = '';
      tokens.push(['tag', src.slice(start + 2, end).trim()]);
      pos = standalone ? (nl < 0 ? src.length : nl + 1) : after;
    }
  }
  if (text) tokens.push(['text', text]);
  let code = 'let o="",v;';
  const stack = [], paths = [], free = new Set(), includes = [];
  let serial = 0;
  const bound = () => {
    const names = new Set();
    for (const block of stack) if (block.kind === 'for') { names.add(block.name); names.add('loop'); }
    return names;
  };
  const get = p => {
    if (!bound().has(p[0])) free.add(p[0]);
    const n = paths.length; paths.push(p); return `L(s,P[${n}])`;
  };
  for (const [kind, val] of tokens) {
    if (kind === 'text') code += `o+=${JSON.stringify(val)};`;
    else if (kind === 'raw' || kind === 'var') code += `o+=${kind === 'var' ? 'E(T(' : 'T('}${get(val)}${kind === 'var' ? '))' : ')'};`;
    else {
      let m;
      const top = stack[stack.length - 1];
      if ((m = /^for ([A-Za-z_][A-Za-z0-9_]*) in (\S+)$/.exec(val))) {
        const expr = get(path(m[2])), id = serial++;
        stack.push({ kind: 'for', id, name: m[1] });
        code += `{const a${id}=${expr};if(Array.isArray(a${id})){const p${id}=s;for(let k${id}=0;k${id}<a${id}.length;k${id}++){if(!(k${id} in a${id}))continue;s={vars:{[${JSON.stringify(m[1])}]:a${id}[k${id}],loop:{index:k${id}+1,first:k${id}===0,last:k${id}===a${id}.length-1,length:a${id}.length}},parent:p${id}};`;
      } else if ((m = /^if (not )?(\S+)$/.exec(val))) {
        code += `if(${m[1] ? '!' : ''}B(${get(path(m[2]))})){`;
        stack.push({ kind: 'if', alternate: false });
      } else if (val === 'else') {
        if (!top || top.kind !== 'if' || top.alternate) fail('an else outside an if');
        top.alternate = true; code += '}else{';
      } else if (val === 'endfor' || val === 'endif') {
        if (!top || top.kind !== (val === 'endfor' ? 'for' : 'if')) fail(`an ${val} with no open ${val.slice(3)}`);
        stack.pop();
        code += top.kind === 'if' ? '}' : `}s=p${top.id};}}`;
      } else if ((m = /^include "([a-z0-9-]+)"$/.exec(val))) {
        includes.push({ name: m[1], bound: bound() });
        code += `if(d<8){const f=t.get(${JSON.stringify(m[1])});if(f)o+=f(s,t,d+1);}`;
      } else fail(`{% ${val} %} is not a tag`);
    }
  }
  if (stack.length) fail(`a ${stack[stack.length - 1].kind} is not closed`);
  const fn = new Function('L', 'T', 'E', 'B', 'P', `return function(s,t,d){${code}return o;}`)(lookup, asText, escape, truth, paths);
  fn.free = free;
  fn.includes = includes;
  return fn;
}
const templateCache = new Map();
function templatesFor(input, report) {
  const templates = new Map();
  for (const name of Object.keys(input).sort(cmp)) {
    const src = input[name];
    let entry = templateCache.get(name);
    if (!entry || entry.src !== src) {
      try { entry = { src, fn: compileTemplate(name, src) }; }
      catch (e) { entry = { src, error: e.message }; }
      if (templateCache.size > 1024) templateCache.clear();
      templateCache.set(name, entry);
    }
    if (entry.error !== undefined) report.push(entry.error);
    else templates.set(name, entry.fn);
  }
  return templates;
}

// All render data is immutable for the lifetime of a build. Cache fragments by
// their free bindings, including transitive include dependencies at each depth.
// Local loop variables are removed from the dependency set at each include site.
function memoizeTemplates(compiled) {
  const dependencies = new Map(), result = new Map();
  function deps(name, depth) {
    const key = name + ':' + depth;
    if (dependencies.has(key)) return dependencies.get(key);
    const fn = compiled.get(name), roots = new Set(fn.free);
    if (depth < 8) for (const inc of fn.includes) if (compiled.has(inc.name)) {
      for (const root of deps(inc.name, depth + 1)) if (!inc.bound.has(root)) roots.add(root);
    }
    const paths = [...roots];
    dependencies.set(key, paths);
    return paths;
  }
  for (const [name, fn] of compiled) {
    const levels = [];
    result.set(name, (scope, templates, depth) => {
      let level = levels[depth];
      if (!level) levels[depth] = level = { paths: deps(name, depth).map(x => [x]), cache: new Map() };
      let cache = level.cache;
      for (const path of level.paths) {
        const value = lookup(scope, path);
        let next = cache.get(value);
        if (!next) { next = new Map(); cache.set(value, next); }
        cache = next;
      }
      let text = cache.get(memoizeTemplates);
      if (text === undefined) { text = fn(scope, templates, depth); cache.set(memoizeTemplates, text); }
      return text;
    });
  }
  return result;
}

const escapable = new Set('\\`*_[]()#+-.!>');
function findClose(s, target, from, single = false) {
  for (let i = from; i <= s.length - target.length; i++) {
    if (s[i] === '\\' && i + 1 < s.length && escapable.has(s[i + 1])) { i++; continue; }
    if (single) {
      if (s[i] !== '*') continue;
      if (s[i + 1] === '*') { i++; continue; }
      return i;
    }
    if (s.startsWith(target, i)) return i;
  }
  return -1;
}
function inline(s, link) {
  let out = '', i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length && escapable.has(s[i + 1])) {
      out += entities[s[i + 1]] ?? s[i + 1]; i += 2;
    } else if (c === '`') {
      const j = s.indexOf('`', i + 1);
      if (j > i + 1) { out += '<code>' + escape(s.slice(i + 1, j)) + '</code>'; i = j + 1; }
      else { out += '`'; i++; }
    } else if (c === '*') {
      const strong = s[i + 1] === '*', n = strong ? 2 : 1;
      const j = findClose(s, strong ? '**' : '*', i + n, !strong);
      if (j > i + n) { const tag = strong ? 'strong' : 'em'; out += `<${tag}>${inline(s.slice(i + n, j), link)}</${tag}>`; i = j + n; }
      else { out += strong ? '**' : '*'; i += n; }
    } else if (c === '[') {
      const k = findClose(s, ']', i + 1), end = k >= 0 && s[k + 1] === '(' ? s.indexOf(')', k + 2) : -1;
      const target = end < 0 ? '' : s.slice(k + 2, end);
      if (target && !/\s/.test(target)) { out += `<a href="${escape(link(target))}">${inline(s.slice(i + 1, k), link)}</a>`; i = end + 1; }
      else { out += '['; i++; }
    } else {
      let j = i + 1;
      while (j < s.length && s[j] !== '\\' && s[j] !== '`' && s[j] !== '*' && s[j] !== '[') j++;
      out += escape(s.slice(i, j)); i = j;
    }
  }
  return out;
}

const blank = /^[ \t]*$/;
const fence = /^```([A-Za-z0-9_+-]*)[ \t]*$/;
const heading = /^(#{1,6})[ \t]+(.*?)[ \t]*$/;
const hr = /^(?:---|\*\*\*)[ \t]*$/;
const bullet = /^[-*] (.*)$/;
const ordered = /^(\d{1,9})\. (.*)$/;
const trimLine = s => s.replace(/^[ \t]+|[ \t]+$/g, '');
function headingOf(s) { const m = heading.exec(s); return m && m[2] !== '' ? m : null; }
function markdown(body, link) {
  const lines = body.split('\n'), ids = new Set(), toc = [];
  let i = 0, html = '', excerpt = null;
  while (i < lines.length) {
    const line = lines[i];
    if (blank.test(line)) { i++; continue; }
    let m;
    if ((m = fence.exec(line))) {
      const lang = m[1]; let code = ''; i++;
      while (i < lines.length && !/^```[ \t]*$/.test(lines[i])) code += escape(lines[i++]) + '\n';
      i++;
      html += `<pre><code${lang ? ` class="language-${escape(lang)}"` : ''}>${code}</code></pre>\n`;
    } else if ((m = headingOf(line))) {
      const level = m[1].length, id = unique(slug(m[2]), ids), text = inline(m[2], link);
      html += `<h${level} id="${id}">${text}</h${level}>\n`;
      if (level === 2 || level === 3) toc.push({ level, id, html: text });
      i++;
    } else if (hr.test(line)) { html += '<hr>\n'; i++; }
    else if (line[0] === '>') {
      const parts = [];
      while (i < lines.length && lines[i][0] === '>') { const s = trimLine(lines[i++].replace(/^> ?/, '')); if (s !== '') parts.push(s); }
      html += '<blockquote>\n' + (parts.length ? '<p>' + inline(parts.join('\n'), link) + '</p>\n' : '') + '</blockquote>\n';
    } else {
      const b = bullet.exec(line), o = b ? null : ordered.exec(line);
      if (b || o) {
        const marker = o ? ordered : bullet, items = [];
        while (i < lines.length) {
          m = marker.exec(lines[i]);
          if (m) { items.push(trimLine(m[o ? 2 : 1])); i++; }
          else if (/^ {2,}\S/.test(lines[i])) { items[items.length - 1] += '\n' + trimLine(lines[i++]); }
          else break;
        }
        const tag = o ? 'ol' : 'ul', start = o ? +o[1] : 1;
        html += (o && start !== 1 ? `<ol start="${start}">` : `<${tag}>`) + '\n';
        for (const item of items) html += '<li>' + inline(item, link) + '</li>\n';
        html += `</${tag}>\n`;
      } else {
        const parts = [trimLine(line)]; i++;
        while (i < lines.length && !blank.test(lines[i]) && !fence.test(lines[i]) && !headingOf(lines[i]) && !hr.test(lines[i])) parts.push(trimLine(lines[i++]));
        const text = inline(parts.join('\n'), link);
        if (excerpt === null) excerpt = text;
        html += '<p>' + text + '</p>\n';
      }
    }
  }
  return { html, toc, excerpt: excerpt ?? '' };
}

function resolve(dir, rel) {
  const parts = dir === '' ? [] : dir.split('/');
  for (const s of rel.split('/')) {
    if (s === '' || s === '.') continue;
    if (s === '..') { if (!parts.length) return null; parts.pop(); }
    else parts.push(s);
  }
  return parts.join('/');
}
function linkRecord(s) { return s ? { title: s.data.title, url: s.url, date: s.data.date ?? '', date_long: s.data.date === undefined ? '' : longDate(s.data.date) } : null; }
function card(s) {
  return {
    title: s.data.title, url: s.url, date: s.data.date ?? '', date_long: s.data.date === undefined ? '' : longDate(s.data.date),
    summary: s.data.summary ?? '', excerpt: s.excerpt, reading_minutes: Math.max(1, Math.ceil((s.body.match(/\S+/g)?.length ?? 0) / 200)),
    tags: s.tagRefs.map(t => ({ name: t.name, slug: t.slug, url: t.url })),
  };
}

export function run(input) {
  const report = [], templates = memoizeTemplates(templatesFor(input.templates, report)), base = input.site.base_url.replace(/\/+$/, '');
  const sources = [], statics = [], bySource = new Map(), taken = new Map();
  const files = input.files.slice().sort((a, b) => cmp(a.path, b.path));
  for (const f of files) {
    if (!f.path.endsWith('.md')) { statics.push(f); continue; }
    const fm = frontMatter(f.content.replace(/\r\n?/g, '\n'));
    let reason = fm.error;
    const post = f.path.startsWith('posts/');
    let layout;
    if (reason === undefined) {
      if (f.path.startsWith('tags/')) reason = "tags/ is the generator's own";
      else if (f.path.startsWith('page/')) reason = "page/ is the generator's own";
      else if (post && !own(fm.data, 'date')) reason = 'a post needs a date';
      else {
        layout = fm.data.layout ?? (post ? 'post' : 'page');
        if (!templates.has(layout)) reason = `layout "${layout}" is no template that parses`;
      }
    }
    if (reason !== undefined) { report.push(`refused ${f.path}: ${reason}`); continue; }
    if (fm.data.draft === true) { report.push(`draft ${f.path}`); continue; }
    const dir = post ? 'posts' : dirOf(f.path);
    let used = taken.get(dir);
    if (!used) { used = new Set(dir === '' ? ['posts', 'tags', 'page'] : []); taken.set(dir, used); }
    const s = { path: f.path, data: fm.data, body: fm.body, post, layout };
    s.slug = unique(s.data.slug ?? slug(s.data.title), used);
    s.outDir = dir === '' ? s.slug : dir + '/' + s.slug;
    s.url = base + '/' + s.outDir + '/';
    sources.push(s); bySource.set(s.path, s);
  }
  const staticPaths = new Set(statics.map(f => f.path)), broken = new Set();
  for (const s of sources) {
    const dir = dirOf(s.path), linkCache = new Map();
    const link = target => {
      if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(target) || target[0] === '/' || target[0] === '#') return target;
      if (linkCache.has(target)) return linkCache.get(target);
      const hash = target.indexOf('#'), rel = hash < 0 ? target : target.slice(0, hash), frag = hash < 0 ? '' : target.slice(hash);
      const path = rel === '' ? null : resolve(dir, rel);
      let result = target;
      if (path !== null && bySource.has(path)) result = bySource.get(path).url + frag;
      else if (path !== null && staticPaths.has(path)) result = base + '/' + path + frag;
      else broken.add(`broken-link ${s.path} -> ${target}`);
      linkCache.set(target, result); return result;
    };
    Object.assign(s, markdown(s.body, link));
  }
  const posts = sources.filter(s => s.post).sort((a, b) => cmp(b.data.date, a.data.date) || cmp(a.slug, b.slug));
  const tagMap = new Map();
  for (let i = 0; i < posts.length; i++) {
    const s = posts[i]; s.newer = posts[i - 1] ?? null; s.older = posts[i + 1] ?? null;
    const seen = new Set(); s.tagRefs = [];
    for (const name of s.data.tags ?? []) {
      const key = slug(name);
      if (seen.has(key)) continue;
      seen.add(key);
      let t = tagMap.get(key);
      if (!t) { t = { name, slug: key, url: base + '/tags/' + key + '/', posts: [] }; tagMap.set(key, t); }
      t.posts.push(s); s.tagRefs.push(t);
    }
  }
  for (const s of sources) if (!s.post) {
    s.tagRefs = []; const seen = new Set();
    for (const name of s.data.tags ?? []) {
      const key = slug(name);
      if (seen.has(key)) continue;
      seen.add(key); s.tagRefs.push(tagMap.get(key) ?? { name, slug: key, url: '', posts: [] });
    }
  }
  const tags = [...tagMap.values()].sort((a, b) => b.posts.length - a.posts.length || cmp(a.slug, b.slug));
  for (const p of posts) p.card = card(p);
  const globals = {
    site: { title: input.site.title, base_url: base },
    tags: tags.map(t => ({ name: t.name, slug: t.slug, url: t.url, count: t.posts.length })),
    recent: posts.slice(0, input.site.recent).map(p => p.card),
  };
  const output = {};
  const render = (name, vars) => {
    const fn = templates.get(name);
    return fn === undefined ? null : fn({ vars: { ...globals, ...vars }, parent: null }, templates, 0);
  };
  for (const s of sources) {
    const page = { ...(s.card ?? card(s)), slug: s.slug, content: s.html, toc: s.toc, newer: linkRecord(s.newer), older: linkRecord(s.older), is_post: s.post };
    output[s.outDir + '/index.html'] = render(s.layout, { page });
  }
  const per = input.site.per_page, pages = Math.max(1, Math.ceil(posts.length / per));
  const indexUrl = k => k === 1 ? base + '/' : base + '/page/' + k + '/';
  for (let k = 1; k <= pages; k++) {
    const html = render('index', {
      posts: posts.slice((k - 1) * per, k * per).map(p => p.card),
      pager: { number: k, total: pages, url: indexUrl(k), newer_url: k === 1 ? '' : indexUrl(k - 1), older_url: k === pages ? '' : indexUrl(k + 1) },
    });
    if (html !== null) output[k === 1 ? 'index.html' : `page/${k}/index.html`] = html;
  }
  for (const t of tags) {
    const html = render('tag', { tag: { name: t.name, slug: t.slug, url: t.url, count: t.posts.length, posts: t.posts.map(p => p.card) } });
    if (html !== null) output[`tags/${t.slug}/index.html`] = html;
  }
  const tagsHtml = render('tags', {});
  if (tagsHtml !== null) output['tags/index.html'] = tagsHtml;
  for (const f of statics) {
    if (own(output, f.path)) report.push(`shadowed ${f.path}: a built page has its path`);
    else output[f.path] = f.content;
  }
  const lines = report.concat([...broken]).sort(cmp);
  lines.push(`built ${sources.length - posts.length} pages, ${posts.length} posts, ${tags.length} tags and ${statics.length} static files`);
  output['build-report.txt'] = lines.join('\n') + '\n';
  return output;
}
