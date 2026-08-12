const empty = document.querySelector('#empty');
const draftCard = document.querySelector('#draft');
const status = document.querySelector('#status');
const fillButton = document.querySelector('#fill');
const fields = document.querySelector('#fields');
const documentUrl = document.querySelector('#document-url');
const adminUrl = document.querySelector('#admin-url');
const importButton = document.querySelector('#import');
const importStatus = document.querySelector('#import-status');
const importedFields = [
  ['Meta title', 'metaTitle'],
  ['Meta description', 'metaDescription'],
  ['Keywords', 'keyword'],
  ['Category', 'category'],
  ['Tags', 'tags'],
  ['Author', 'author'],
  ['Alt text', 'altText'],
  ['Image shortcode', 'imageShortcode'],
  ['CTA buttons', 'buttons']
];

function showDraft(draft, fillStatus) {
  if (!draft) return;
  empty.hidden = true;
  draftCard.hidden = false;
  document.querySelector('#title').textContent = draft.title || 'Untitled post';
  document.querySelector('#slug').textContent = draft.slug || 'WordPress will generate a slug';
  document.querySelector('#target').textContent = draft.adminUrl || 'No target set';
  fields.replaceChildren(...importedFields.map(([label, key]) => {
    const row = document.createElement('div');
    const term = document.createElement('dt');
    const value = document.createElement('dd');
    term.textContent = label;
    value.textContent = draft[key] || 'Not included in this document';
    row.append(term, value);
    return row;
  }));
  document.querySelector('#content').textContent = draft.content || 'Not included in this document';
  if (fillStatus?.message) {
    status.textContent = fillStatus.message;
    status.className = fillStatus.ok ? 'success' : 'error';
  }
}

chrome.runtime.sendMessage({ type: 'GET_PENDING_DRAFT' }, response => {
  if (response?.ok) showDraft(response.draft, response.status);
});

chrome.storage.local.get('wordPressAdminUrl').then(stored => {
  adminUrl.value = stored.wordPressAdminUrl || '';
});

importButton.addEventListener('click', () => {
  importButton.disabled = true;
  importStatus.textContent = 'Importing Google Doc…';
  importStatus.className = '';
  chrome.runtime.sendMessage({
    type: 'IMPORT_GOOGLE_DOC',
    documentUrl: documentUrl.value.trim(),
    adminUrl: adminUrl.value.trim()
  }, response => {
    importButton.disabled = false;
    if (!response?.ok) {
      importStatus.textContent = response?.error || 'Could not import the document.';
      importStatus.className = 'error';
      return;
    }
    importStatus.textContent = 'Draft queued. Click Open & fill WordPress below.';
    importStatus.className = 'success';
    showDraft(response.draft);
  });
});

fillButton.addEventListener('click', () => {
  fillButton.disabled = true;
  status.textContent = 'Opening WordPress…';
  chrome.runtime.sendMessage({ type: 'OPEN_PENDING_DRAFT' }, response => {
    if (response?.ok) {
      status.textContent = 'WordPress opened. The editor will be filled after it loads.';
      return;
    }
    status.textContent = response?.error || 'Could not open WordPress.';
    fillButton.disabled = false;
  });
});
