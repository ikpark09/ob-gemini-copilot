# Gemini Copilot Plugin for Obsidian

[![GitHub Release](https://img.shields.io/github/v/release/ikpark09/obsidian-gemini-copilot?style=for-the-badge)](https://github.com/ikpark09/obsidian-gemini-copilot/releases)

This Obsidian plugin integrates with Google's Gemini API to provide AI-powered writing assistance directly within your Obsidian vault.  Boost your note-taking workflow with features like generating note titles, summarizing text, and expanding on your ideas, all powered by Gemini.

## Features

*   **Generate Note Titles:**  Let Gemini suggest relevant and informative titles for your notes based on their content. Titles are generated in the `YYYY-MM-DD : Title` format and are sanitized to be filename-friendly.
*   **Summarize Text:**  Quickly condense selected text within your notes into concise summaries.
*   **Expand Text:**  Need to elaborate on a point? Select text and use Gemini to expand on your writing, adding detail and information.
*   **Confirmation Modal:** Review and confirm Gemini's suggestions before applying them to your notes. This gives you control over the AI's output.
*   **Interaction Log:**  Keep track of your interactions with the Gemini API. The plugin logs each request, including the model used, input prompt, output response, and any errors. This log is viewable in the plugin settings.
*   **Filename-Friendly Titles:**  Generated note titles are automatically sanitized to remove special characters that are not allowed in filenames, ensuring smooth file renaming within Obsidian.
*   **Date-Prefixed Titles:**  Note titles are generated and saved in the `YYYY-MM-DD : Title` format, automatically prepending the creation date of the note.

## Prerequisites

1.  **Gemini API Key:** You need a valid API key from Google AI Studio. You can obtain one for free (within usage limits) at [https://makersuite.google.com/app/apikey](https://makersuite.google.com/app/apikey).
2.  **Obsidian v0.9.12 or higher:** This plugin is designed to work with Obsidian versions 0.9.12 and above.

## Installation

### From within Obsidian

1.  Open Obsidian Settings (`Ctrl+,` or `Cmd+,`).
2.  Go to **Community plugins**.
3.  Click **Browse** to search community plugins.
4.  Search for "Gemini Copilot".
5.  Click **Install**.
6.  After installation, go to the **Installed plugins** tab and enable the "Gemini Copilot" plugin.

### Manual Installation

1.  Download the latest release from [Releases](https://github.com/ikpark09/obsidian-gemini-copilot/releases) page.
2.  Extract the downloaded ZIP file to your Obsidian vault's plugins folder: `<your_vault>/.obsidian/plugins/obsidian-gemini-copilot`.
    *   **Note:** Make sure to create the `obsidian-gemini-copilot` folder if it doesn't exist.
3.  In Obsidian, go to **Settings** -> **Community plugins** and enable the "Gemini Copilot" plugin.

## Usage

### Generate Note Title

1.  Open the note for which you want to generate a title.
2.  Open the Command Palette (`Ctrl+P` or `Cmd+P`).
3.  Type "Gemini: Generate Note Title" or "Generate Note Title with Gemini" and select the command.
4.  A modal will appear showing the title suggested by Gemini in `YYYY-MM-DD : Title` format.
5.  Click **Confirm** to apply the title and rename the note, or click **Cancel** to discard the suggestion.

### Summarize Text

1.  Select the text you want to summarize within your note.
2.  Open the Command Palette (`Ctrl+P` or `Cmd+P`).
3.  Type "Gemini: Summarize Selected Text" or "Summarize Selected Text with Gemini" and select the command.
4.  A modal will appear showing the summary generated by Gemini.
5.  Click **Confirm** to replace the selected text with the summary, or click **Cancel** to discard the suggestion.

### Expand Text

1.  Select the text you want to expand upon in your note.
2.  Open the Command Palette (`Ctrl+P` or `Cmd+P`).
3.  Type "Gemini: Expand Selected Text" or "Expand Selected Text with Gemini" and select the command.
4.  A modal will appear showing the expanded text generated by Gemini.
5.  Click **Confirm** to append the expanded text to your selection, or click **Cancel** to discard the suggestion.

## Settings

Access the plugin settings in Obsidian Settings -> Community plugins -> Gemini Copilot.

*   **Gemini API Key:** Enter your Gemini API key obtained from Google AI Studio. This is required for the plugin to function.
*   **Gemini Model:** Choose the Gemini model you want to use for API calls. Available models are listed in the dropdown.
*   **Gemini Interaction Log:** This section displays a history of your interactions with the Gemini API. It shows the timestamp, model used, input prompt, output response (truncated), and any errors that occurred. This log can be helpful for debugging or reviewing your usage.

## Disclaimer

*   This plugin utilizes the Google Gemini API. Please be aware of Google's API usage terms and conditions, including any potential costs associated with API usage beyond free limits.
*   The accuracy and relevance of the generated content depend on the Gemini API and the quality of your note content. Always review and edit the AI-generated output to ensure it meets your needs.
*   As with any AI-powered tool, results may vary.

## Support and Contribution

For bug reports, feature requests, or general questions, please visit the [GitHub repository](https://github.com/ikpark09/obsidian-gemini-copilot).

Contributions are welcome! Feel free to fork the repository, make changes, and submit pull requests.

## License

[MIT License](LICENSE) (You can add your license file and update this section accordingly)

---

**Enjoy using Gemini Copilot!**