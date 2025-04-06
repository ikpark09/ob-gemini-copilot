import { App, Editor, MarkdownView, Modal, Notice, Plugin, Setting, TFile, Menu } from 'obsidian';
import { GoogleGenerativeAI } from "@google/generative-ai";
import { RelatedDocumentsModal, KnowledgeGraphSummaryModal, GeminiConfirmationModal, CustomPromptSelectorModal } from './modals';
import { GeminiCopilotSettingTab } from './settings-tab';

export interface GeminiCopilotSettings {
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

export interface GeminiLogEntry {
    timestamp: string;
    model: string;
    inputPrompt: string;
    outputResponse: string | null;
    inputTokens?: number;
    outputTokens?: number;
    error?: string;
}

export interface CustomPrompt {
    name: string;
    prompt: string;
    description: string;
}

// 문서 관계 인터페이스 정의
export interface DocumentRelation {
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
                [id: string]: unknown;
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

export const DEFAULT_SETTINGS: GeminiCopilotSettings = {
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
        generateTitle: 'Generate a concise and informative title for the following note content:{{currentTitle}}\\n\\n{{content}}\\n\\nOutput format: YYYY-MM-DD: title. Ensure the title part is suitable for filename (no special chars).',
        summarizeText: 'Please summarize the following text concisely:\\n\\n{{content}}\\n\\nSummary:',
        expandText: 'Please expand upon the following text, adding more detail and information:\\n\\n{{content}}\\n\\nExpanded Text:',
        generateHashtags: '한글로 다음 문서의 핵심을 나타내는 키워드를 10개 정도 추출하여 설명, 부호, 순서 없이 \\'#\\'로 시작하는 키워드로 출력하세요.\\n문서: \\n{{content}}\\n\\n해시태그: #',
        extractCoreConcepts: '다음 문서에서 핵심 개념, 주제, 키워드를 5-10개 정도 추출해 주세요. JSON 형식으로 반환하되, 키워드는 단어나 짧은 구문으로 제한해주세요.\\n\\n문서:\\n{{content}}\\n\\n출력 형식:\\n{\\n    \"concepts\": [\"개념1\", \"개념2\", \"개념3\", ...]\\n}',
        analyzeDocumentRelation: '두 문서 간의 관계를 분석하고 유사도 점수(0.0 ~ 1.0 사이)를 매겨주세요.\\n\\n문서 1: \"{{sourceTitle}}\"\\n핵심 개념: {{sourceConcepts}}\\n\\n문서 2: \"{{targetTitle}}\"\\n핵심 개념: {{targetConcepts}}\\n\\n다음 형식으로 JSON으로 응답해주세요:\\n{\\n    \"similarityScore\": 0.0부터 1.0 사이의 숫자,\\n    \"context\": \"두 문서가 어떻게 관련되어 있는지에 대한 간략한 설명(1-2문장)\"\\n}'
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
                                            new Notice(`파일 이름 변경 오류: ${error instanceof Error ? error.message : String(error)}`);
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
            
            // 메뉴의 나머지 항목 추가 (생략)...
            
            // 메뉴 표시
            menu.showAtMouseEvent(evt);
        });

        // 명령어 추가
        this.addCommands();

        this.addSettingTab(new GeminiCopilotSettingTab(this.app, this));
    }

    // 명령어 추가 메서드
    private addCommands() {
        // 제목 생성 명령어
        this.addCommand({
            id: 'gemini-generate-note-title',
            name: 'Generate Note Title with Gemini',
            editorCallback: async (editor: Editor, view: MarkdownView) => {
                // 내용 생략..
            }
        });

        // 텍스트 요약 명령어
        this.addCommand({
            id: 'gemini-summarize-text',
            name: 'Summarize Selected Text with Gemini',
            editorCallback: async (editor: Editor, view: MarkdownView) => {
                // 내용 생략..
            }
        });

        // 기타 명령어들...
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

        } catch (error) {
            console.error('Gemini API Error:', error);
            logEntry.error = error instanceof Error ? error.message : String(error);
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
        const invalidCharsRegex = /[*"\\\/<>:|?]/g;
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
            new Notice(`파일 생성 오류: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}
