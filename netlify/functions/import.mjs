import * as cheerio from 'cheerio';

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8' }
});

export default async request => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const { url = '' } = await request.json();
    const match = url.match(/docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/);
    if (!match) throw new Error('Please enter a valid Google Docs link.');
    const response = await fetch(
      `https://docs.google.com/document/d/${match[1]}/export?format=html`,
      { signal: AbortSignal.timeout(20_000) }
    );
    if (!response.ok) {
      throw new Error(
        `Google Docs returned HTTP ${response.status}. Confirm the document is shared as "Anyone with the link" → Viewer, then try again.`
      );
    }
    return json(parseGoogleDoc(await response.text()));
  } catch (error) {
    console.error('Import error:', error.message);
    const message = error.name === 'TimeoutError'
      ? 'Google Docs did not respond in time. Confirm the document is shared as "Anyone with the link" → Viewer, then try again.'
      : error.message || 'Could not import Google Doc';
    return json({ error: message }, 400);
  }
};

export const config = { path: '/api/import' };

const normalizeText = (value = '') => value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
const escapeHtml = (value = '') => value.replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));

function valueAfterLabel(lines, label) {
  const pattern = new RegExp(`^${label}\\s*(?:\\([^)]*\\))?\\s*:`, 'i');
  const index = lines.findIndex(line => pattern.test(line));
  if (index < 0) return '';
  return lines[index].replace(pattern, '').trim() || lines[index + 1] || '';
}

function parseGoogleDoc(sourceHtml) {
  const $ = cheerio.load(sourceHtml);
  $('script,style,meta,link').remove();
  const nodes = $('body').find('p,h1,h2,h3,h4,h5,h6,ul,ol,blockquote,table')
    .filter((_, node) => !$(node).parents('p,h1,h2,h3,h4,h5,h6,ul,ol,blockquote,table').length)
    .toArray();
  const lines = nodes.map(node => normalizeText($(node).text())).filter(Boolean);
  const suppliedTitle = valueAfterLabel(lines, 'Post Title');
  const slug = valueAfterLabel(lines, 'Page Slug').replace(/^\/+|\/+$/g, '');
  const metaTitle = valueAfterLabel(lines, 'Meta Title');
  const metaDescription = valueAfterLabel(lines, 'Meta Description');
  const keyword = valueAfterLabel(lines, 'Keywords');
  const tags = valueAfterLabel(lines, 'Tags');
  const category = valueAfterLabel(lines, 'Category');
  const author = valueAfterLabel(lines, 'Author');
  const altText = valueAfterLabel(lines, 'Alt Text') || valueAfterLabel(lines, 'Featured Image Alt Text');
  const imageShortcode = valueAfterLabel(lines, 'Image Shortcode');
  const buttonSource = valueAfterLabel(lines, 'CTA Buttons') || valueAfterLabel(lines, 'Buttons');
  const buttons = extractButtons(buttonSource) || nodes.map(node => extractButtons(normalizeText($(node).text()))).filter(Boolean).join('');
  const labels = /^(post title|meta title|meta description|page slug|keywords|tags|category|author|alt text|featured image alt text|image shortcode|buttons|cta buttons)\s*(?:\([^)]*\))?\s*:/i;
  const metadataValues = new Set([suppliedTitle, slug, metaTitle, metaDescription, keyword, tags, category, author, altText, imageShortcode, buttonSource].filter(Boolean));
  const articleNodes = nodes.filter(node => {
    const value = normalizeText($(node).text());
    return value && !labels.test(value) && !metadataValues.has(value) && !extractButtons(value);
  });
  const h1 = articleNodes.find(node => node.tagName?.toLowerCase() === 'h1');
  const titleNode = h1 || articleNodes[0];
  const title = normalizeText(titleNode ? $(titleNode).text() : '') || suppliedTitle || 'Untitled post';
  const content = articleNodes.filter(node => node !== titleNode && node.tagName?.toLowerCase() !== 'h1')
    .map(node => renderArticleNode($, node)).filter(Boolean).join('\n');
  return {
    title, slug, metaTitle, metaDescription, keyword, tags, category, author,
    altText, imageShortcode, buttons, content
  };
}

function extractButtons(markup = '') {
  if (!/<a\b[^>]*\bclass\s*=\s*["'][^"']*\b(?:button|primary-button)\b/i.test(markup)) return '';
  const $ = cheerio.load(markup, null, false);
  const links = $('a.button, a.primary-button').toArray().map(link => {
    const node = $(link);
    const href = node.attr('href') || '';
    const label = normalizeText(node.text());
    if (!href || !label) return '';
    const classes = (node.attr('class') || '').split(/\s+/).filter(value => value === 'button' || value === 'primary-button').join(' ');
    return `<a class="${classes || 'button'}" href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;
  }).filter(Boolean);
  return links.length ? `<div class="center">${links.join('')}</div>` : '';
}

function renderArticleNode($, node) {
  const tag = node.tagName.toLowerCase();
  const plain = normalizeText($(node).text());
  const html = ($(node).html() || '').replace(/\sstyle="[^"]*"/gi, '');
  if (tag === 'ul' || tag === 'ol' || tag === 'table' || tag === 'blockquote') return `<${tag}>${html}</${tag}>`;
  if (/^h[2-6]$/.test(tag)) return `<${tag}>${html}</${tag}>`;
  if (/^disclaimer\s*:/i.test(plain)) return `<h2><strong>Disclaimer:</strong></h2>`;
  if (/^20\d{2}\s/.test(plain) || (plain.length <= 80 && !/[.!?]$/.test(plain) && /^[A-Z]/.test(plain) && plain.split(' ').length <= 10)) return `<h2>${html}</h2>`;
  return plain ? `<p>${html}</p>` : '';
}

export { parseGoogleDoc };
