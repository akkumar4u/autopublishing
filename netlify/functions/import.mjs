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
  const pattern = new RegExp(`^${label}\\s*:`, 'i');
  const index = lines.findIndex(line => pattern.test(line));
  if (index < 0) return '';
  return lines[index].replace(pattern, '').trim() || lines[index + 1] || '';
}

function parseGoogleDoc(sourceHtml) {
  const $ = cheerio.load(sourceHtml);
  const nodes = $('body').find('h1,h2,h3,h4,h5,h6,p,ul,ol,blockquote,table').toArray();
  const lines = nodes.map(node => normalizeText($(node).text())).filter(Boolean);
  const titleNode = nodes.find(node => node.tagName?.toLowerCase() === 'h1');
  const title = normalizeText(titleNode ? $(titleNode).text() : '') || valueAfterLabel(lines, 'Post Title') || 'Untitled post';
  const labels = /^(post title|meta title|meta description|page slug|keywords|tags|category|author|alt text|featured image alt text|image shortcode|buttons|cta buttons)\s*:/i;
  const content = nodes
    .filter(node => node !== titleNode && !labels.test(normalizeText($(node).text())))
    .map(node => {
      const tag = node.tagName.toLowerCase();
      const html = $(node).html() || escapeHtml($(node).text());
      return ['h2', 'h3', 'h4', 'h5', 'h6', 'p', 'ul', 'ol', 'blockquote', 'table'].includes(tag) ? `<${tag}>${html}</${tag}>` : '';
    })
    .filter(Boolean)
    .join('\n');
  return {
    title,
    slug: valueAfterLabel(lines, 'Page Slug').replace(/^\/+|\/+$/g, ''),
    metaTitle: valueAfterLabel(lines, 'Meta Title'),
    metaDescription: valueAfterLabel(lines, 'Meta Description'),
    keyword: valueAfterLabel(lines, 'Keywords'), tags: valueAfterLabel(lines, 'Tags'),
    category: valueAfterLabel(lines, 'Category'), author: valueAfterLabel(lines, 'Author'),
    altText: valueAfterLabel(lines, 'Alt Text') || valueAfterLabel(lines, 'Featured Image Alt Text'),
    imageShortcode: valueAfterLabel(lines, 'Image Shortcode'),
    buttons: valueAfterLabel(lines, 'CTA Buttons') || valueAfterLabel(lines, 'Buttons'), content
  };
}
