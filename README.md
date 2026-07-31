# AlphaHunter v5 Evidence Engine

This release adds a cloud evidence system instead of another cosmetic dashboard feature.

## What it does

- A Netlify Scheduled Function scans every five minutes, even when the browser is closed.
- New candidates meeting a broad evidence threshold are stored in Netlify Blobs.
- Stored signals are revisited and measured at approximately 30 minutes, 1 hour, 4 hours, and 24 hours.
- The dashboard reports stored signals, measured outcomes, 30-minute win rate, average return, and best measured return.
- A manual **Run scan now** button lets you initialize and test the system immediately.

## Deployment requirement

This release uses the `@netlify/blobs` package. Use a Netlify build deployment rather than a plain static drag-and-drop upload:

### Easiest route using GitHub
1. Unzip this folder.
2. Upload its contents to a new GitHub repository.
3. In Netlify choose **Add new project → Import an existing project**.
4. Select the repository.
5. Leave build command blank and publish directory as `.`.
6. Copy your existing `HELIUS_API_KEY` environment variable to the new project if needed.
7. Deploy.

### Existing project using Netlify CLI
From inside this folder:
```bash
npm install
npx netlify login
npx netlify link
npx netlify deploy --build --prod
```

The included scheduled function uses `*/5 * * * *`, interpreted in UTC.

## Honest limitations

- The discovery universe is DEX Screener's recently boosted Solana feed, not every Solana launch.
- Stored market returns do not include fees, slippage, failed transactions, or inability to exit.
- Netlify Blobs is a lightweight store, suitable for this evidence prototype but not advanced analytics at large scale.
- Do not treat a positive early win rate as proof of an edge.
