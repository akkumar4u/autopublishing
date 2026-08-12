// Netlify statically bundles the same complete parser used locally. This
// preserves the original heading, list, CTA and formatting behavior.
import { googleExportUrl, parseDealerTemplate } from '../../server.js';

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8' }
});

export default async request => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const { url = '' } = await request.json();
    const response = await fetch(googleExportUrl(url), {
      signal: AbortSignal.timeout(20_000)
    });
    if (!response.ok) {
      throw new Error(
        `Google Docs returned HTTP ${response.status}. Confirm the document is shared as "Anyone with the link" → Viewer, then try again.`
      );
    }
    return json(parseDealerTemplate(await response.text()));
  } catch (error) {
    console.error('Import error:', error.message);
    const message = error.name === 'TimeoutError'
      ? 'Google Docs did not respond in time. Confirm the document is shared as "Anyone with the link" → Viewer, then try again.'
      : error.message || 'Could not import Google Doc';
    return json({ error: message }, 400);
  }
};

export const config = { path: '/api/import' };
