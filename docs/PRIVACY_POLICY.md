# dorv Privacy Policy

Effective date: [2026-05-17]

dorv is a Chrome extension that syncs review comments between GitHub pull requests and linked Google Docs for markdown-heavy PR reviews.

## Information dorv accesses

dorv accesses only the information needed to provide comment sync:

- GitHub authentication information, including a GitHub personal access token provided by the user
- Google authentication through Chrome Identity
- GitHub pull request metadata, file metadata, markdown file content, review comments, and issue comments
- Google Docs and Drive file metadata for documents created or opened through dorv
- Google Docs comments and replies used for PR review sync
- Local sync state, including PR-to-document mappings, comment mappings, and sync status

## How dorv uses information

dorv uses this information to:

- Detect supported GitHub pull requests
- Create or open linked Google Docs for PR review
- Sync GitHub review comments into Google Docs
- Sync Google Docs comment replies back to GitHub
- Avoid duplicate comment syncing
- Show sync status in the extension side panel

dorv does not use this information for advertising, tracking, profiling, or unrelated analytics.

## Where information is stored

dorv v0.1.0 does not use a backend server.

GitHub personal access tokens, PR mappings, comment mappings, and sync status are stored locally in Chrome storage on the user's device.

Google authentication tokens are handled by Chrome Identity.

GitHub and Google data is sent only to GitHub and Google APIs as needed to provide comment sync.

## Data sharing

dorv does not sell user data.

dorv does not share user data with advertising networks, data brokers, or other third parties.

dorv transfers data only as necessary to provide its core functionality, including requests to GitHub APIs and Google APIs initiated by the extension.

## Google API Limited Use

dorv's use and transfer of information received from Google APIs adheres to the Chrome Web Store User Data Policy, including the Limited Use requirements.

dorv uses Google API data only to provide or improve the extension's single purpose: syncing PR review comments between GitHub and Google Docs.

dorv does not use Google API data for personalized advertising.

dorv does not allow humans to read Google API data except where required for security, legal compliance, or with explicit user consent for support.

## Security

dorv uses HTTPS when communicating with GitHub and Google APIs.

Users are responsible for creating GitHub personal access tokens with the minimum repository permissions needed for their workflow.

## User control

Users can remove stored dorv data by uninstalling the extension or clearing the extension's Chrome storage.

Users can revoke Google access through their Google Account permissions page.

Users can revoke GitHub access by deleting or rotating their GitHub personal access token.

## Contact

For questions about this privacy policy, contact:

[stahn1995@gmail.com]
