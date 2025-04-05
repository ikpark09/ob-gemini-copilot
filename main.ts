import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, Menu } from 'obsidian';
import { GoogleGenerativeAI } from "@google/generative-ai";

interface GeminiCopilotSettings {
    geminiApiKey: string;
    geminiModel: string;
    logHistory: GeminiLogEntry[];
    defaultNewFileLocation: string;
    customPrompts: CustomPrompt[];
    knowledgeGraphSettings: {
        enabled: boolean;
        minSimilarityScore: number;
        maxLinksPerDocument: number;
        autoAddLinks: boolean;
    };
    promptTemplates: {
        generateTitle: string;
        summarizeText: string;
        expandText: string;
        generateHashtags: string;
        extractCoreConcepts: string;
        analyzeDocumentRelation: string;
    };
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

interface CustomPrompt {
    name: string;
    prompt: string;
    description: string;
}

// 문서 관계 인터페이스 정의
interface DocumentRelation {
    sourceFile: TFile;
    targetFile: TFile;
    similarityScore: number;
    extractedContext: string;
}

// Obsidian의 App 인터페이스 확장
declare module 'obsidian' {
    interface App {
        plugins: {
            plugins: {
                [id: string]: any;
            };
        };
        commands: {
            executeCommandById(id: string): boolean;
        };
        setting: {
            open(): void;
            openTabById(id: string): void;
        };
    }
}

const DEFAULT_SETTINGS: GeminiCopilotSettings = {
    geminiApiKey: '',
    geminiModel: 'gemini-pro',
    logHistory: [],
    defaultNewFileLocation: 'root',
    customPrompts: [],
    knowledgeGraphSettings: {
        enabled: false,
        minSimilarityScore: 0.5,
        maxLinksPerDocument: 5,
        autoAddLinks: false,
    },
    promptTemplates: {
        generateTitle: 'Generate a concise and informative title for the following note content:{{currentTitle}}\n\n{{content}}\n\nOutput format: YYYY-MM-DD: title. Ensure the title part is suitable for filename (no special chars).',
        summarizeText: 'Please summarize the following text concisely:\n\n{{content}}\n\nSummary:',
        expandText: 'Please expand upon the following text, adding more detail and information:\n\n{{content}}\n\nExpanded Text:',
        generateHashtags: '한글로 다음 문서의 핵심을 나타내는 키워드를 10개 정도 추출하여 설명, 부호, 순서 없이 \'#\'로 시작하는 키워드로 출력하세요.\n문서: \n{{content}}\n\n해시태그: #',
        extractCoreConcepts: '다음 문서에서 핵심 개념, 주제, 키워드를 5-10개 정도 추출해 주세요. JSON 형식으로 반환하되, 키워드는 단어나 짧은 구문으로 제한해주세요.\n\n문서:\n{{content}}\n\n출력 형식:\n{\n    "concepts": ["개념1", "개념2", "개념3", ...]\n}',
        analyzeDocumentRelation: '두 문서 간의 관계를 분석하고 유사도 점수(0.0 ~ 1.0 사이)를 매겨주세요.\n\n문서 1: "{{sourceTitle}}"\n핵심 개념: {{sourceConcepts}}\n\n문서 2: "{{targetTitle}}"\n핵심 개념: {{targetConcepts}}\n\n다음 형식으로 JSON으로 응답해주세요:\n{\n    "similarityScore": 0.0부터 1.0 사이의 숫자,\n    "context": "두 문서가 어떻게 관련되어 있는지에 대한 간략한 설명(1-2문장)"\n}'
    },
};

export default class GeminiCopilotPlugin extends Plugin {
    settings: GeminiCopilotSettings;
    private genAI: GoogleGenerativeAI | null = null;

    async onload() {
        await this.loadSettings();
        this.initializeGeminiAPI();

        this.addRibbonIcon('sparkles', 'Gemini Copilot', (evt: MouseEvent) => {
            // 메뉴 생성 및 표시
            const menu = new Menu();
            
            // 노트 제목 생성 기능
            menu.addItem((item) => {
                item.setTitle('노트 제목 생성')
                    .setIcon('heading')
                    .onClick(async () => {
                        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
                        if (activeView) {
                            const content = activeView.editor.getValue();
                            if (!content) {
                                new Notice('노트 내용이 비어있습니다.');
                                return;
                            }

                            try {
                                const suggestedTitle = await this.generateNoteTitle(content, activeView.file?.basename);
                                if (!suggestedTitle) {
                                    new Notice('제목 생성에 실패했습니다.');
                                    return;
                                }

                                new GeminiConfirmationModal(this.app, suggestedTitle, async (confirmedTitle) => {
                                    if (!confirmedTitle) return; // 사용자가 취소함

                                    let newFileName = this.sanitizeFilename(confirmedTitle.trim());
                                    const creationDate = new Date().toISOString().slice(0, 10);
                                    const finalFileName = `${creationDate} - ${newFileName}`;

                                    if (activeView.file) {
                                        // 기존 파일 이름 변경
                                        const originalFilePath = activeView.file.path;
                                        const dirPath = activeView.file.parent ? activeView.file.parent.path : "";
                                        const newFilePath = dirPath ? `${dirPath}/${finalFileName}.${activeView.file.extension}` : `${finalFileName}.${activeView.file.extension}`;

                                        try {
                                            await this.app.fileManager.renameFile(activeView.file, newFilePath);
                                            new Notice(`노트 제목이 다음으로 변경되었습니다: ${finalFileName}`);
                                        } catch (error) {
                                            console.error('파일 이름 변경 오류:', error);
                                            new Notice(`파일 이름 변경 오류: ${error.message}`);
                                        }
                                    } else {
                                        // 신규 파일 생성
                                        this.createNewFileWithTitle(content, finalFileName);
                                    }
                                }).open();

                            } catch (error) {
                                console.error('노트 제목 생성 오류:', error);
                                new Notice('노트 제목 생성 중 오류가 발생했습니다.');
                            }
                        } else {
                            new Notice('노트가 열려있지 않습니다.');
                        }
                    });
            });
            
            // 텍스트 요약 기능
            menu.addItem((item) => {
                item.setTitle('선택한 텍스트 요약')
                    .setIcon('align-justify')
                    .onClick(async () => {
                        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
                        if (activeView && activeView.editor.getSelection()) {
                            const selectedText = activeView.editor.getSelection();
                            try {
                                const suggestedSummary = await this.summarizeText(selectedText);
                                if (suggestedSummary) {
                                    new GeminiConfirmationModal(this.app, suggestedSummary, async (confirmedSummary) => {
                                        if (confirmedSummary) {
                                            activeView.editor.replaceSelection(confirmedSummary);
                                            new Notice('선택한 텍스트가 요약되어 대체되었습니다.');
                                        }
                                    }).open();
                                } else {
                                    new Notice('텍스트 요약에 실패했습니다.');
                                }
                            } catch (error) {
                                console.error('텍스트 요약 오류:', error);
                                new Notice('텍스트 요약 중 오류가 발생했습니다.');
                            }
                        } else {
                            new Notice('텍스트를 선택해 주세요.');
                        }
                    });
            });
            
            // 텍스트 확장 기능
            menu.addItem((item) => {
                item.setTitle('선택한 텍스트 확장')
                    .setIcon('expand-vertically')
                    .onClick(async () => {
                        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
                        if (activeView && activeView.editor.getSelection()) {
                            const selectedText = activeView.editor.getSelection();
                            try {
                                const suggestedExpansion = await this.generateAdditionalText(selectedText);
                                if (suggestedExpansion) {
                                    new GeminiConfirmationModal(this.app, suggestedExpansion, async (confirmedExpansion) => {
                                        if (confirmedExpansion) {
                                            activeView.editor.replaceSelection(selectedText + '\n\n' + confirmedExpansion);
                                            new Notice('선택한 텍스트가 확장되어 추가되었습니다.');
                                        }
                                    }).open();
                                } else {
                                    new Notice('텍스트 확장에 실패했습니다.');
                                }
                            } catch (error) {
                                console.error('텍스트 확장 오류:', error);
                                new Notice('텍스트 확장 중 오류가 발생했습니다.');
                            }
                        } else {
                            new Notice('텍스트를 선택해 주세요.');
                        }
                    });
            });
            
            // 현재 노트에 해시태그 생성 기능
            menu.addItem((item) => {
                item.setTitle('현재 노트에 해시태그 추가')
                    .setIcon('hash')
                    .onClick(async () => {
                        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
                        if (activeView) {
                            const content = activeView.editor.getValue();
                            if (!content) {
                                new Notice('노트 내용이 비어있습니다.');
                                return;
                            }

                            try {
                                const suggestedHashtags = await this.generateHashtags(content);
                                if (suggestedHashtags && activeView.file) {
                                    new GeminiConfirmationModal(this.app, suggestedHashtags, async (confirmedHashtags) => {
                                        if (confirmedHashtags) {
                                            // 해시태그를 파일 상단에 추가
                                            const newContent = `${confirmedHashtags}\n${content}`;
                                            await this.app.vault.modify(activeView.file!, newContent);
                                            new Notice('현재 노트에 해시태그가 추가되었습니다.');
                                        }
                                    }).open();
                                } else {
                                    new Notice('해시태그 생성에 실패했습니다.');
                                }
                            } catch (error) {
                                console.error('해시태그 생성 오류:', error);
                                new Notice('해시태그 생성 중 오류가 발생했습니다.');
                            }
                        } else {
                            new Notice('노트가 열려있지 않습니다.');
                        }
                    });
            });
            
            // 커스텀 프롬프트 실행 기능
            menu.addItem((item) => {
                item.setTitle('커스텀 프롬프트 실행')
                    .setIcon('message-square')
                    .onClick(() => {
                        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
                        if (activeView) {
                            if (this.settings.customPrompts.length === 0) {
                                new Notice('설정에 정의된 커스텀 프롬프트가 없습니다.');
                                return;
                            }

                            const selectedText = activeView.editor.getSelection();
                            if (!selectedText) {
                                new Notice('텍스트를 선택해 주세요.');
                                return;
                            }

                            // 프롬프트 선택 모달 표시
                            const promptSelector = new CustomPromptSelectorModal(this.app, this.settings.customPrompts, 
                                async (selectedPrompt: CustomPrompt | null) => {
                                    if (!selectedPrompt) return;

                                    try {
                                        // {{content}}를 선택한 텍스트로 대체
                                        const fullPrompt = selectedPrompt.prompt.replace('{{content}}', selectedText);
                                        const result = await this.generateContent(fullPrompt);
                                        
                                        if (result.text) {
                                            new GeminiConfirmationModal(this.app, result.text, async (confirmedText) => {
                                                if (confirmedText) {
                                                    activeView.editor.replaceSelection(confirmedText);
                                                    new Notice(`"${selectedPrompt.name}" 프롬프트가 적용되었습니다.`);
                                                }
                                            }).open();
                                        } else {
                                            new Notice(`"${selectedPrompt.name}" 프롬프트 처리에 실패했습니다.`);
                                        }
                                    } catch (error) {
                                        console.error('커스텀 프롬프트 실행 오류:', error);
                                        new Notice('커스텀 프롬프트 실행 중 오류가 발생했습니다.');
                                    }
                                }
                            );
                            promptSelector.open();
                        } else {
                            new Notice('노트가 열려있지 않습니다.');
                        }
                    });
            });
            
            // 지식 그래프 관련 메뉴 그룹 추가
            menu.addSeparator();
            
            // 지식 그래프가 활성화된 경우에만 표시
            if (this.settings.knowledgeGraphSettings.enabled) {
                // 지식 그래프 생성 기능
                menu.addItem((item) => {
                    item.setTitle('지식 그래프 생성')
                        .setIcon('network')
                        .onClick(async () => {
                            new Notice('지식 그래프 분석을 시작합니다. 문서 수에 따라 시간이 소요될 수 있습니다.');
                            await this.generateKnowledgeGraph();
                        });
                });
                
                // 관련 문서 찾기 기능
                menu.addItem((item) => {
                    item.setTitle('현재 문서의 관련 문서 찾기')
                        .setIcon('search')
                        .onClick(async () => {
                            const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
                            if (activeView && activeView.file) {
                                const content = activeView.editor.getValue();
                                if (!content) {
                                    new Notice('문서 내용이 비어있습니다.');
                                    return;
                                }

                                new Notice('관련 문서를 찾는 중입니다...');
                                const relatedDocs = await this.findRelatedDocuments(activeView.file, content);
                                
                                if (relatedDocs.length === 0) {
                                    new Notice('관련 문서를 찾지 못했습니다.');
                                    return;
                                }

                                new RelatedDocumentsModal(this.app, relatedDocs, this).open();
                            } else {
                                new Notice('노트가 열려있지 않습니다.');
                            }
                        });
                });
            } else {
                // 지식 그래프 기능이 비활성화된 경우
                menu.addItem((item) => {
                    item.setTitle('지식 그래프 기능 활성화')
                        .setIcon('settings')
                        .onClick(() => {
                            // 설정 탭으로 이동
                            this.app.setting.open();
                            this.app.setting.openTabById('obsidian-gemini-copilot');
                            new Notice('설정에서 지식 그래프 기능을 활성화해주세요.');
                        });
                });
            }
            
            // 설정 열기 메뉴 추가
            menu.addSeparator();
            menu.addItem((item) => {
                item.setTitle('설정')
                    .setIcon('settings')
                    .onClick(() => {
                        this.app.setting.open();
                        this.app.setting.openTabById('obsidian-gemini-copilot');
                    });
            });
            
            // 메뉴 표시
            menu.showAtMouseEvent(evt);
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
                            // 원본 파일의 디렉토리 경로를 추출, 파일이 루트에 있는 경우 빈 문자열이 됨
                            const dirPath = view.file.parent ? view.file.parent.path : "";
                            // 디렉토리 경로가 있으면 경로 구분자를 추가하여 새 파일 경로 작성
                            const newFilePath = dirPath ? `${dirPath}/${finalFileName}.${view.file.extension}` : `${finalFileName}.${view.file.extension}`;

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
                                if (activeFile && activeFile.parent) { // Check if activeFile and parent exists
                                    const activeDir = activeFile.parent.path; // Get path of active file's directory
                                    newFilePath = `${activeDir}/${finalFileName}.md`; // Use active note's folder
                                } else {
                                    // activeFile is in the root folder or doesn't exist
                                    newFilePath = `${finalFileName}.md`;
                                    new Notice("New note will be created in the root folder.");
                                }
                            }
                            else if (this.settings.defaultNewFileLocation) { // 특정 폴더가 설정된 경우
                                newFilePath = `${this.settings.defaultNewFileLocation}/${finalFileName}.md`;
                            } else {
                                // 설정이 제대로 되지 않은 경우 기본값으로 루트 사용
                                newFilePath = `${finalFileName}.md`;
                                console.warn("Invalid newFileLocation setting, using root folder");
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

        // Run Custom Prompt Command
        this.addCommand({
            id: 'gemini-run-custom-prompt',
            name: 'Run Custom Prompt with Gemini',
            editorCallback: async (editor: Editor, view: MarkdownView) => {
                if (this.settings.customPrompts.length === 0) {
                    new Notice('No custom prompts defined. Please add some in the settings.');
                    return;
                }

                const selectedText = editor.getSelection();
                if (!selectedText) {
                    new Notice('No text selected. Please select some text to use with your custom prompt.');
                    return;
                }

                // Create selector modal
                const promptSelector = new CustomPromptSelectorModal(this.app, this.settings.customPrompts, 
                    async (selectedPrompt: CustomPrompt | null) => {
                        if (!selectedPrompt) return;

                        try {
                            // Replace {{content}} with the selected text
                            const fullPrompt = selectedPrompt.prompt.replace('{{content}}', selectedText);
                            const result = await this.generateContent(fullPrompt);
                            
                            if (result.text) {
                                new GeminiConfirmationModal(this.app, result.text, async (confirmedText) => {
                                    if (confirmedText) {
                                        editor.replaceSelection(confirmedText);
                                        new Notice(`Applied "${selectedPrompt.name}" prompt to the selected text.`);
                                    }
                                }).open();
                            } else {
                                new Notice(`Failed to process prompt "${selectedPrompt.name}".`);
                            }
                        } catch (error) {
                            console.error('Error running custom prompt:', error);
                            new Notice('Error running custom prompt. See console for details.');
                        }
                    }
                );
                promptSelector.open();
            }
        });

        // 지식 그래프 생성 명령어
        this.addCommand({
            id: 'gemini-generate-knowledge-graph',
            name: '지식 그래프 생성하기',
            callback: async () => {
                if (!this.settings.knowledgeGraphSettings.enabled) {
                    new Notice('지식 그래프 기능이 비활성화되어 있습니다. 설정에서 활성화해주세요.');
                    return;
                }

                new Notice('지식 그래프 분석을 시작합니다. 문서 수에 따라 시간이 소요될 수 있습니다.');
                await this.generateKnowledgeGraph();
            }
        });

        // 현재 문서의 관련 문서 찾기 명령어
        this.addCommand({
            id: 'gemini-find-related-documents',
            name: '현재 문서의 관련 문서 찾기',
            editorCallback: async (editor: Editor, view: MarkdownView) => {
                if (!this.settings.knowledgeGraphSettings.enabled) {
                    new Notice('지식 그래프 기능이 비활성화되어 있습니다. 설정에서 활성화해주세요.');
                    return;
                }

                if (!view.file) {
                    new Notice('열려있는 파일이 없습니다.');
                    return;
                }

                const content = editor.getValue();
                if (!content) {
                    new Notice('문서 내용이 비어있습니다.');
                    return;
                }

                new Notice('관련 문서를 찾는 중입니다...');
                const relatedDocs = await this.findRelatedDocuments(view.file, content);
                
                if (relatedDocs.length === 0) {
                    new Notice('관련 문서를 찾지 못했습니다.');
                    return;
                }

                new RelatedDocumentsModal(this.app, relatedDocs, this).open();
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
        let prompt = this.settings.promptTemplates.generateTitle;
        
        // 변수 교체
        prompt = prompt.replace('{{content}}', content);
        prompt = prompt.replace('{{currentTitle}}', currentTitle ? ` using current title: ${currentTitle}` : '');
        
        const response = await this.generateContent(prompt);
        return response.text;
    }

    async summarizeText(text: string): Promise<string | null> {
        let prompt = this.settings.promptTemplates.summarizeText;
        
        // 변수 교체
        prompt = prompt.replace('{{content}}', text);
        
        const response = await this.generateContent(prompt);
        return response.text;
    }

    async generateAdditionalText(text: string): Promise<string | null> {
        let prompt = this.settings.promptTemplates.expandText;
        
        // 변수 교체
        prompt = prompt.replace('{{content}}', text);
        
        const response = await this.generateContent(prompt);
        return response.text;
    }

    async generateHashtags(text: string): Promise<string | null> {
        let prompt = this.settings.promptTemplates.generateHashtags;
        
        // 변수 교체
        prompt = prompt.replace('{{content}}', text);
        
        const response = await this.generateContent(prompt);
        return response.text;
    }

    // 지식 그래프 생성 메서드
    async generateKnowledgeGraph(): Promise<void> {
        const markdownFiles = this.app.vault.getMarkdownFiles();
        
        if (markdownFiles.length === 0) {
            new Notice('분석할 마크다운 파일이 없습니다.');
            return;
        }

        const totalFiles = markdownFiles.length;
        let processedFiles = 0;
        const relations: DocumentRelation[] = [];

        // 각 파일을 처리
        for (const sourceFile of markdownFiles) {
            try {
                const sourceContent = await this.app.vault.read(sourceFile);
                if (!sourceContent.trim()) continue; // 빈 파일 건너뛰기

                // 관련 문서 찾기
                const relatedDocs = await this.findRelatedDocuments(sourceFile, sourceContent);
                relations.push(...relatedDocs);

                // 진행 상황 업데이트
                processedFiles++;
                if (processedFiles % 10 === 0 || processedFiles === totalFiles) {
                    new Notice(`지식 그래프 분석 중: ${processedFiles}/${totalFiles} 파일 처리됨`);
                }
            } catch (error) {
                console.error(`파일 ${sourceFile.path} 처리 중 오류 발생:`, error);
            }
        }

        // 자동으로 링크 추가하기 (설정에서 활성화된 경우)
        if (this.settings.knowledgeGraphSettings.autoAddLinks) {
            await this.addWikiLinksToDocuments(relations);
        }

        new Notice(`지식 그래프 생성 완료: 총 ${relations.length}개의 관계 발견`);
        
        // 분석 결과 요약 표시
        new KnowledgeGraphSummaryModal(this.app, relations).open();
    }

    // 관련 문서 찾기
    async findRelatedDocuments(sourceFile: TFile, sourceContent: string): Promise<DocumentRelation[]> {
        const markdownFiles = this.app.vault.getMarkdownFiles();
        const relations: DocumentRelation[] = [];
        
        // 소스 파일 자신은 제외
        const otherFiles = markdownFiles.filter(file => file.path !== sourceFile.path);
        
        // 소스 문서의 핵심 개념 추출
        const sourceConcepts = await this.extractCoreConcepts(sourceContent);
        if (!sourceConcepts) return relations;

        // 각 파일과 비교
        for (const targetFile of otherFiles) {
            try {
                const targetContent = await this.app.vault.read(targetFile);
                if (!targetContent.trim()) continue; // 빈 파일 건너뛰기

                // 타겟 문서의 핵심 개념 추출
                const targetConcepts = await this.extractCoreConcepts(targetContent);
                if (!targetConcepts) continue;

                // 두 문서 간의 관계 분석
                const analysisResult = await this.analyzeDocumentRelation(
                    sourceFile.basename, 
                    sourceConcepts,
                    targetFile.basename, 
                    targetConcepts
                );

                if (analysisResult && 
                    analysisResult.similarityScore >= this.settings.knowledgeGraphSettings.minSimilarityScore) {
                    relations.push({
                        sourceFile: sourceFile,
                        targetFile: targetFile,
                        similarityScore: analysisResult.similarityScore,
                        extractedContext: analysisResult.context
                    });
                }
            } catch (error) {
                console.error(`파일 ${targetFile.path} 비교 중 오류 발생:`, error);
            }
        }

        // 유사도 점수에 따라 정렬
        relations.sort((a, b) => b.similarityScore - a.similarityScore);
        
        // 최대 링크 수 제한
        return relations.slice(0, this.settings.knowledgeGraphSettings.maxLinksPerDocument);
    }

    // 문서에서 핵심 개념 추출
    async extractCoreConcepts(content: string): Promise<string | null> {
        let prompt = this.settings.promptTemplates.extractCoreConcepts;
        
        // 변수 교체
        prompt = prompt.replace('{{content}}', content.substring(0, 2000) + (content.length > 2000 ? '...(이하 생략)' : ''));
        
        const response = await this.generateContent(prompt);
        if (!response.text) return null;

        try {
            // JSON 형식 파싱
            const jsonMatch = response.text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const conceptsData = JSON.parse(jsonMatch[0]);
                return conceptsData.concepts.join(', ');
            }
            return response.text;
        } catch (error) {
            console.error('핵심 개념 추출 결과 파싱 오류:', error);
            return response.text; // 파싱 실패 시 원본 텍스트 반환
        }
    }

    // 두 문서 간의 관계 분석
    async analyzeDocumentRelation(
        sourceTitle: string, 
        sourceConcepts: string,
        targetTitle: string, 
        targetConcepts: string
    ): Promise<{ similarityScore: number, context: string } | null> {
        let prompt = this.settings.promptTemplates.analyzeDocumentRelation;
        
        // 변수 교체
        prompt = prompt.replace('{{sourceTitle}}', sourceTitle);
        prompt = prompt.replace('{{sourceConcepts}}', sourceConcepts);
        prompt = prompt.replace('{{targetTitle}}', targetTitle);
        prompt = prompt.replace('{{targetConcepts}}', targetConcepts);

        const response = await this.generateContent(prompt);
        if (!response.text) return null;

        try {
            // JSON 형식 파싱
            const jsonMatch = response.text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }
            return null;
        } catch (error) {
            console.error('문서 관계 분석 결과 파싱 오류:', error);
            return null;
        }
    }

    // 위키링크 추가
    async addWikiLinksToDocuments(relations: DocumentRelation[]): Promise<void> {
        const processedFiles = new Set<string>();
        
        for (const relation of relations) {
            try {
                // 이미 처리한 파일은 건너뛰기
                if (processedFiles.has(relation.sourceFile.path)) continue;
                
                // 현재 문서 내용 읽기
                const content = await this.app.vault.read(relation.sourceFile);
                
                // 관련 문서들 그룹화
                const relatedFiles = relations
                    .filter(r => r.sourceFile.path === relation.sourceFile.path)
                    .sort((a, b) => b.similarityScore - a.similarityScore)
                    .slice(0, this.settings.knowledgeGraphSettings.maxLinksPerDocument);
                
                if (relatedFiles.length === 0) continue;
                
                // 관련 문서 목록 생성
                let relatedLinksSection = '\n\n## 관련 문서\n';
                for (const rel of relatedFiles) {
                    const linkText = `- [[${rel.targetFile.basename}]] - ${rel.extractedContext}\n`;
                    relatedLinksSection += linkText;
                }
                
                // 이미 '관련 문서' 섹션이 있는지 확인
                if (content.includes('## 관련 문서')) {
                    // 기존 관련 문서 섹션 업데이트는 복잡할 수 있으므로 건너뛰기
                    continue;
                }
                
                // 새 내용 작성
                const newContent = content + relatedLinksSection;
                
                // 파일 업데이트
                await this.app.vault.modify(relation.sourceFile, newContent);
                processedFiles.add(relation.sourceFile.path);
            } catch (error) {
                console.error(`파일 ${relation.sourceFile.path}에 링크 추가 중 오류 발생:`, error);
            }
        }
        
        new Notice(`${processedFiles.size}개 문서에 관련 링크가 추가되었습니다.`);
    }

    // 새 파일 생성을 위한 헬퍼 메서드 추가
    private async createNewFileWithTitle(content: string, finalFileName: string): Promise<void> {
        // 기본 새 파일 위치 설정에서 가져오기
        let newFilePath = '';
        if(this.settings.defaultNewFileLocation === 'root') {
            newFilePath = `${finalFileName}.md`; // 기본값: 볼트 루트, .md 확장자 추가
        }
        else if (this.settings.defaultNewFileLocation === 'current') {
            // 현재 활성화된 파일의 경로 가져오기 시도
            const activeFile = this.app.workspace.getActiveFile();
            if (activeFile && activeFile.parent) {
                const activeDir = activeFile.parent.path; // 활성화된 파일의 디렉토리 경로 가져오기
                newFilePath = `${activeDir}/${finalFileName}.md`; // 활성화된 노트의 폴더 사용
            } else {
                // activeFile이 루트 폴더에 있거나 존재하지 않음
                newFilePath = `${finalFileName}.md`;
                new Notice("새 노트가 루트 폴더에 생성됩니다.");
            }
        }
        else if (this.settings.defaultNewFileLocation) { // 특정 폴더가 설정된 경우
            newFilePath = `${this.settings.defaultNewFileLocation}/${finalFileName}.md`;
        } else {
            // 설정이 제대로 되지 않은 경우 기본값으로 루트 사용
            newFilePath = `${finalFileName}.md`;
            console.warn("잘못된 newFileLocation 설정, 루트 폴더 사용");
        }

        console.log("새 파일 경로:", newFilePath);

        try {
            // 새 파일 생성
            const newFile = await this.app.vault.create(newFilePath, content);
            new Notice(`새 노트 생성됨: ${finalFileName}`);

            // 새 파일을 새 창에서 열기
            await this.app.workspace.getLeaf(true).openFile(newFile);
        } catch (error) {
            console.error('새 파일 생성 오류:', error);
            new Notice(`파일 생성 오류: ${error.message}`);
        }
    }
}

class RelatedDocumentsModal extends Modal {
    relatedDocs: DocumentRelation[];
    plugin: GeminiCopilotPlugin;

    constructor(app: App, relatedDocs: DocumentRelation[], plugin: GeminiCopilotPlugin) {
        super(app);
        this.relatedDocs = relatedDocs;
        this.plugin = plugin;
    }

    onOpen() {
        const { contentEl } = this;

        contentEl.createEl('h3', { text: '관련 문서' });
        contentEl.createEl('p', { text: '현재 문서와 관련성이 높은 다른 문서입니다.' });

        if (this.relatedDocs.length === 0) {
            contentEl.createEl('p', { text: '관련 문서를 찾지 못했습니다.', attr: { style: 'color: var(--text-muted);' } });
        } else {
            const relatedList = contentEl.createEl('ul', { cls: 'related-document-list' });

            this.relatedDocs.forEach(relation => {
                const listItem = relatedList.createEl('li', { cls: 'related-document-item' });
                listItem.style.margin = '8px 0';
                listItem.style.padding = '8px';
                listItem.style.borderRadius = '5px';
                listItem.style.backgroundColor = 'var(--background-secondary)';

                const titleEl = listItem.createEl('h4', { 
                    text: relation.targetFile.basename,
                    attr: { style: 'margin: 0 0 4px; cursor: pointer; color: var(--text-accent);' }
                });
                
                // 문서 클릭 시 해당 문서 열기
                titleEl.addEventListener('click', async () => {
                    await this.app.workspace.getLeaf().openFile(relation.targetFile);
                    this.close();
                });

                // 유사도 점수 표시
                const scoreEl = listItem.createEl('div', { 
                    text: `유사도: ${(relation.similarityScore * 100).toFixed(1)}%`,
                    attr: { style: 'font-size: 0.8em; color: var(--text-muted);' }
                });

                // 관계 컨텍스트 표시
                const contextEl = listItem.createEl('div', { text: relation.extractedContext });

                // 위키링크 추가 버튼
                const addLinkButton = listItem.createEl('button', { 
                    text: '위키링크 추가',
                    attr: {
                        style: 'font-size: 0.8em; margin-top: 8px;'
                    }
                });
                addLinkButton.addEventListener('click', async () => {
                    await this.addWikiLink(relation);
                });
            });
        }

        const buttonContainer = contentEl.createEl('div', { cls: 'modal-button-container' });
        buttonContainer.style.marginTop = '16px';
        const closeButton = buttonContainer.createEl('button', { text: '닫기' });
        closeButton.addEventListener('click', () => this.close());
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }

    async addWikiLink(relation: DocumentRelation) {
        try {
            // 현재 활성화된 파일 가져오기
            const currentFile = this.app.workspace.getActiveFile();
            if (!currentFile) {
                new Notice('현재 열려있는 파일이 없습니다.');
                return;
            }

            // 현재 문서 내용 읽기
            const content = await this.app.vault.read(currentFile);
            
            // 관련 문서 링크 생성
            const wikiLink = `[[${relation.targetFile.basename}]]`;
            const linkWithContext = `- ${wikiLink} - ${relation.extractedContext}`;
            
            // 이미 '관련 문서' 섹션이 있는지 확인
            if (content.includes('## 관련 문서')) {
                // 정규 표현식을 사용하여 '관련 문서' 섹션 찾기
                const sectionRegex = /## 관련 문서\n([\s\S]*?)(?=\n##|$)/;
                const match = content.match(sectionRegex);
                
                if (match) {
                    // 이미 같은 링크가 있는지 확인
                    if (match[1].includes(wikiLink)) {
                        new Notice('이미 이 문서에 대한 링크가 존재합니다.');
                        return;
                    }
                    
                    // 섹션에 링크 추가
                    const updatedSection = match[0] + '\n' + linkWithContext;
                    const newContent = content.replace(sectionRegex, updatedSection);
                    
                    await this.app.vault.modify(currentFile, newContent);
                    new Notice(`${relation.targetFile.basename}에 대한 링크가 추가되었습니다.`);
                }
            } else {
                // 관련 문서 섹션 추가
                const newContent = content + '\n\n## 관련 문서\n' + linkWithContext;
                await this.app.vault.modify(currentFile, newContent);
                new Notice(`${relation.targetFile.basename}에 대한 링크가 추가되었습니다.`);
            }
        } catch (error) {
            console.error('위키링크 추가 중 오류 발생:', error);
            new Notice('위키링크 추가 중 오류가 발생했습니다.');
        }
    }
}

class KnowledgeGraphSummaryModal extends Modal {
    relations: DocumentRelation[];

    constructor(app: App, relations: DocumentRelation[]) {
        super(app);
        this.relations = relations;
    }

    onOpen() {
        const { contentEl } = this;

        contentEl.createEl('h3', { text: '지식 그래프 분석 결과' });

        // 생성된 연결 수 표시
        contentEl.createEl('p', { text: `총 ${this.relations.length}개의 문서 간 연결이 발견되었습니다.` });

        // 연결이 많은 상위 문서 찾기
        const documentConnectionCounts = new Map<string, number>();
        this.relations.forEach(relation => {
            const sourcePath = relation.sourceFile.path;
            documentConnectionCounts.set(
                sourcePath, 
                (documentConnectionCounts.get(sourcePath) || 0) + 1
            );
        });

        // 연결 수에 따라 정렬
        const sortedDocuments = [...documentConnectionCounts.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10); // 상위 10개만 표시

        if (sortedDocuments.length > 0) {
            contentEl.createEl('h4', { text: '가장 많은 연결을 가진 문서' });
            const topDocsList = contentEl.createEl('ul');
            
            sortedDocuments.forEach(([path, count]) => {
                const filename = path.split('/').pop() || path;
                topDocsList.createEl('li', { 
                    text: `${filename} - ${count}개 연결` 
                });
            });
        }

        // 평균 유사도 점수 계산
        const averageSimilarity = this.relations.reduce(
            (sum, relation) => sum + relation.similarityScore, 0
        ) / this.relations.length;

        contentEl.createEl('p', { 
            text: `평균 유사도 점수: ${(averageSimilarity * 100).toFixed(1)}%` 
        });

        // 링크가 추가된 문서 수 (autoAddLinks가 활성화된 경우)
        if (this.app.plugins.plugins['obsidian-gemini-copilot'].settings.knowledgeGraphSettings.autoAddLinks) {
            const uniqueSourceFiles = new Set(this.relations.map(r => r.sourceFile.path)).size;
            contentEl.createEl('p', { 
                text: `${uniqueSourceFiles}개 문서에 자동으로 관련 링크가 추가되었습니다.` 
            });
        }

        // 모든 관계 데이터 표시 (접기/펼치기 가능)
        const detailsEl = contentEl.createEl('details');
        detailsEl.createEl('summary', { text: '모든 관계 데이터 보기' });
        
        const relationsTable = detailsEl.createEl('table');
        relationsTable.style.width = '100%';
        relationsTable.style.borderCollapse = 'collapse';
        
        // 테이블 헤더
        const headerRow = relationsTable.createEl('tr');
        headerRow.createEl('th', { text: '소스 문서' }).style.textAlign = 'left';
        headerRow.createEl('th', { text: '타겟 문서' }).style.textAlign = 'left';
        headerRow.createEl('th', { text: '유사도' }).style.textAlign = 'right';
        
        // 테이블 내용
        this.relations.slice(0, 50).forEach(relation => {
            const row = relationsTable.createEl('tr');
            row.createEl('td', { text: relation.sourceFile.basename });
            row.createEl('td', { text: relation.targetFile.basename });
            row.createEl('td', { text: `${(relation.similarityScore * 100).toFixed(1)}%` }).style.textAlign = 'right';
        });
        
        if (this.relations.length > 50) {
            const moreRow = relationsTable.createEl('tr');
            moreRow.createEl('td', { 
                text: `외 ${this.relations.length - 50}개 더...`,
                attr: { colspan: '3', style: 'text-align: center; font-style: italic;' }
            });
        }

        const buttonContainer = contentEl.createEl('div', { cls: 'modal-button-container' });
        buttonContainer.style.marginTop = '16px';
        const closeButton = buttonContainer.createEl('button', { text: '닫기' });
        closeButton.addEventListener('click', () => this.close());
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
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

class CustomPromptSelectorModal extends Modal {
    prompts: CustomPrompt[];
    onSelect: (selectedPrompt: CustomPrompt | null) => Promise<void>;

    constructor(app: App, prompts: CustomPrompt[], onSelect: (selectedPrompt: CustomPrompt | null) => Promise<void>) {
        super(app);
        this.prompts = prompts;
        this.onSelect = onSelect;
    }

    onOpen() {
        const { contentEl } = this;

        contentEl.createEl('h3', { text: 'Select a Custom Prompt' });

        const promptList = contentEl.createEl('ul', { cls: 'custom-prompt-list' });

        this.prompts.forEach(prompt => {
            const listItem = promptList.createEl('li', { cls: 'custom-prompt-item' });
            listItem.createEl('h4', { text: prompt.name });
            listItem.createEl('p', { text: prompt.description });

            listItem.addEventListener('click', async () => {
                await this.onSelect(prompt);
                this.close();
            });
        });

        const cancelButton = contentEl.createEl('button', { text: 'Cancel', cls: 'mod-warning' });
        cancelButton.addEventListener('click', () => {
            this.onSelect(null);
            this.close();
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

class CustomPromptModal extends Modal {
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
            .addTextArea(text => text
                .setValue(this.prompt.prompt)
                .onChange(value => this.prompt.prompt = value));

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
            attr: { style: 'margin-bottom: 10px;' } 
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

    // 프롬프트 템플릿 설정 항목을 추가하는 헬퍼 메서드
    private addPromptTemplateSetting(
        containerEl: HTMLElement, 
        name: string, 
        desc: string, 
        settingPath: string
    ): void {
        // 점으로 구분된 경로로부터 실제 설정 값을 가져오는 함수
        const getNestedSettingValue = (obj: any, path: string): string => {
            const parts = path.split('.');
            let current = obj;
            for (const part of parts) {
                if (current[part] === undefined) return '';
                current = current[part];
            }
            return current as string;
        };

        // 점으로 구분된 경로에 설정 값을 저장하는 함수
        const setNestedSettingValue = (obj: any, path: string, value: string): void => {
            const parts = path.split('.');
            let current = obj;
            for (let i = 0; i < parts.length - 1; i++) {
                const part = parts[i];
                if (current[part] === undefined) current[part] = {};
                current = current[part];
            }
            current[parts[parts.length - 1]] = value;
        };

        const setting = new Setting(containerEl)
            .setName(name)
            .setDesc(desc)
            .addTextArea(textarea => textarea
                .setValue(getNestedSettingValue(this.plugin.settings, settingPath))
                .onChange(async (value) => {
                    setNestedSettingValue(this.plugin.settings, settingPath, value);
                    await this.plugin.saveSettings();
                })
            );

        // 텍스트 영역 스타일 조정 - 타입 문제 해결
        const textareaComponent = setting.components[0] as any;
        if (textareaComponent && textareaComponent.inputEl) {
            const textareaEl = textareaComponent.inputEl;
            textareaEl.style.width = '100%';
            textareaEl.style.height = '120px';
            textareaEl.style.fontFamily = 'monospace';
            textareaEl.style.fontSize = '12px';
        }

        // 기본값으로 초기화 버튼 추가
        setting.addButton(button => button
            .setButtonText('기본값으로 초기화')
            .onClick(async () => {
                const defaultValue = getNestedSettingValue(DEFAULT_SETTINGS, settingPath);
                setNestedSettingValue(this.plugin.settings, settingPath, defaultValue);
                await this.plugin.saveSettings();
                this.display(); // 설정 화면 새로고침
                new Notice(`${name} 프롬프트가 기본값으로 초기화되었습니다.`);
            })
        );
    }
}