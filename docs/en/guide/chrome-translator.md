# Use Chrome’s local translation

Chrome’s built-in translation uses an on-device model. Check that your browser supports the language pair and prepare its model before translating.

<GuideVisual kind="chrome-local" en />

## Prepare a language pair

1. Open **Settings → General → Basic settings** and set **Default webpage translation provider** to **Chrome built-in AI translation**. Confirm your source and target languages.
2. Click **Configure provider**, then click **Check connection** in the connection settings.
3. Keep settings open while the model downloads; the status shows a progress bar and percentage.
4. Return to the webpage and retry translation.

Preparation applies to the current language pair. Another pair may need its own preparation. If automatic source detection fails, specify the source language and retry.

<details class="guide-details">
<summary>Why is it unavailable?</summary>

## Why is it unavailable?

Availability depends on Chrome version, device, browser policy, language, and download status. Not every computer supports every language. Check your connection and browser updates; use another service if preparation is unavailable.

Initial downloads require a network connection. A language that has not been prepared is not yet ready for offline use.

For deeper diagnosis, see [Chrome’s local model help](https://developer.chrome.com/docs/ai/debug-built-in-model).

</details>

## Related guides

- [All guides](/en/docs/)
- [Troubleshooting](/en/guide/faq)
