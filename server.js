import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import * as cheerio from 'cheerio';

const app = express();
app.use(cors());
app.use(express.json({ limit: '3mb' }));

const text = (value = '') => value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
const escapeHtml = (value = '') => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

function googleExportUrl(url) {
  const match = url.match(/docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) throw new Error('Please enter a valid Google Docs link.');
  return `https://docs.google.com/document/d/${match[1]}/export?format=html`;
}

function readLabel(lines, label) {
  const row = lines.find(line => line.toLowerCase().startsWith(label.toLowerCase()));
  return row ? row.slice(row.indexOf(':') + 1).trim() : '';
}

function htmlFromLines(lines) {
  let firstTitle = true;
  return lines.filter(Boolean).map(line => {
    if (/^<[^>]+>/.test(line)) return line;
    if (firstTitle) { firstTitle = false; return `<h1>${escapeHtml(line)}</h1>`; }
    if (/^(20\d{2}\s|.*(?:Dimensions|Colors|At %%di_name%%)$)/i.test(line)) return `<h2>${escapeHtml(line)}</h2>`;
    if (/^(Range Rover Sport|Solid$|Metallic$|Premium Metallic$|Roof Colors$|SV Ultra Metallic)/i.test(line)) return `<h3>${escapeHtml(line)}</h3>`;
    if (/^[A-Z][^.!?]{1,95}$/.test(line)) return `<li>${escapeHtml(line)}</li>`;
    return `<p>${escapeHtml(line)}</p>`;
  }).join('\n').replace(/(<li>[\s\S]*?<\/li>\n?)+/g, chunk => `<ul>\n${chunk}</ul>`);
}

function parseDealerTemplate(sourceHtml) {
  const $ = cheerio.load(sourceHtml);
  $('script, style, meta, link').remove();
  const paragraphLines = $('body').find('p, h1, h2, h3, h4, li').map((_, element) => text($(element).text())).get().filter(Boolean);
  const lines = (paragraphLines.length ? paragraphLines : $('body').text().split(/\r?\n/)).map(text).filter(Boolean);
  const buttonIndex = lines.findIndex(line => line.toLowerCase().startsWith('buttons:'));
  const contentLines = buttonIndex >= 0 ? lines.slice(buttonIndex + 1) : lines.filter(line => !/^(keywords|meta title|meta description|page slug|image shortcode|buttons):/i.test(line));
  const title = contentLines[0] || 'Untitled post';
  return {
    title,
    slug: readLabel(lines, 'Page Slug').replace(/^\/+|\/+$/g, ''),
    metaTitle: readLabel(lines, 'Meta Title').replace(/^\(under[^)]*\):\s*/i, ''),
    metaDescription: readLabel(lines, 'Meta Description'),
    keyword: readLabel(lines, 'Keywords'),
    imageShortcode: readLabel(lines, 'Image Shortcode'),
    buttons: readLabel(lines, 'Buttons'),
    content: htmlFromLines(contentLines),
  };
}

app.post('/api/import', async (req, res) => {
  try {
    const exportUrl = googleExportUrl(req.body.url || '');
    const response = await fetch(exportUrl);
    if (!response.ok) throw new Error('Google could not provide this document. Set sharing to “Anyone with the link” or connect a Google account.');
    const data = parseDealerTemplate(await response.text());
    res.json(data);
  } catch (error) {
    res.status(400).json({ error: error.message || 'Could not import this Google Doc.' });
  }
});

const wpConfig = () => {
  const { WP_URL, WP_USERNAME, WP_APP_PASSWORD } = process.env;
  if (!WP_URL || !WP_USERNAME || !WP_APP_PASSWORD) throw new Error('Add your WordPress URL, username, and Application Password to .env first.');
  return { url: WP_URL.replace(/\/$/, ''), auth: `Basic ${Buffer.from(`${WP_USERNAME}:${WP_APP_PASSWORD.replace(/\s/g, '')}`).toString('base64')}` };
};

async function termId(type, term, config) {
  if (!term) return null;
  const base = `${config.url}/wp-json/wp/v2/${type}`;
  const found = await fetch(`${base}?search=${encodeURIComponent(term)}&per_page=100`, { headers: { Authorization: config.auth } }).then(r => r.json());
  const exact = Array.isArray(found) && found.find(item => item.name.toLowerCase() === term.toLowerCase());
  if (exact) return exact.id;
  const created = await fetch(base, { method: 'POST', headers: { Authorization: config.auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: term }) });
  if (!created.ok) return null;
  return (await created.json()).id;
}

app.post('/api/wordpress/draft', async (req, res) => {
  try {
    const config = wpConfig();
    const post = req.body;
    const category = await termId('categories', post.category, config);
    const tags = await Promise.all((post.tags || '').split(',').map(value => termId('tags', value.trim(), config)));
    const content = [post.imageShortcode, post.content, post.buttons].filter(Boolean).join('\n\n');
    const body = { title: post.title, slug: post.slug, content, status: post.status === 'Published' ? 'publish' : 'draft', categories: category ? [category] : [], tags: tags.filter(Boolean) };
    const seoTitle = process.env.WP_SEO_TITLE_META_KEY;
    const seoDescription = process.env.WP_SEO_DESCRIPTION_META_KEY;
    if (seoTitle || seoDescription) body.meta = { ...(seoTitle ? { [seoTitle]: post.metaTitle } : {}), ...(seoDescription ? { [seoDescription]: post.metaDescription } : {}) };
    const response = await fetch(`${config.url}/wp-json/wp/v2/posts`, { method: 'POST', headers: { Authorization: config.auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'WordPress rejected the draft.');
    res.json({ id: result.id, link: result.link, editLink: `${config.url}/wp-admin/post.php?post=${result.id}&action=edit` });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Could not create the WordPress draft.' });
  }
});

app.listen(8787, () => console.log('Publishing bridge running at http://127.0.0.1:8787'));
