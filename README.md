# NEXAUREN-SOUND

Independent digital store for Nexauren music products.

## Product admin

The private product panel is available at:

`/admin/`

The panel creates, edits, publishes and deletes products directly in Cloudflare D1 through the Worker API. No product SQL is required for normal catalog management.

### First setup

The Worker requires an `ADMIN_KEY` secret. Set it in the Cloudflare Worker environment/secrets before using `/admin/`.

Never put the admin key inside `worker.js`, HTML, CSS or JavaScript files.

### Current product fields

- Product name and slug
- Category
- Draft / published / archived status
- Short description and full description
- Price and currency
- Free-product flag
- Cover URL
- B2 file key, file name and file size

The `products` table is already prepared for private B2 delivery. Uploading the ZIP directly from the admin panel will be connected when the B2 storage binding is added.

## Architecture

- Cloudflare Worker for API and server-side logic
- Cloudflare D1 for store data
- Cloudflare Static Assets for the storefront and admin interface
- Backblaze B2 planned for private product files
- PayPal planned for payments
