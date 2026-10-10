# AI usage

Open **Model usage** to see recent services and models, request counts, successes, and reported token use.

<GuideVisual kind="stats" en />

<details class="guide-details">
<summary>What is a token?</summary>

## What is a token?

A token is a unit of text processed by a model. Input is what you send; output is what the model produces. Tokens do not equal characters or words, and counting differs between models.

</details>

## Look at a period of time

Choose a date range to view trends. When the service reports details, input, output, and cache use can be shown separately. Missing values are not exact billing data.

Model lists show your commonly used services. Request records can help explain failures and retries. Your provider’s bill is the source of truth for charges.

<details class="guide-details">
<summary>What is counted?</summary>

## What is counted?

AI requests covered by usage tracking appear here, including some connection checks, retries, and multi-paragraph jobs. Requests without reported use, features outside tracking, and activity on other devices may be absent.

</details>

<details class="guide-details">
<summary>Manage records</summary>

## Manage records

Records stay in this browser and can be exported or cleared using the page’s controls. This is request and usage history, not a full translation archive. Clearing it does not reverse provider charges.

To reduce use, translate only the sentences you need or turn off extra AI context when unnecessary. See [Translation services](/en/config/translation-engines).

Output speed (token/s) divides the total output tokens of eligible successful requests by their summed duration in seconds, including waiting and transfer time. It is not pure generation speed. Missing output or valid duration displays `—`; zero output displays `0`. The overview shows the aggregate speed and eligible request count, and request details show individual speed. Average duration still includes all calls.

Request records are expanded by default and each row shows output speed (token/s). Each service/model breakdown row also shows its aggregate output speed. Records remain visible. Filter by scenario, status, and cache, or enter a page number to jump directly. Click a selected service/model row again to clear that selection. Statistics help opens in an overlay; hover over the local badge for retention details. Average composition per request is always visible.

</details>

## Related guides

- [All guides](/en/docs/)
- [Troubleshooting](/en/guide/faq)
