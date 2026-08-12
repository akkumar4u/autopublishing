const DRAFT_KEY = 'pendingWordPressDraft';
const STATUS_KEY = 'lastFillStatus';
const TARGET_TAB_KEY = 'pendingWordPressDraftTabId';

function postNewUrl(adminUrl) {
  const url = new URL(adminUrl);
  if (!/\/wp-admin(?:\/|$)/i.test(url.pathname)) {
    const basePath = url.pathname.replace(/\/+$/, '');
    url.pathname = `${basePath}/wp/wp-admin`.replace(/\/+/g, '/');
  }
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/post-new.php`;
  url.search = '';
  url.hash = '';
  return url.toString();
}

function isNewBlogPostUrl(tabUrl, adminUrl) {
  const url = new URL(tabUrl);
  const admin = new URL(adminUrl);

  // Never run on post.php (an existing post/page) or on page creation. This
  // workflow is deliberately limited to WordPress's "Add New Post" screen.
  return url.origin === admin.origin &&
    /\/wp-admin\/post-new\.php$/i.test(url.pathname) &&
    (url.searchParams.get('post_type') || 'post') === 'post';
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'GET_PENDING_DRAFT') {
    chrome.storage.session.get(DRAFT_KEY)
      .then(async stored => {
        const status = await chrome.storage.session.get(STATUS_KEY);
        sendResponse({ ok: true, draft: stored[DRAFT_KEY] || null, status: status[STATUS_KEY] || null });
      })
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === 'QUEUE_WORDPRESS_DRAFT') {
    const draft = message.draft;
    if (!draft?.adminUrl || !draft?.title) {
      sendResponse({ ok: false, error: 'A WordPress admin URL and post title are required.' });
      return;
    }

    chrome.storage.session.set({ [DRAFT_KEY]: draft, [STATUS_KEY]: null })
      .then(() => sendResponse({ ok: true }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === 'OPEN_PENDING_DRAFT') {
    chrome.storage.session.get(DRAFT_KEY).then(async stored => {
      const draft = stored[DRAFT_KEY];
      if (!draft) throw new Error('No post is queued. Return to Auto Publishing and click Send to WP.');
      const tab = await chrome.tabs.create({ url: postNewUrl(draft.adminUrl) });
      await chrome.storage.session.set({ [TARGET_TAB_KEY]: tab.id });
      sendResponse({ ok: true, tabId: tab.id });
    }).catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab.url) return;

  const stored = await chrome.storage.session.get([DRAFT_KEY, TARGET_TAB_KEY]);
  const draft = stored[DRAFT_KEY];
  if (!draft || stored[TARGET_TAB_KEY] !== tabId || !isNewBlogPostUrl(tab.url, draft.adminUrl)) return;

  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: fillGutenbergDraft,
      args: [draft]
    });
    // A queued draft is single-use. Once its values have been placed in the
    // new post editor, remove the payload so it can never fill a second time.
    await chrome.storage.session.remove([DRAFT_KEY, TARGET_TAB_KEY]);
    await chrome.storage.session.set({
      [STATUS_KEY]: { ok: true, message: `Draft fields filled in the ${result[0]?.result?.editor || 'WordPress'} editor. The queued data was cleared.` }
    });
  } catch (error) {
    console.error('Could not fill the WordPress editor:', error);
    await chrome.storage.session.set({
      [STATUS_KEY]: { ok: false, message: `Could not fill the editor: ${error.message}` }
    });
  }
});

async function fillGutenbergDraft(draft) {
  const setYoastField = (selector, value) => {
    const field = document.querySelector(selector);
    if (!field || value === undefined || value === null) return false;
    const prototype = field instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    setter?.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  };

  const writeYoastFields = () => {
    const yoastTitle = draft.metaTitle || draft.title || '';
    const yoastDescription = draft.metaDescription || '';
    const titleWritten = [
      '#yoast_wpseo_title',
      'input[name="yoast_wpseo_title"]',
      'input[name="_yoast_wpseo_title"]'
    ].some(selector => setYoastField(selector, yoastTitle));
    const descriptionWritten = [
      '#yoast_wpseo_metadesc',
      'textarea[name="yoast_wpseo_metadesc"]',
      'textarea[name="_yoast_wpseo_metadesc"]'
    ].some(selector => setYoastField(selector, yoastDescription));
    return titleWritten || descriptionWritten;
  };

  const waitForEditor = async () => {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (window.wp?.data?.dispatch?.('core/editor') || document.querySelector('#title, #content')) return true;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    return false;
  };

  if (!await waitForEditor()) {
    throw new Error('No supported WordPress editor finished loading. Make sure you are signed in, then try again.');
  }

  if (!window.wp?.data?.dispatch?.('core/editor')) {
    if (document.body.classList.contains('post-type-page')) {
      throw new Error('Safety check stopped this action: pages cannot be filled by this extension.');
    }
    setYoastField('#title', draft.title || '');
    setYoastField('#post_name', draft.slug || '');
    setYoastField('#excerpt', draft.metaDescription || '');
    // Yoast uses its own post-meta fields; an excerpt does not populate them.
    // Support both the Classic metabox markup and newer field naming.
    writeYoastFields();
    if (window.tinymce?.get('content')) {
      window.tinymce.get('content').setContent(draft.content || '');
      window.tinymce.get('content').fire('change');
    } else {
      setYoastField('#content', draft.content || '');
    }
    return { filled: true, editor: 'Classic' };
  }

  const waitForYoastEditor = async () => {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (window.wp?.data?.dispatch?.('yoast-seo/editor')) return true;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    return false;
  };

  // This uses WordPress’s own editor store, so Gutenberg treats the values as
  // real edits and enables its normal “Save draft” button.
  const postType = window.wp.data.select('core/editor')?.getCurrentPostType?.();
  if (postType && postType !== 'post') {
    throw new Error('Safety check stopped this action: only blog posts can be filled.');
  }
  const editorStore = window.wp.data.select('core/editor');
  const existingMeta = editorStore?.getEditedPostAttribute?.('meta') || {};
  const yoastMeta = {
    ...(draft.metaTitle || draft.title
      ? { _yoast_wpseo_title: draft.metaTitle || draft.title }
      : {}),
    ...(draft.metaDescription
      ? { _yoast_wpseo_metadesc: draft.metaDescription }
      : {})
  };
  window.wp.data.dispatch('core/editor').editPost({
    title: draft.title || '',
    content: draft.content || '',
    slug: draft.slug || '',
    excerpt: draft.metaDescription || '',
    meta: { ...existingMeta, ...yoastMeta }
  });

  // Recent Yoast versions keep the snippet editor in their own data store.
  // Updating only WordPress's `core/editor` meta can be overwritten by Yoast
  // when the draft is saved, so update Yoast's active editor state as well.
  const yoastReady = await waitForYoastEditor();
  if (yoastReady) {
    window.wp.data.dispatch('yoast-seo/editor').updateData({
      title: draft.metaTitle || draft.title || '',
      description: draft.metaDescription || ''
    });
  }
  // Yoast also persists these hidden fields independently. Set them after its
  // store update (and once more after the UI settles) so either Yoast UI works.
  const yoastFieldsWritten = writeYoastFields();
  await new Promise(resolve => setTimeout(resolve, 500));
  writeYoastFields();

  return { filled: true, editor: 'Gutenberg', yoast: yoastReady || yoastFieldsWritten };
}
