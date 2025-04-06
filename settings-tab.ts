import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import GeminiCopilotPlugin from './main';
import { CustomPrompt, DEFAULT_SETTINGS } from './main';
import { CustomPromptModal } from './modals';

export class GeminiCopilotSettingTab extends PluginSettingTab {
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
            .setDesc('Enter the Gemini model name to use (e.g., gemini-pro, gemini-2.0-pro).')
            .addText(text => text
                .setPlaceholder('예: gemini-pro')
                .setValue(this.plugin.settings.geminiModel)
                .onChange(async (value) => {
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

        // 프롬프트 템플릿 설정 섹션
        containerEl.createEl('h3', { text: '프롬프트 템플릿 설정' });
        containerEl.createEl('p', { 
            text: '각 기능의 프롬프트 템플릿을 수정할 수 있습니다. 다음 변수를 사용할 수 있습니다:',
            cls: 'settings-variables-list'
        });
        
        const variablesList = containerEl.createEl('ul');
        variablesList.createEl('li', { text: '{{content}} - 선택한 텍스트 또는 노트 내용' });
        variablesList.createEl('li', { text: '{{currentTitle}} - 현재 노트의 제목 (노트 제목 생성 시 사용)' });
        variablesList.createEl('li', { text: '{{sourceTitle}}, {{sourceConcepts}}, {{targetTitle}}, {{targetConcepts}} - 문서 관계 분석 시 사용' });

        // 노트 제목 생성 프롬프트
        this.addPromptTemplateSetting(
            containerEl,
            '노트 제목 생성 프롬프트',
            '노트 내용을 기반으로 제목을 생성할 때 사용하는 프롬프트입니다.',
            'promptTemplates.generateTitle'
        );

        // 텍스트 요약 프롬프트
        this.addPromptTemplateSetting(
            containerEl,
            '텍스트 요약 프롬프트',
            '선택한 텍스트를 요약할 때 사용하는 프롬프트입니다.',
            'promptTemplates.summarizeText'
        );

        // 텍스트 확장 프롬프트
        this.addPromptTemplateSetting(
            containerEl,
            '텍스트 확장 프롬프트',
            '선택한 텍스트를 확장할 때 사용하는 프롬프트입니다.',
            'promptTemplates.expandText'
        );

        // 해시태그 생성 프롬프트
        this.addPromptTemplateSetting(
            containerEl,
            '해시태그 생성 프롬프트',
            '노트 내용에서 해시태그를 생성할 때 사용하는 프롬프트입니다.',
            'promptTemplates.generateHashtags'
        );

        // 핵심 개념 추출 프롬프트
        this.addPromptTemplateSetting(
            containerEl,
            '핵심 개념 추출 프롬프트',
            '지식 그래프 생성 시 문서에서 핵심 개념을 추출하는 프롬프트입니다.',
            'promptTemplates.extractCoreConcepts'
        );

        // 문서 관계 분석 프롬프트
        this.addPromptTemplateSetting(
            containerEl,
            '문서 관계 분석 프롬프트',
            '지식 그래프 생성 시 두 문서의 관계를 분석하는 프롬프트입니다.',
            'promptTemplates.analyzeDocumentRelation'
        );

        // 프롬프트 초기화 버튼
        new Setting(containerEl)
            .setName('모든 프롬프트 초기화')
            .setDesc('모든 프롬프트 템플릿을 기본값으로 되돌립니다.')
            .addButton(button => button
                .setButtonText('초기화')
                .onClick(async () => {
                    this.plugin.settings.promptTemplates = Object.assign({}, DEFAULT_SETTINGS.promptTemplates);
                    await this.plugin.saveSettings();
                    new Notice('프롬프트 템플릿이 초기화되었습니다.');
                    this.display();
                })
            );

        // 지식 그래프 설정 섹션
        containerEl.createEl('h3', { text: '지식 그래프 설정' });

        new Setting(containerEl)
            .setName('지식 그래프 활성화')
            .setDesc('자동으로 문서 간 연결을 생성하고 그래프 뷰에 표시합니다.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.knowledgeGraphSettings.enabled)
                .onChange(async (value) => {
                    this.plugin.settings.knowledgeGraphSettings.enabled = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('최소 유사도 점수')
            .setDesc('문서 간 연결을 생성하기 위한 최소 유사도 점수 (0.0 ~ 1.0)')
            .addSlider(slider => slider
                .setLimits(0.1, 0.9, 0.1)
                .setValue(this.plugin.settings.knowledgeGraphSettings.minSimilarityScore)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.knowledgeGraphSettings.minSimilarityScore = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('문서당 최대 링크 수')
            .setDesc('한 문서에 생성할 최대 링크 수')
            .addSlider(slider => slider
                .setLimits(1, 10, 1)
                .setValue(this.plugin.settings.knowledgeGraphSettings.maxLinksPerDocument)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.knowledgeGraphSettings.maxLinksPerDocument = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('자동으로 링크 추가')
            .setDesc('분석 후 자동으로 문서에 위키링크([[링크]])를 추가합니다.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.knowledgeGraphSettings.autoAddLinks)
                .onChange(async (value) => {
                    this.plugin.settings.knowledgeGraphSettings.autoAddLinks = value;
                    await this.plugin.saveSettings();
                }));

        // 커스텀 프롬프트 설정 섹션
        containerEl.createEl('h3', { text: '커스텀 프롬프트' });
        
        // 기존 커스텀 프롬프트 목록
        this.plugin.settings.customPrompts.forEach((prompt, index) => {
            const promptSetting = new Setting(containerEl)
                .setName(prompt.name)
                .setDesc(prompt.description)
                .addButton(button => button
                    .setButtonText('삭제')
                    .onClick(async () => {
                        this.plugin.settings.customPrompts.splice(index, 1);
                        await this.plugin.saveSettings();
                        this.display();
                    }))
                .addButton(button => button
                    .setButtonText('편집')
                    .onClick(() => {
                        new CustomPromptModal(this.app, prompt, async (editedPrompt) => {
                            if (editedPrompt) {
                                this.plugin.settings.customPrompts[index] = editedPrompt;
                                await this.plugin.saveSettings();
                                this.display();
                            }
                        }).open();
                    })
                );
        });

        // 새 프롬프트 추가 버튼
        new Setting(containerEl)
            .setName('새 커스텀 프롬프트 추가')
            .setDesc('Gemini API에 전송할 커스텀 프롬프트를 만듭니다. {{content}} 플레이스홀더를 사용하여 선택한 텍스트를 프롬프트에 포함시킬 수 있습니다.')
            .addButton(button => button
                .setButtonText('추가')
                .setCta()
                .onClick(() => {
                    const newPrompt = { name: '', prompt: '', description: '' };
                    new CustomPromptModal(this.app, newPrompt, async (editedPrompt) => {
                        if (editedPrompt) {
                            if (!this.plugin.settings.customPrompts) {
                                this.plugin.settings.customPrompts = [];
                            }
                            this.plugin.settings.customPrompts.push(editedPrompt);
                            await this.plugin.saveSettings();
                            this.display();
                        }
                    }).open();
                })
            );

        containerEl.createEl('h3', { text: 'Gemini Interaction Log' });
        const logContainer = containerEl.createEl('div', { cls: 'gemini-log-container' });

        if (this.plugin.settings.logHistory.length === 0) {
            logContainer.createEl('p', { text: 'No Gemini interactions logged yet.' });
        } else {
            this.plugin.settings.logHistory.slice().reverse().forEach(logEntry => {
                const entryEl = logContainer.createEl('div', { cls: 'gemini-log-entry' });
                entryEl.createEl('p', { text: `Timestamp: ${logEntry.timestamp}`, cls: 'gemini-log-timestamp' });
                entryEl.createEl('p', { text: `Model: ${logEntry.model}` });
                entryEl.createEl('p', { text: `Input: ${logEntry.inputPrompt.substring(0, 100)}...`, attr: { title: logEntry.inputPrompt } });
                entryEl.createEl('p', { text: `Output: ${logEntry.outputResponse ? logEntry.outputResponse.substring(0, 100) + '...' : 'Error'}`, attr: { title: logEntry.outputResponse || 'Error' } });
                if (logEntry.error) {
                    entryEl.createEl('p', { text: `Error: ${logEntry.error}`, cls: 'gemini-log-error' });
                }
                containerEl.createEl('hr');
            });
        }
    }

    // 프롬프트 템플릿 설정 항목을 추가하는 헬퍼 메서드
    private addPromptTemplateSetting(
        containerEl: HTMLElement, 
        name: string, 
        desc: string, 
        settingPath: string
    ): void {
        // 점으로 구분된 경로로부터 실제 설정 값을 가져오는 함수
        const getNestedSettingValue = (obj: Record<string, unknown>, path: string): string => {
            const parts = path.split('.');
            let current: Record<string, unknown> | unknown = obj;
            for (const part of parts) {
                if (current && typeof current === 'object' && part in current) {
                    current = (current as Record<string, unknown>)[part];
                } else {
                    return '';
                }
            }
            return current as string;
        };

        // 점으로 구분된 경로에 설정 값을 저장하는 함수
        const setNestedSettingValue = (obj: Record<string, unknown>, path: string, value: string): void => {
            const parts = path.split('.');
            let current: Record<string, unknown> = obj;
            for (let i = 0; i < parts.length - 1; i++) {
                const part = parts[i];
                if (!(part in current)) {
                    current[part] = {};
                }
                current = current[part] as Record<string, unknown>;
            }
            current[parts[parts.length - 1]] = value;
        };

        const setting = new Setting(containerEl)
            .setName(name)
            .setDesc(desc)
            .addTextArea(textarea => textarea
                .setValue(getNestedSettingValue(this.plugin.settings as Record<string, unknown>, settingPath))
                .onChange(async (value) => {
                    setNestedSettingValue(this.plugin.settings as Record<string, unknown>, settingPath, value);
                    await this.plugin.saveSettings();
                })
            );

        // 텍스트 영역에 CSS 클래스 적용
        const textareaComponent = setting.components[0];
        if (textareaComponent && textareaComponent.inputEl) {
            textareaComponent.inputEl.addClass('prompt-template-textarea');
        }

        // 기본값으로 초기화 버튼 추가
        setting.addButton(button => button
            .setButtonText('기본값으로 초기화')
            .onClick(async () => {
                const defaultValue = getNestedSettingValue(DEFAULT_SETTINGS as Record<string, unknown>, settingPath);
                setNestedSettingValue(this.plugin.settings as Record<string, unknown>, settingPath, defaultValue);
                await this.plugin.saveSettings();
                this.display(); // 설정 화면 새로고침
                new Notice(`${name} 프롬프트가 기본값으로 초기화되었습니다.`);
            })
        );
    }
}
