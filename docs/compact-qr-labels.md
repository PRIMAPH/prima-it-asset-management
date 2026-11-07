# Asset Label Print (QR Only)

Open **Workspace → Asset Label Print**, or select assets on **Assets** and click **QR-Only Labels**. The shortcut opens a separate tab and passes internal database IDs; asset details are fetched again from the existing authenticated API. Nothing is written to the database.

On the dedicated page, search assets, select individual rows or all visible results, and click **Preview**. Selection remains across searches. **Print** revalidates all selected assets before opening browser printing. Missing assets are removed with an error and the remaining selection is retained; no partial print is silently started.

Each label uses two horizontal sections: the QR on the left, with the company name on the right in exactly two lines: **Prima Fintech (Philippines)** and **Lending Corp.**, followed by the bold six-digit suffix on the right The black-and-white QR encodes the **full** Asset ID. For example, the QR contains `PRIMA-2026-000157` while the visible number is `000157`. QRCode.js 1.0.0 is the same encoder version used by standard labels; a local MIT-licensed copy makes this page independent of its CDN.

Layout: A4 portrait, 6 mm page margins, 48 × 25 mm labels, 2 mm gaps, 4 columns × 10 rows = **40 labels per sheet**. The QR image occupies 17 × 17 mm including a four-module white quiet zone. Preview and print use the same grid. Additional sheets are generated automatically.

Four labels occupy 203.2 mm before gaps, so this layout requires a printer that supports 3 mm margins. Wider printer margins cannot preserve both the exact label dimensions and four columns; do not shrink to fit. Internal padding and section gap are 0.3 mm, company text is 6 pt, and the bold ID is 11 pt.

Choose A4 portrait and **100% / Actual size**, and disable browser headers/footers. Printer dialogs cannot be configured completely by webpage CSS. Use plain paper to verify physical alignment before printing on sticker stock; hardware/printer and adhesive-sheet calibration were not tested.

## Files and routes

- `/asset-label-print`: authenticated page route in `server.js`.
- `public/asset-label-print.html`, `public/css/asset-label-print.css`, `public/js/asset-label-print.js`: dedicated page, print layout, asset picker and QR rendering.
- `public/js/navbar.js`: Workspace navigation item.
- `public/assets.html`, `public/js/assets.js`: selection shortcut; standard label workflow retained.
- `public/vendor/qrcodejs/`: local encoder and MIT license.
- `tests/asset-label-print.test.cjs`, `tests/asset-selection.test.cjs`: compact printing and existing selection/label regression tests.

## Verification

```powershell
node --test tests/asset-label-print.test.cjs tests/asset-selection.test.cjs
$env:RUN_LABEL_MYSQL_TEST = '1'
node --test tests/asset-label-print.test.cjs
Remove-Item Env:RUN_LABEL_MYSQL_TEST
```

The optional database test restricts connections to localhost and uses a read-only transaction. It verifies that a real asset's rendered QR decodes through the existing scanner library and resolves through the existing scan route to the correct primary key. No application records change.

Verified: duplicate selected IDs produce one label; full-ID QR decoding from a rasterized label; six-digit text; millimetre dimensions and fitting text; one-page PDF for one label; two-page PDF with 44 + 1 labels for 45 assets; print-only output; missing-asset failure; selected-ID transfer; and existing standard label output. Generated test artifacts are `tmp/compact-qr-label.png` and `tmp/compact-qr-labels.pdf`.

No production deployment is included.
