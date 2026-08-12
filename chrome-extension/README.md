# Auto Publishing WordPress Filler

This Chrome extension fills a new Gutenberg WordPress post using the browser session you are already logged into. It does not store or transmit WordPress passwords.

## Install

1. Run `npm run build` in the parent project.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode**.
4. Choose **Load unpacked** and select this `chrome-extension` folder.
5. Run the publishing app locally at `http://localhost:5173`.

## Use

1. After loading the extension, click the extension’s **Reload** icon in `chrome://extensions`, then refresh the Auto Publishing page.
2. Use the local app at `http://localhost:5173` (the extension is intentionally limited to this local address).
3. In Auto Publishing, open **Settings** and paste the exact WordPress admin URL—for example `https://example.com/wp-admin` or `https://example.com/wp/wp-admin`.
4. Import the Google Doc. Confirm that the title, slug, content, and CTA buttons appear in Auto Publishing.
5. Click **Send to WP** in the top bar. Importing alone does not send anything to WordPress.
6. Click the Auto Publishing extension icon in Chrome. The popup shows the queued post title, slug, and target admin URL.
7. Click **Open & fill WordPress**. Chrome opens the site’s **Add New Post** page. If you are already logged in to that site in Chrome, no login is required.
8. Gutenberg receives the title, article HTML, URL slug, and meta description as the post excerpt. Review and click **Save draft**.

The extension also supports the Classic editor. If filling fails, reopen the extension popup to see the exact editor status. Confirm that Chrome—not a separate browser—is already signed in to the Dealer Inspire/WordPress admin page.

SEO meta-title fields are provided by plugins such as Yoast or Rank Math. Their field names are not universal, so plugin-specific filling should be added after choosing the site’s SEO plugin.
