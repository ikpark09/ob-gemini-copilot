import { App, Modal, Notice, TFile, Setting } from 'obsidian';
import { CustomPrompt, DocumentRelation, GeminiCopilotPlugin } from './main';

// 관련 문서 모달
export class RelatedDocumentsModal extends Modal {
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
            contentEl.createEl('p', { text: '관련 문서를 찾지 못했습니다.', cls: 'gemini-log-timestamp' });
        } else {
            const relatedList = contentEl.createEl('ul', { cls: 'related-document-list' });

            this.relatedDocs.forEach(relation => {
                const listItem = relatedList.createEl('li', { cls: 'related-document-item' });

                const titleEl = listItem.createEl('h4', { 
                    text: relation.targetFile.basename,
                    cls: 'related-document-title'
                });
                
                // 문서 클릭 시 해당 문서 열기
                titleEl.addEventListener('click', async () => {
                    await this.app.workspace.getLeaf().openFile(relation.targetFile);
                    this.close();
                });

                // 유사도 점수 표시
                listItem.createEl('div', { 
                    text: `유사도: ${(relation.similarityScore * 100).toFixed(1)}%`,
                    cls: 'related-document-score'
                });

                // 관계 컨텍스트 표시
                listItem.createEl('div', { text: relation.extractedContext });

                // 위키링크 추가 버튼
                const addLinkButton = listItem.createEl('button', { 
                    text: '위키링크 추가',
                    cls: 'related-document-add-link'
                });
                addLinkButton.addEventListener('click', async () => {
                    await this.addWikiLink(relation);
                });
            });
        }

        const buttonContainer = contentEl.createEl('div', { cls: 'modal-button-container' });
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

// 지식 그래프 요약 모달
export class KnowledgeGraphSummaryModal extends Modal {
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
        const pluginSettings = this.app.plugins.plugins['obsidian-gemini-copilot'] as GeminiCopilotPlugin;
        if (pluginSettings.settings.knowledgeGraphSettings.autoAddLinks) {
            const uniqueSourceFiles = new Set(this.relations.map(r => r.sourceFile.path)).size;
            contentEl.createEl('p', { 
                text: `${uniqueSourceFiles}개 문서에 자동으로 관련 링크가 추가되었습니다.` 
            });
        }

        // 모든 관계 데이터 표시 (접기/펼치기 가능)
        const detailsEl = contentEl.createEl('details');
        detailsEl.createEl('summary', { text: '모든 관계 데이터 보기' });
        
        const relationsTable = detailsEl.createEl('table', { cls: 'knowledge-graph-table' });
        
        // 테이블 헤더
        const headerRow = relationsTable.createEl('tr');
        headerRow.createEl('th', { text: '소스 문서' });
        headerRow.createEl('th', { text: '타겟 문서' });
        headerRow.createEl('th', { text: '유사도', cls: 'text-right' });
        
        // 테이블 내용
        this.relations.slice(0, 50).forEach(relation => {
            const row = relationsTable.createEl('tr');
            row.createEl('td', { text: relation.sourceFile.basename });
            row.createEl('td', { text: relation.targetFile.basename });
            row.createEl('td', { text: `${(relation.similarityScore * 100).toFixed(1)}%`, cls: 'text-right' });
        });
        
        if (this.relations.length > 50) {
            const moreRow = relationsTable.createEl('tr');
            moreRow.createEl('td', { 
                text: `외 ${this.relations.length - 50}개 더...`,
                attr: { colspan: '3' },
                cls: 'knowledge-graph-more-row'
            });
        }

        const buttonContainer = contentEl.createEl('div', { cls: 'modal-button-container' });
        const closeButton = buttonContainer.createEl('button', { text: '닫기' });
        closeButton.addEventListener('click', () => this.close());
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

// Gemini 확인 모달
export class GeminiConfirmationModal extends Modal {
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
    }
}

// 커스텀 프롬프트 선택 모달
export class CustomPromptSelectorModal extends Modal {
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

// 커스텀 프롬프트 모달
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
                text.inputEl.addClass('prompt-template-textarea');
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
