import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile } from 'obsidian';
import { GoogleGenerativeAI } from "@google/generative-ai";

interface GeminiCopilotSettings {
    geminiApiKey: string;
    geminiModel: string;
    logHistory: GeminiLogEntry[];
    defaultNewFileLocation: string;
}

interface GeminiLogEntry {
    timestamp: string;
    model: string;
    inputPrompt: string;
    outputResponse: string | null;
    inputTokens?: number;
    outputTokens?: number;
    error?: string;
}

const DEFAULT_SETTINGS: GeminiCopilotSettings = {
    geminiApiKey: '',
    geminiModel: 'gemini-pro',
    logHistory: [],
    defaultNewFileLocation: 'root',
};

export default class GeminiCopilotPlugin extends Plugin {
    settings: GeminiCopilotSettings;
    private genAI: GoogleGenerativeAI | null = null;

    async onload() {
        await this.loadSettings();
        this.initializeGeminiAPI();

        this.addRibbonIcon('sparkles', 'Gemini Copilot', (evt: MouseEvent) => {
            new Notice('Gemini Copilot is ready!');
        });

        // Generate Note Title Command
        this.addCommand({
            id: 'gemini-generate-note-title',
            name: 'Generate Note Title with Gemini',
            editorCallback: async (editor: Editor, view: MarkdownView) => {
                const content = editor.getValue();
                if (!content) {
                    new Notice('Note content is empty. Cannot generate title.');
                    return;
                }

                try {
                    const suggestedTitle = await this.generateNoteTitle(content, view.file?.basename);
                    if (!suggestedTitle) {
                        new Notice('Failed to generate note title.');
                        return;
                    }

                    new GeminiConfirmationModal(this.app, suggestedTitle, async (confirmedTitle) => {
                        if (!confirmedTitle) return; // User cancelled

                        let newFileName = this.sanitizeFilename(confirmedTitle.trim());
                        const creationDate = new Date().toISOString().slice(0, 10); // Always use current date for new filename
                        const finalFileName = `${creationDate} - ${newFileName}`;


                        if (view.file) {
                            // Existing file: Rename
                            const originalFilePath = view.file.path;
                            const originalDir = originalFilePath.substring(0, originalFilePath.lastIndexOf('/'));
                            const newFilePath = `${originalDir}/${finalFileName}.${view.file.extension}`;

                            console.log("Original File Path:", originalFilePath);
                            console.log("Creation Date:", creationDate);
                            console.log("New File Name:", newFileName);
                            console.log("Final File Name with Date:", finalFileName);
                            console.log("New File Path:", newFilePath);
                            console.log("view.file.stat:", view.file?.stat);

                            try {
                                await this.app.fileManager.renameFile(view.file, newFilePath);
                                new Notice(`Note title updated to: ${finalFileName}`);
                            } catch (error) {
                                console.error('Error renaming file:', error);
                                new Notice(`Error renaming file: ${error.message}`);
                            }
                        } else {
                            // New File: Create

                            // Get default new file location from settings
                            let newFilePath = '';
                            if(this.settings.defaultNewFileLocation === 'root')
                            {
                                newFilePath = `${finalFileName}.md`; // Default: Vault root, add .md extension
                            }
                            else if (this.settings.defaultNewFileLocation === 'current')
                            {
                                // Try to get the path of the currently active file
                                const activeFile = this.app.workspace.getActiveFile();
                                if (activeFile)
                                {
                                    if (activeFile.parent) { // Check if parent exists
                                        const activeDir = activeFile.parent.path; // Get path of active file's directory
                                        newFilePath = `${activeDir}/${finalFileName}.md`; // Use active note's folder
                                    } else {
                                        // activeFile is in the root folder
                                        newFilePath = `${finalFileName}.md`;
                                        new Notice("Active file is in the root folder. New note will be created in the root.");
                                    }
                                }
                                else
                                {
                                     newFilePath = `${finalFileName}.md`; // Default: Vault root, add .md extension
                                     new Notice("No active file found. New note will created in root");
                                }

                            }
                            else // specific folder
                            {
                                 newFilePath = `${this.settings.defaultNewFileLocation}/${finalFileName}.md`
                            }

                            console.log("New File Path:", newFilePath);

                            try {
                                // Create the new file
                                const newFile = await this.app.vault.create(newFilePath, content);  // Use vault.create
                                new Notice(`New note created: ${finalFileName}`);

                                 // Open the new file in a new pane
                                 await this.app.workspace.getLeaf(true).openFile(newFile);

                            } catch (error) {
                                console.error('Error creating new file:', error);
                                new Notice(`Error creating file: ${error.message}`);
                            }
                        }
                    }).open();

                } catch (error) {
                    console.error('Error generating note title:', error);
                    new Notice('Error generating note title. See console for details.');
                }
            }
        });

        // Summarize Text Command
        this.addCommand({
            id: 'gemini-summarize-text',
            name: 'Summarize Selected Text with Gemini',
            editorCallback: async (editor: Editor, view: MarkdownView) => {
                const selectedText = editor.getSelection();
                if (!selectedText) {
                    new Notice('No text selected to summarize.');
                    return;
                }
                try {
                    const suggestedSummary = await this.summarizeText(selectedText);
                    if (suggestedSummary) {
                        new GeminiConfirmationModal(this.app, suggestedSummary, async (confirmedSummary) => {
                            if (confirmedSummary) {
                                editor.replaceSelection(confirmedSummary);
                                new Notice('Selected text summarized and replaced.');
                            }
                        }).open();
                    } else {
                        new Notice('Failed to summarize text.');
                    }
                } catch (error) {
                    console.error('Error summarizing text:', error);
                    new Notice('Error summarizing text. See console for details.');
                }
            }
        });

        // Expand Text Command
        this.addCommand({
            id: 'gemini-expand-text',
            name: 'Expand Selected Text with Gemini',
            editorCallback: async (editor: Editor, view: MarkdownView) => {
                const selectedText = editor.getSelection();
                if (!selectedText) {
                    new Notice('No text selected to expand.');
                    return;
                }
                try {
                    const suggestedExpansion = await this.generateAdditionalText(selectedText);
                    if (suggestedExpansion) {
                        new GeminiConfirmationModal(this.app, suggestedExpansion, async (confirmedExpansion) => {
                            if (confirmedExpansion) {
                                editor.replaceSelection(selectedText + '\n\n' + confirmedExpansion);
                                new Notice('Selected text expanded and appended.');
                            }
                        }).open();
                    } else {
                        new Notice('Failed to expand text.');
                    }
                } catch (error) {
                    console.error('Error expanding text:', error);
                    new Notice('Error expanding text. See console for details.');
                }
            }
        });

        // Generate Hashtags for All Notes Command
        this.addCommand({
            id: 'gemini-generate-hashtags-all-notes',
            name: 'Generate Hashtags for All Notes with Gemini',
            callback: async () => {
                const files = this.app.vault.getMarkdownFiles();
                for (const file of files) {
                    try {
                        const content = await this.app.vault.read(file);
                        const suggestedHashtags = await this.generateHashtags(content);

                        if (suggestedHashtags) {
                            new GeminiConfirmationModal(this.app, suggestedHashtags, async (confirmedHashtags) => {
                                if (confirmedHashtags) {
                                    // Add hashtags to the top of the file
                                    const newContent = `${confirmedHashtags}\n${content}`;
                                    await this.app.vault.modify(file, newContent);
                                    new Notice(`Hashtags added to ${file.name}`);
                                }
                            }).open();
                        } else {
                            new Notice(`Failed to generate hashtags for ${file.name}`);
                        }
                    } catch (error) {
                        console.error(`Error processing file ${file.name}:`, error);
                        new Notice(`Error processing file ${file.name}. See console for details.`);
                    }
                }
            }
        });

		// Generate Hashtags for Current Note Command
        this.addCommand({
            id: 'gemini-generate-hashtags-current-note',
            name: 'Generate Hashtags for Current Note with Gemini',
            editorCallback: async (editor: Editor, view: MarkdownView) => {
                const content = editor.getValue();
                if (!content) {
                    new Notice('Note content is empty. Cannot generate hashtags.');
                    return;
                }

                try {
                    const suggestedHashtags = await this.generateHashtags(content);

                    if (suggestedHashtags) {
                        new GeminiConfirmationModal(this.app, suggestedHashtags, async (confirmedHashtags) => {
                            if (confirmedHashtags && view.file) { // Check if confirmedHashtags is not null and view.file is not null
                                // Add hashtags to the top of the file
                                const newContent = `${confirmedHashtags}\n${content}`;
                                await this.app.vault.modify(view.file, newContent);
                                new Notice(`Hashtags added to current note`);
                            }
                        }).open();
                    } else {
                        new Notice('Failed to generate hashtags for current note.');
                    }
                } catch (error) {
                    console.error('Error generating hashtags for current note:', error);
                    new Notice('Error generating hashtags for current note. See console for details.');
                }
            }
        });

        this.addSettingTab(new GeminiCopilotSettingTab(this.app, this));
    }

    onunload() {
        this.genAI = null;
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
        this.initializeGeminiAPI();
    }

    private initializeGeminiAPI() {
        if (this.settings.geminiApiKey) {
            this.genAI = new GoogleGenerativeAI(this.settings.geminiApiKey);
        } else {
            this.genAI = null;
            console.warn('Gemini API Key is not set. Plugin features will be disabled.');
        }
    }

    private async generateContent(prompt: string): Promise<{ text: string | null }> {
        if (!this.genAI) {
            new Notice('Gemini API Key is not configured.');
            return { text: null };
        }

        let responseText: string | null = null;
        let logEntry: GeminiLogEntry = {
            timestamp: new Date().toISOString(),
            model: this.settings.geminiModel,
            inputPrompt: prompt,
            outputResponse: null,
            inputTokens: undefined,
            outputTokens: undefined,
            error: undefined
        };

        try {
            const model = this.genAI.getGenerativeModel({ model: this.settings.geminiModel });
            const result = await model.generateContent(prompt);
            responseText = result.response.text();
            logEntry.outputResponse = responseText;
            this.logGeminiInteraction(logEntry);
            return { text: responseText };

        } catch (error: any) {
            console.error('Gemini API Error:', error);
            logEntry.error = error.message;
            this.logGeminiInteraction(logEntry);
            new Notice('Gemini API call failed. See console for details.');
            return { text: null };
        }
    }

    private logGeminiInteraction(logEntry: GeminiLogEntry) {
        this.settings.logHistory.push(logEntry);
        this.saveSettings();
        console.log("Gemini Interaction Logged:", logEntry);
    }

    sanitizeFilename(filename: string): string {
        const invalidCharsRegex = /[*"\\\/<>:\|?]/g;
        return filename.replace(invalidCharsRegex, '_');
    }

    async generateNoteTitle(content: string, currentTitle: string | undefined): Promise<string | null> {
        const today = new Date().toISOString().slice(0, 10);
        const titlePrompt = currentTitle ? ` using current title: ${currentTitle}` : '';
        const prompt = `Generate a concise and informative title in 'date: title' format for a note with the following content:${titlePrompt} \n\n${content}\n\nOutput format: YYYY-MM-DD: title. Ensure the title part is suitable for filename (no special chars).`;
        const response = await this.generateContent(prompt);
        return response.text;
    }

    async summarizeText(text: string): Promise<string | null> {
        const prompt = `Please summarize the following text concisely:\n\n${text}\n\nSummary:`;
        const response = await this.generateContent(prompt);
        return response.text;
    }

    async generateAdditionalText(text: string): Promise<string | null> {
        const prompt = `Please expand upon the following text, adding more detail and information:\n\n${text}\n\nExpanded Text:`;
        const response = await this.generateContent(prompt);
        return response.text;
    }

    async generateHashtags(text: string): Promise<string | null> {
        const prompt = `한글로 다음 문서의 핵심을 나타내는 키워드를 10개 정도 추출하여 설명, 부호, 순서 없이 '#'로 시작하는 키워드로 출력하세요.\n 문서: \n ${text}\n\n해시태그: #`;
        const response = await this.generateContent(prompt);
        return response.text;
    }
}

class GeminiConfirmationModal extends Modal {
    resultText: string;
    onSubmit: (result: string | null) => Promise<void>;
    confirmedResult: string | null = null;

    constructor(app: App, resultText: string, onSubmit: (result: string | null) => Promise<void>) {
        super(app);
        this.resultText = resultText;
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;

        contentEl.createEl('h3', { text: 'Gemini Copilot Result' });
        contentEl.createEl('p', { text: 'Please review the generated content and confirm to apply.' });

        const resultContainer = contentEl.createEl('div', { cls: 'gemini-result-container' });
        resultContainer.createEl('pre', { text: this.resultText });

        const buttonContainer = contentEl.createEl('div', { cls: 'modal-button-container' });
        const cancelButton = buttonContainer.createEl('button', { text: 'Cancel', cls: 'mod-warning' });
        const confirmButton = buttonContainer.createEl('button', { text: 'Confirm', cls: 'mod-cta' });

        confirmButton.addEventListener('click', async () => {
            this.confirmedResult = this.resultText;
            await this.onSubmit(this.confirmedResult);
            this.close();
        });

        cancelButton.addEventListener('click', () => {
            this.confirmedResult = null;
            this.close();
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
        if (this.confirmedResult === null) {
            // Optionally handle cancellation if needed
        }
    }
}


class GeminiCopilotSettingTab extends PluginSettingTab {
    plugin: GeminiCopilotPlugin;

    constructor(app: App, plugin: GeminiCopilotPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;

        containerEl.empty();
        containerEl.createEl('h2', { text: 'Gemini Copilot Settings' });

        new Setting(containerEl)
            .setName('Gemini API Key')
            .setDesc('Enter your Gemini API key from Google AI Studio.')
            .addText(text => text
                .setPlaceholder('Enter API key')
                .setValue(this.plugin.settings.geminiApiKey)
                .onChange(async (value) => {
                    this.plugin.settings.geminiApiKey = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Gemini Model')
            .setDesc('Choose the Gemini model to use.')
            .addDropdown(dropdown => dropdown
                .addOptions({
                    'gemini-2.0-pro-exp-02-05': 'gemini-2.0-pro-exp-02-05',
                    'gemini-2.0-flash-thinking-exp-01-21': 'gemini-2.0-flash-thinking-exp-01-21',
                    'gemini-2.0-flash-exp': 'gemini-2.0-flash-exp',
                    'gemini-pro': 'gemini-pro',
                    'gemini-pro-vision': 'gemini-pro-vision',
                })
                .setValue(this.plugin.settings.geminiModel)
                .onChange(async (value: string) => {
                    this.plugin.settings.geminiModel = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Default New File Location')
            .setDesc('Set the default location for new files created by Gemini Copilot.')
            .addDropdown(dropdown => dropdown
                .addOptions({
                    root: 'Vault Root',
                    current: 'Current Folder',
                })
                .setValue(this.plugin.settings.defaultNewFileLocation)
                .onChange(async (value) => {
                    this.plugin.settings.defaultNewFileLocation = value;
                    await this.plugin.saveSettings();
                })
            );

        containerEl.createEl('h3', { text: 'Gemini Interaction Log' });
        const logContainer = containerEl.createEl('div');
        logContainer.style.maxHeight = '300px';
        logContainer.style.overflowY = 'auto';
        logContainer.style.border = '1px solid var(--background-modifier-border)';
        logContainer.style.padding = '10px';
        logContainer.style.borderRadius = '5px';

        if (this.plugin.settings.logHistory.length === 0) {
            logContainer.createEl('p', { text: 'No Gemini interactions logged yet.' });
        } else {
            this.plugin.settings.logHistory.slice().reverse().forEach(logEntry => {
                const entryEl = logContainer.createEl('div');
                entryEl.style.marginBottom = '10px';
                entryEl.createEl('p', { text: `Timestamp: ${logEntry.timestamp}`, attr: { style: 'font-size: smaller; color: var(--text-muted);' } });
                entryEl.createEl('p', { text: `Model: ${logEntry.model}` });
                entryEl.createEl('p', { text: `Input: ${logEntry.inputPrompt.substring(0, 100)}...`, attr: { title: logEntry.inputPrompt } });
                entryEl.createEl('p', { text: `Output: ${logEntry.outputResponse ? logEntry.outputResponse.substring(0, 100) + '...' : 'Error'}`, attr: { title: logEntry.outputResponse || 'Error' } });
                if (logEntry.error) {
                    entryEl.createEl('p', { text: `Error: ${logEntry.error}`, attr: { style: 'color: var(--color-red);' } });
                }
                containerEl.createEl('hr');
            });
        }
    }
}