import { App, Modal, Setting } from 'obsidian';
import { CustomPrompt } from './main';

// 커스텀 프롬프트 편집 모달
export class CustomPromptModal extends Modal {
    prompt: CustomPrompt;
    onSubmit: (editedPrompt: CustomPrompt | null) => Promise<void>;

    constructor(app: App, prompt: CustomPrompt, onSubmit: (editedPrompt: CustomPrompt | null) => Promise<void>) {
        super(app);
        this.prompt = prompt;
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;

        contentEl.createEl('h3', { text: 'Edit Custom Prompt' });

        new Setting(contentEl)
            .setName('Prompt Name')
            .addText(text => text
                .setValue(this.prompt.name)
                .onChange(value => this.prompt.name = value));

        new Setting(contentEl)
            .setName('Prompt Description')
            .addText(text => text
                .setValue(this.prompt.description)
                .onChange(value => this.prompt.description = value));

        new Setting(contentEl)
            .setName('Prompt Content')
            .addTextArea(text => {
                text.setValue(this.prompt.prompt)
                    .onChange(value => this.prompt.prompt = value);
                text.inputEl.addClass("prompt-template-textarea");
            });

        const buttonContainer = contentEl.createEl('div', { cls: 'modal-button-container' });
        const cancelButton = buttonContainer.createEl('button', { text: 'Cancel', cls: 'mod-warning' });
        const confirmButton = buttonContainer.createEl('button', { text: 'Save', cls: 'mod-cta' });

        confirmButton.addEventListener('click', async () => {
            await this.onSubmit(this.prompt);
            this.close();
        });

        cancelButton.addEventListener('click', () => {
            this.onSubmit(null);
            this.close();
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
