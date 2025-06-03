import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, TFolder, ItemView, WorkspaceLeaf, Menu } from 'obsidian';

interface MyPluginSettings {
	activeKanbanFolders: string[];
	showRibbonIcon: boolean;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
	activeKanbanFolders: [],
	showRibbonIcon: true
}

const KANBAN_VIEW_TYPE = "kanban-view";

export class KanbanView extends ItemView {
	plugin: MyPlugin;
	folderPath: string;
	searchInputEl: HTMLInputElement | null = null;
	isComposing: boolean = false;
	fileWatcher: (() => void) | null = null; // 添加文件监听器引用

	constructor(leaf: WorkspaceLeaf, plugin: MyPlugin, folderPath: string) {
		super(leaf);
		this.plugin = plugin;
		this.folderPath = folderPath;
	}

	getViewType() {
		return KANBAN_VIEW_TYPE + "-" + this.folderPath;
	}

	getDisplayText() {
		const pathParts = this.folderPath.split('/');
		return `Kanban: ${pathParts[pathParts.length - 1]}`;
	}

	// 在onOpen方法中修复硬编码文本
	async onOpen() {
		const container = this.containerEl.children[1];
		container.empty();
		const kanbanContainer = container.createEl("div", { cls: "kanban-container" });
		
		const actionsContainer = kanbanContainer.createEl("div", { cls: "kanban-actions" });
	
		// 新增文件按钮 - 使用翻译函数
		const newFileButton = actionsContainer.createEl("button", { text: t('NewPrompt') });
		newFileButton.onclick = () => this.createNewFile();
	
		// 搜索输入框 - 使用翻译函数
		this.searchInputEl = actionsContainer.createEl("input", { 
			type: "text", 
			placeholder: t('search'),
			cls: "kanban-search-input" 
		});

		this.searchInputEl.addEventListener("compositionstart", () => this.isComposing = true);
		this.searchInputEl.addEventListener("compositionend", () => {
			this.isComposing = false;
			this.renderKanbanList();
		});
		this.searchInputEl.addEventListener("input", () => {
			if (!this.isComposing) this.renderKanbanList();
		});
	
		// 移除刷新按钮，因为现在有自动刷新功能
		// const refreshButton = actionsContainer.createEl("button", { text: "刷新" });
		// refreshButton.onclick = () => this.renderKanbanList();
	
		kanbanContainer.createEl("ul", { cls: "kanban-list" });
		this.renderKanbanList();
		
		// 设置文件监听器
		this.setupFileWatcher();
	}

	// 设置文件监听器
	private setupFileWatcher() {
		// 监听文件创建、删除、重命名和修改事件
		const onFileChange = () => {
			// 使用防抖，避免频繁刷新
			this.debounceRefresh();
		};

		// 注册各种文件事件监听器
		this.plugin.app.vault.on('create', onFileChange);
		this.plugin.app.vault.on('delete', onFileChange);
		this.plugin.app.vault.on('rename', onFileChange);
		this.plugin.app.vault.on('modify', onFileChange);

		// 保存清理函数
		this.fileWatcher = () => {
			this.plugin.app.vault.off('create', onFileChange);
			this.plugin.app.vault.off('delete', onFileChange);
			this.plugin.app.vault.off('rename', onFileChange);
			this.plugin.app.vault.off('modify', onFileChange);
		};
	}

	// 防抖刷新函数
	private debounceTimer: NodeJS.Timeout | null = null;
	private debounceRefresh() {
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
		}
		
		this.debounceTimer = setTimeout(() => {
			// 检查文件变化是否与当前文件夹相关
			this.renderKanbanList();
		}, 300); // 300ms 防抖延迟
	}

	// 检查文件是否在当前监控的文件夹内
	private isFileInCurrentFolder(filePath: string): boolean {
		return filePath.startsWith(this.folderPath + '/') || filePath === this.folderPath;
	}

	// 优化的文件监听器，只监听相关文件夹的变化
	private setupOptimizedFileWatcher() {
		const onFileChange = (file: any) => {
			// 只有当文件在当前文件夹内时才刷新
			if (file && file.path && this.isFileInCurrentFolder(file.path)) {
				this.debounceRefresh();
			}
		};

		// 注册事件监听器
		this.plugin.app.vault.on('create', onFileChange);
		this.plugin.app.vault.on('delete', onFileChange);
		this.plugin.app.vault.on('rename', onFileChange);
		this.plugin.app.vault.on('modify', onFileChange);

		// 保存清理函数
		this.fileWatcher = () => {
			this.plugin.app.vault.off('create', onFileChange);
			this.plugin.app.vault.off('delete', onFileChange);
			this.plugin.app.vault.off('rename', onFileChange);
			this.plugin.app.vault.off('modify', onFileChange);
		};
	}

	private async createNewFile() {
		const folder = this.app.vault.getAbstractFileByPath(this.folderPath);
		if (!(folder instanceof TFolder)) {
			new Notice(t('invalidFolderPath'));
			return;
		}
		const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
		const newFileName = `Prompt-${timestamp}.md`;
		const newFilePath = `${this.folderPath}/${newFileName}`;
		try {
			const newFile = await this.app.vault.create(newFilePath, "### V 1.0\n\n```\n\nPrompt here...\n\n```");
			this.app.workspace.getLeaf(true).openFile(newFile);
			this.renderKanbanList();
			new Notice(t('fileCreated', newFileName));
		} catch (error) {
			console.error("Error creating new file:", error);
			new Notice(t('createFileFailed'));
		}
	}

	private cleanCodeBlockMarkers(content: string): string {
		return content.replace(/```[\s\S]*?\n/g, '').replace(/\n```/g, '').trim();
	}

	async renderKanbanList() {
		const listEl = this.containerEl.querySelector(".kanban-list");
		if (!listEl) return;
		listEl.empty();
	
		const folder = this.app.vault.getAbstractFileByPath(this.folderPath);
		if (!(folder instanceof TFolder)) {
			this.showEmptyState(listEl, t('folderInvalidOrNotExists', this.folderPath));
			return;
		}
	
		let files = folder.children.filter(file => file instanceof TFile && file.extension === "md") as TFile[];
		files.sort((a, b) => b.stat.mtime - a.stat.mtime);

		const searchTerm = this.searchInputEl?.value.toLowerCase() || "";
		const filteredFiles = files.filter(file => 
			file.basename.toLowerCase().includes(searchTerm) || 
			file.name.toLowerCase().includes(searchTerm)
		);
	
		if (filteredFiles.length === 0) {
			this.showEmptyState(listEl, searchTerm ? 
				t('noMatchingFiles', this.searchInputEl?.value || '') : 
				t('noMarkdownFiles')
			);
			return;
		}
	
		for (const file of filteredFiles) {
			await this.createKanbanItem(listEl, file);
		}
	}

	private showEmptyState(listEl: Element, message: string) {
		const emptyStateEl = listEl.createEl("li", { cls: "kanban-empty-state" });
		emptyStateEl.createEl("h3", { text: t('empty') });
		emptyStateEl.createEl("p", { text: message });
	}

	private async createKanbanItem(listEl: Element, file: TFile) {
		const listItem = listEl.createEl("li", { cls: "kanban-list-item" });
		
		const fileContent = await this.app.vault.read(file);
		const { version, contentSummary, versionSpecificContent, lastH3LineNumber } = this.extractFileInfo(fileContent);

		// 点击事件
		listItem.onclick = (event) => {
			if ((event.target as HTMLElement).closest('button')) return;
			this.openFileAtVersion(file, lastH3LineNumber);
		};

		// 右键删除菜单
		listItem.oncontextmenu = (event) => {
			event.preventDefault();
			this.showDeleteMenu(event, file);
		};

		// 创建项目内容
		const itemHeader = listItem.createEl("div", { cls: "kanban-item-header" });
		itemHeader.createEl("strong", { text: file.basename, cls: "kanban-item-title" });
		
		const itemActions = itemHeader.createEl("div", { cls: "kanban-item-actions" });
		this.createActionButtons(itemActions, file, versionSpecificContent);

		const itemBody = listItem.createEl("div", { cls: "kanban-item-body" });
		if (version !== "N/A") {
			itemBody.createEl("span", { text: version, cls: "kanban-item-version" });
		}
		itemBody.createEl("p", { text: contentSummary, cls: "kanban-item-summary" });
	}

	private extractFileInfo(fileContent: string) {
		const lines = fileContent.split('\n');
		let version = "N/A";
		let contentSummary = "";
		let versionSpecificContent = "";
		let lastH3LineNumber = -1;
		let foundVersion = false; // 添加标记来区分是否找到了版本标题
	
		// 从后往前查找最后一个版本标题
		for (let i = lines.length - 1; i >= 0; i--) {
			const versionMatch = lines[i].match(/^###\s*(?:V|Version|版本|Ver)?\s*(\d+)(?:\.(\d+))?/i);
			if (versionMatch) {
				version = lines[i].substring(4).trim();
				lastH3LineNumber = i;
				foundVersion = true; // 标记找到了版本
				
				// 提取该版本的内容
				const summaryLines = [];
				for (let j = i + 1; j < lines.length; j++) {
					if (lines[j].match(/^###\s*(?:V|Version|版本|Ver)?\s*(\d+)(?:\.(\d+))?/i)) break;
					summaryLines.push(lines[j]);
				}
				versionSpecificContent = summaryLines.join("\n").trim();
				
				// 只有当版本内容不为空时才生成摘要
				if (versionSpecificContent) {
					const cleanedContent = this.cleanCodeBlockMarkers(versionSpecificContent);
					contentSummary = cleanedContent.substring(0, 25) + (cleanedContent.length > 25 ? "..." : "");
				} else {
					// 版本标题存在但内容为空，显示空摘要
					contentSummary = "";
				}
				break;
			}
		}
		
		// 只有在没有找到任何版本标题时，才使用整个文件内容
		if (!foundVersion && fileContent) {
			const cleanedContent = this.cleanCodeBlockMarkers(fileContent);
			contentSummary = cleanedContent.substring(0, 150) + (cleanedContent.length > 150 ? "..." : "");
			versionSpecificContent = fileContent;
		}

		return { version, contentSummary, versionSpecificContent, lastH3LineNumber };
	}

	private async openFileAtVersion(file: TFile, lastH3LineNumber: number) {
		const leaf = this.app.workspace.getLeaf(false);
		await leaf.openFile(file);
		if (leaf.view instanceof MarkdownView && lastH3LineNumber !== -1) {
			setTimeout(() => {
				const editor = (leaf.view as MarkdownView).editor;
				editor.setCursor({ line: lastH3LineNumber, ch: 0 });
				editor.scrollIntoView({from: {line: lastH3LineNumber, ch: 0}, to: {line: lastH3LineNumber, ch: 0}}, true);
			}, 200);
		}
	}

	private showDeleteMenu(event: MouseEvent, file: TFile) {
		const menu = new Menu();
		menu.addItem((item) =>
			item.setTitle(t('delete'))
				.setIcon("trash")
				.onClick(() => {
					new ConfirmModal(this.app, 
						t('confirmDeleteFile', file.name),
						t('deleteWarning'),
						async () => {
							try {
								await this.app.vault.delete(file);
								new Notice(t('fileDeleted', file.name));
								this.renderKanbanList();
							} catch (error) {
								console.error("Error deleting file:", error);
								new Notice(t('deleteFileFailed'));
							}
						}
					).open();
				})
		);
		menu.showAtMouseEvent(event);
	}

	private createActionButtons(itemActions: HTMLElement, file: TFile, versionSpecificContent: string) {
		// 迭代按钮
		const iterateButton = itemActions.createEl("button", { text: t('iterate') });
		iterateButton.onclick = (event) => {
			event.stopPropagation();
			this.iterateFile(file);
		};

		// 复制按钮
		const copyButton = itemActions.createEl("button", { text: t('copy') });
		copyButton.onclick = (event) => {
			event.stopPropagation();
			navigator.clipboard.writeText(versionSpecificContent);
			new Notice(t('contentCopied'));
		};
	}

	private async iterateFile(file: TFile) {
		const currentContent = await this.app.vault.read(file);
		const currentLines = currentContent.split('\n');
		let lastVersion = "V0.9";
		let contentToCopy = "";

		// 查找最后一个版本并提取内容
		for (let i = currentLines.length - 1; i >= 0; i--) {
			const match = currentLines[i].match(/^###\s*(?:V|Version|版本|Ver)?\s*(\d+)(?:\.(\d+))?/i);
			if (match) {
				const major = match[1];
				const minor = match[2] || '0';
				lastVersion = `V${major}.${minor}`;
				
				// 提取版本内容
				const summaryLines = [];
				for (let j = i + 1; j < currentLines.length; j++) {
					if (currentLines[j].match(/^###\s*(?:V|Version|版本|Ver)?\s*(\d+)(?:\.(\d+))?/i)) break;
					summaryLines.push(currentLines[j]);
				}
				contentToCopy = summaryLines.join("\n").trim();
				break;
			}
		}

		if (!contentToCopy && currentContent.trim()) {
			contentToCopy = currentContent.trim();
		}

		// 计算新版本号
		const versionMatch = lastVersion.match(/(?:V|Version|版本|Ver)?\s*(\d+)(?:\.(\d+))?/i);
		let major = 0, minor = 9;
		if (versionMatch) {
			major = parseInt(versionMatch[1]);
			minor = versionMatch[2] ? parseInt(versionMatch[2]) : 0;
		}
		minor++;
		const newVersionString = `V ${major}.${minor}`;
		const newVersionHeader = `\n### ${newVersionString}\n`;
		const newContent = currentContent + newVersionHeader + (contentToCopy ? contentToCopy + "\n" : "\n");

		await this.app.vault.modify(file, newContent);
		new Notice(t('newVersionCreated', newVersionString, file.basename));
		this.renderKanbanList();
	}

	// 在onClose方法中移除中文console.log
	async onClose() {
		// 清理文件监听器
		if (this.fileWatcher) {
			this.fileWatcher();
			this.fileWatcher = null;
		}
		
		// 清理防抖定时器
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}
		
		// 移除中文日志或改为英文
		console.log("Kanban view closed, folder path retained in settings for restoration on next startup");
	}
}

export class ConfirmModal extends Modal {
	titleText: string;
	messageText: string;
	onConfirm: () => Promise<void>;

	constructor(app: App, titleText: string, messageText: string, onConfirm: () => Promise<void>) {
		super(app);
		this.titleText = titleText;
		this.messageText = messageText;
		this.onConfirm = onConfirm;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: this.titleText });
		contentEl.createEl("p", { text: this.messageText });

		const buttonContainer = contentEl.createDiv({ cls: "modal-button-container" });
		const confirmButton = buttonContainer.createEl("button", { text: t('confirm'), cls: "mod-cta" });
		confirmButton.onclick = async () => {
			await this.onConfirm();
			this.close();
		};

		const cancelButton = buttonContainer.createEl("button", { text: t('cancel') });
		cancelButton.onclick = () => this.close();
	}

	onClose() {
		this.contentEl.empty();
	}
}

class KanbanSettingTab extends PluginSettingTab {
	plugin: MyPlugin;

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName(t('showRibbonIcon'))
			.setDesc(t('showRibbonIconDesc'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showRibbonIcon)
				.onChange(async (value) => {
					this.plugin.settings.showRibbonIcon = value;
					await this.plugin.saveSettings();
					this.plugin.updateRibbonIcon();
				}));
	}
}

export default class MyPlugin extends Plugin {
	settings: MyPluginSettings;
	ribbonIconEl: HTMLElement | null = null;

	async onload() {
		await this.loadSettings();

		// 预先注册所有保存的看板视图类型
		for (const folderPath of this.settings.activeKanbanFolders) {
			const viewType = KANBAN_VIEW_TYPE + "-" + folderPath;
			this.registerView(viewType, (leaf) => new KanbanView(leaf, this, folderPath));
		}

		// 注册命令
		this.addCommand({
			id: 'generate-kanban-view',
			name: t('generateKanbanCommand'),
			editorCallback: (editor: Editor, view: MarkdownView) => {
				const currentFile = view.file;
				if (currentFile?.parent) {
					this.activateView(currentFile.parent.path);
				} else {
					new Notice(t('cannotGetFolderPath'));
				}
			}
		});

		this.addSettingTab(new KanbanSettingTab(this.app, this));
		this.updateRibbonIcon();

		// 延迟恢复看板视图
		this.app.workspace.onLayoutReady(() => this.restoreKanbanViews());
	}

	updateRibbonIcon() {
		if (this.ribbonIconEl) {
			this.ribbonIconEl.remove();
			this.ribbonIconEl = null;
		}

		if (this.settings.showRibbonIcon) {
			this.ribbonIconEl = this.addRibbonIcon('kanban', t('ribbonIconTooltip'), () => {
				const activeFile = this.app.workspace.getActiveFile();
				if (activeFile?.parent) {
					const folderPath = activeFile.parent.path;
					const viewType = KANBAN_VIEW_TYPE + "-" + folderPath;
					
					// 检查是否有活跃的看板视图
					const existingLeaves = this.app.workspace.getLeavesOfType(viewType);
					const activeLeaves = existingLeaves.filter(leaf => {
						// 检查叶子节点是否真的存在且未被分离
						return leaf.parent && !leaf.getContainer()?.containerEl.hasClass('mod-empty');
					});
					
					if (activeLeaves.length > 0) {
						// 看板已打开，激活并提示
						this.app.workspace.revealLeaf(activeLeaves[0]);
						new Notice(t('kanbanActivated'));
					} else {
						// 看板未打开或已关闭，创建新的
						this.activateView(folderPath);
						new Notice(t('kanbanOpened'));
					}
				} else {
					new Notice(t('cannotGetFolderPath'));
				}
			});
		}
	}

	async restoreKanbanViews() {
		if (!this.settings.activeKanbanFolders?.length) return;
	
		const validFolders: string[] = [];
		
		for (const folderPath of this.settings.activeKanbanFolders) {
			const folder = this.app.vault.getAbstractFileByPath(folderPath);
			if (folder instanceof TFolder) {
				const viewType = KANBAN_VIEW_TYPE + "-" + folderPath;
				const existingLeaves = this.app.workspace.getLeavesOfType(viewType);
				
				// 只检查文件夹是否存在，不自动创建视图
				// 用户需要手动点击侧边栏按钮来创建看板
				validFolders.push(folderPath);
			}
		}
	
		// 清理不存在的文件夹路径
		if (validFolders.length !== this.settings.activeKanbanFolders.length) {
			this.settings.activeKanbanFolders = validFolders;
			await this.saveSettings();
		}
	}

	async activateView(folderPath: string, saveToSettings: boolean = true) {
		const viewType = KANBAN_VIEW_TYPE + "-" + folderPath;

		const existingLeaves = this.app.workspace.getLeavesOfType(viewType);
		if (existingLeaves.length > 0) {
			this.app.workspace.revealLeaf(existingLeaves[0]);
			return;
		}

		// 只有在视图类型未注册时才注册
		if (!this.app.viewRegistry.viewByType[viewType]) {
			this.registerView(viewType, (leaf) => new KanbanView(leaf, this, folderPath));
		}

		const leaf = this.app.workspace.getRightLeaf(false);
		if (leaf) {
			await leaf.setViewState({ type: viewType, active: true });
			this.app.workspace.revealLeaf(leaf);

			if (saveToSettings && !this.settings.activeKanbanFolders.includes(folderPath)) {
				this.settings.activeKanbanFolders.push(folderPath);
				await this.saveSettings();
			}
		} else {
			new Notice(t('cannotOpenKanban'));
		}
	}

	onunload() {
		for (const folderPath of this.settings.activeKanbanFolders) {
			const viewType = KANBAN_VIEW_TYPE + "-" + folderPath;
			const leaves = this.app.workspace.getLeavesOfType(viewType);
			leaves.forEach(leaf => leaf.detach());
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

// 语言配置
interface Translations {
	[key: string]: string;
}

// 在TRANSLATIONS中补充缺失的翻译
const TRANSLATIONS: { [locale: string]: Translations } = {
	'en': {
		// 按钮和操作
		'newFile': 'New File',
		'search': 'Search...',
		'refresh': 'Refresh',
		'iterate': 'Iterate',
		'copy': 'Copy',
		'delete': 'Delete',
		'confirm': 'Confirm Delete',
		'cancel': 'Cancel',
		
		// 通知消息
		'fileCreated': 'File {0} created',
		'createFileFailed': 'Failed to create file',
		'fileDeleted': 'File "{0}" deleted',
		'deleteFileFailed': 'Failed to delete file',
		'contentCopied': 'Version content copied to clipboard',
		'newVersionCreated': 'New version {0} created in file {1}',
		'kanbanActivated': 'Kanban view for current folder activated',
		'kanbanOpened': 'Kanban view opened for current folder',
		'cannotGetFolderPath': 'Cannot get current folder path. Please ensure you are in an open file.',
		'cannotOpenKanban': 'Cannot open kanban view. Please ensure there is available panel space on the right.',
		'invalidFolderPath': 'Current kanban folder path is invalid',
		
		// 界面文本
		'empty': 'Empty',
		'noMatchingFiles': 'No files matching "{0}" found.',
		'noMarkdownFiles': 'This folder has no Markdown files yet.',
		'folderInvalidOrNotExists': 'Folder {0} is invalid or does not exist.',
		
		// 确认对话框
		'confirmDeleteFile': 'Are you sure you want to delete file "{0}"?',
		'deleteWarning': 'This action cannot be undone. The file will be permanently deleted.',
		
		// 设置
		'showRibbonIcon': 'Show Ribbon Icon',
		'showRibbonIconDesc': 'Whether to show the quick button for generating kanban in the sidebar',
		
		// 命令
		'generateKanbanCommand': 'Generate Kanban View for Current Folder',
		'ribbonIconTooltip': 'Generate kanban view for current folder'
	},
	'zh': {
		// 按钮和操作
		'NewPrompt': '新增',
		'search': '搜索...',
		'refresh': '刷新',
		'iterate': '迭代',
		'copy': '复制',
		'delete': '删除文件',
		'confirm': '确认删除',
		'cancel': '取消',
		
		// 通知消息
		'fileCreated': '文件 {0} 已创建',
		'createFileFailed': '创建文件失败',
		'fileDeleted': '文件 "{0}" 已删除',
		'deleteFileFailed': '删除文件失败',
		'contentCopied': '版本内容已复制到剪贴板',
		'newVersionCreated': '新版本 {0} 已在文件 {1} 中创建',
		'kanbanActivated': '当前文件夹的看板视图已激活',
		'kanbanOpened': '已为当前文件夹打开看板视图',
		'cannotGetFolderPath': '无法获取当前文件夹路径。请确保您在一个打开的文件中点击此按钮。',
		'cannotOpenKanban': '无法打开看板视图，请确保右侧有可用的面板空间。',
		'invalidFolderPath': '当前看板的文件夹路径无效',
		
		// 界面文本
		'empty': '空空如也',
		'noMatchingFiles': '没有找到与 "{0}" 匹配的文件。',
		'noMarkdownFiles': '这个文件夹还没有 Markdown 文件。',
		'folderInvalidOrNotExists': '文件夹 {0} 无效或不存在。',
		
		// 确认对话框
		'confirmDeleteFile': '您确定要删除文件 "{0}" 吗？',
		'deleteWarning': '此操作无法撤销。文件将被永久删除。',
		
		// 设置
		'showRibbonIcon': '显示侧边栏按钮',
		'showRibbonIconDesc': '是否在侧边栏显示生成看板的快捷按钮',
		
		// 命令
		'generateKanbanCommand': '生成当前文件夹的看板视图',
		'ribbonIconTooltip': '生成当前文件夹的看板视图'
	}
};

// 获取当前语言
function getCurrentLocale(): string {
	const locale = (window as any).moment?.locale() || 'en';
	return locale.startsWith('zh') ? 'zh' : 'en';
}

// 翻译函数
function t(key: string, ...args: string[]): string {
	const locale = getCurrentLocale();
	let text = TRANSLATIONS[locale]?.[key] || TRANSLATIONS['en'][key] || key;
	
	// 替换占位符 {0}, {1}, etc.
	args.forEach((arg, index) => {
		text = text.replace(`{${index}}`, arg);
	});
	
	return text;
}
