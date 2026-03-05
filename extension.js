const vscode = require('vscode');
const crypto = require('crypto');

const STORAGE_KEY = 'flownotes.notes';
const DEFAULT_COLOR = 'yellow';
const COLOR_NAMES = new Set(['yellow', 'blue', 'green', 'pink']);

class FlowNotesViewProvider {
	static viewType = 'flownotes.notesView';

	/**
	 * @param {vscode.ExtensionContext} context
	 */
	constructor(context) {
		this.context = context;
		this.view = undefined;
	}

	/**
	 * @param {vscode.WebviewView} webviewView
	 */
	resolveWebviewView(webviewView) {
		this.view = webviewView;
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [this.context.extensionUri]
		};
		webviewView.webview.html = this.getHtml(webviewView.webview);

		const messageListener = webviewView.webview.onDidReceiveMessage((message) => {
			this.handleMessage(message).catch((error) => {
				console.error('FlowNotes failed to handle a message', error);
			});
		});

		const visibilityListener = webviewView.onDidChangeVisibility(() => {
			if (webviewView.visible) {
				this.postNotes();
			}
		});

		const disposeListener = webviewView.onDidDispose(() => {
			if (this.view === webviewView) {
				this.view = undefined;
			}
		});

		this.context.subscriptions.push(messageListener, visibilityListener, disposeListener);
		this.postNotes();
	}

	async refresh() {
		this.postNotes();
	}

	/**
	 * @param {string} text
	 */
	async createNote(text = '') {
		const notes = this.getStoredNotes();
		const now = Date.now();
		notes.push({
			id: generateId(),
			text: typeof text === 'string' ? text : '',
			color: DEFAULT_COLOR,
			pinned: false,
			createdAt: now,
			updatedAt: now
		});
		await this.saveNotes(notes);
		this.postNotes();
	}

	/**
	 * @param {{ type?: string; id?: string; text?: string; color?: string; refresh?: boolean; }} message
	 */
	async handleMessage(message) {
		if (!message || typeof message.type !== 'string') {
			return;
		}

		switch (message.type) {
			case 'ready':
				this.postNotes();
				break;
			case 'createNote':
				await this.createNote('');
				break;
			case 'updateNote':
				if (typeof message.id === 'string') {
					const refreshView = message.refresh !== false;
					await this.updateNote(message.id, typeof message.text === 'string' ? message.text : '', refreshView);
				}
				break;
			case 'deleteNote':
				if (typeof message.id === 'string') {
					await this.deleteNote(message.id);
				}
				break;
			case 'setColor':
				if (typeof message.id === 'string' && typeof message.color === 'string') {
					await this.setColor(message.id, message.color);
				}
				break;
			case 'togglePin':
				if (typeof message.id === 'string') {
					await this.togglePin(message.id);
				}
				break;
			default:
				break;
		}
	}

	/**
	 * @param {string} id
	 * @param {string} text
	 * @param {boolean} refreshView
	 */
	async updateNote(id, text, refreshView = true) {
		const notes = this.getStoredNotes();
		const index = notes.findIndex((note) => note.id === id);
		if (index < 0) {
			return;
		}

		if (notes[index].text === text) {
			if (refreshView) {
				this.postNotes();
			}
			return;
		}

		notes[index] = {
			...notes[index],
			text,
			updatedAt: Date.now()
		};
		await this.saveNotes(notes);
		if (refreshView) {
			this.postNotes();
		}
	}

	/**
	 * @param {string} id
	 */
	async deleteNote(id) {
		const notes = this.getStoredNotes();
		const filtered = notes.filter((note) => note.id !== id);
		if (filtered.length === notes.length) {
			return;
		}

		await this.saveNotes(filtered);
		this.postNotes();
	}

	/**
	 * @param {string} id
	 * @param {string} color
	 */
	async setColor(id, color) {
		if (!COLOR_NAMES.has(color)) {
			return;
		}

		const notes = this.getStoredNotes();
		const index = notes.findIndex((note) => note.id === id);
		if (index < 0) {
			return;
		}

		notes[index] = {
			...notes[index],
			color,
			updatedAt: Date.now()
		};
		await this.saveNotes(notes);
		this.postNotes();
	}

	/**
	 * @param {string} id
	 */
	async togglePin(id) {
		const notes = this.getStoredNotes();
		const index = notes.findIndex((note) => note.id === id);
		if (index < 0) {
			return;
		}

		notes[index] = {
			...notes[index],
			pinned: !notes[index].pinned,
			updatedAt: Date.now()
		};
		await this.saveNotes(notes);
		this.postNotes();
	}

	postNotes() {
		if (!this.view) {
			return;
		}

		const notes = sortNotesForView(this.getStoredNotes());
		this.view.webview.postMessage({
			type: 'notes',
			notes
		});
	}

	getStoredNotes() {
		const rawValue = this.context.globalState.get(STORAGE_KEY, []);
		if (!Array.isArray(rawValue)) {
			return [];
		}

		return rawValue
			.map((item) => normalizeNote(item))
			.filter((item) => item !== null);
	}

	/**
	 * @param {Array<{
	 *  id: string;
	 *  text: string;
	 *  color: string;
	 *  pinned: boolean;
	 *  createdAt: number;
	 *  updatedAt: number;
	 * }>} notes
	 */
	async saveNotes(notes) {
		await this.context.globalState.update(STORAGE_KEY, notes);
	}

	/**
	 * @param {vscode.Webview} webview
	 */
	getHtml(webview) {
		const nonce = getNonce();
		return `<!DOCTYPE html>
<html lang="es">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
	<title>FlowNotes</title>
	<style>
		:root {
			--surface-bg: var(--vscode-sideBar-background);
			--surface-fg: var(--vscode-sideBar-foreground);
			--surface-muted: var(--vscode-descriptionForeground);
			--focus: var(--vscode-focusBorder);
			--edge: var(--vscode-input-border);
			--panel-card: var(--vscode-editorWidget-background);
			--card-radius: 12px;
			--card-shadow: 0 8px 20px rgba(10, 14, 24, 0.09);
			--action-bg: rgba(120, 120, 120, 0.12);
			--action-bg-hover: rgba(120, 120, 120, 0.2);
			--border-soft: rgba(120, 120, 120, 0.24);
		}

		* {
			box-sizing: border-box;
		}

		body {
			margin: 0;
			color: var(--surface-fg);
			font-family: "Segoe UI Variable Text", "Segoe UI", "Trebuchet MS", sans-serif;
			background:
				radial-gradient(circle at 100% 0%, rgba(108, 158, 233, 0.08), transparent 44%),
				radial-gradient(circle at 0% 0%, rgba(255, 219, 158, 0.07), transparent 48%),
				var(--surface-bg);
			min-height: 100vh;
			display: flex;
			flex-direction: column;
			gap: 10px;
			padding: 12px;
		}

		.panel-head {
			display: flex;
			align-items: baseline;
			justify-content: space-between;
			gap: 8px;
		}

		.panel-title {
			margin: 0;
			font-size: 14px;
			line-height: 1.2;
			font-weight: 700;
			letter-spacing: 0.01em;
		}

		.panel-subtitle {
			font-size: 10px;
			font-weight: 600;
			letter-spacing: 0.06em;
			text-transform: uppercase;
			color: var(--surface-muted);
		}

		.toolbar {
			display: grid;
			grid-template-columns: 1fr auto;
			gap: 8px;
			align-items: center;
			position: sticky;
			top: 0;
			z-index: 5;
			padding: 8px;
			border: 1px solid var(--border-soft);
			border-radius: 12px;
			background: rgba(120, 120, 120, 0.06);
			backdrop-filter: blur(3px);
		}

		.search-input {
			width: 100%;
			border: 1px solid var(--edge);
			background: var(--vscode-input-background);
			color: var(--vscode-input-foreground);
			border-radius: 8px;
			padding: 8px 10px 8px 11px;
			outline: none;
			font-size: 12px;
		}

		.search-input:focus {
			border-color: var(--focus);
		}

		.add-button {
			border: 1px solid transparent;
			border-radius: 8px;
			padding: 8px 11px;
			font-size: 12px;
			font-weight: 600;
			cursor: pointer;
			letter-spacing: 0.01em;
			color: var(--vscode-button-foreground);
			background: var(--vscode-button-background);
			transition: background 0.14s ease, border-color 0.14s ease;
		}

		.add-button:hover {
			background: var(--vscode-button-hoverBackground);
			border-color: rgba(255, 255, 255, 0.22);
		}

		.results-caption {
			margin: 0 2px;
			font-size: 11px;
			font-weight: 500;
			color: var(--surface-muted);
		}

		.notes-list {
			display: grid;
			gap: 11px;
			align-content: start;
			animation: panel-load 160ms ease-out;
		}

		.note-card {
			border-radius: var(--card-radius);
			padding: 11px;
			box-shadow: var(--card-shadow);
			display: grid;
			gap: 9px;
			border: 1px solid var(--border-soft);
			opacity: 1;
			transform: translateY(0);
		}

		.note-card.animate-in {
			animation: card-in 160ms ease forwards;
			opacity: 0;
			transform: translateY(6px);
			animation-delay: var(--delay, 0ms);
		}

		.note-header {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 6px;
		}

		.note-chip {
			display: inline-flex;
			align-items: center;
			border-radius: 7px;
			font-size: 10px;
			font-weight: 600;
			letter-spacing: 0.03em;
			text-transform: uppercase;
			padding: 3px 6px;
			color: rgba(35, 35, 35, 0.84);
			background: rgba(255, 255, 255, 0.45);
			border: 1px solid rgba(120, 120, 120, 0.24);
		}

		.note-actions {
			display: flex;
			align-items: center;
			gap: 6px;
		}

		.icon-button {
			width: 28px;
			height: 28px;
			border: 1px solid transparent;
			border-radius: 7px;
			display: inline-flex;
			align-items: center;
			justify-content: center;
			cursor: pointer;
			background: var(--action-bg);
			color: rgba(35, 35, 35, 0.86);
			transition: background 0.12s ease, border-color 0.12s ease;
		}

		.icon-button:hover {
			background: var(--action-bg-hover);
			border-color: rgba(120, 120, 120, 0.3);
		}

		.icon-button.pinned {
			background: rgba(91, 145, 219, 0.17);
			color: rgba(30, 55, 94, 0.95);
			border-color: rgba(91, 145, 219, 0.36);
		}

		.icon-button svg {
			width: 16px;
			height: 16px;
			fill: currentColor;
		}

		.note-editor {
			width: 100%;
			border: 1px solid rgba(110, 110, 110, 0.24);
			border-radius: 8px;
			min-height: 92px;
			max-height: 200px;
			resize: vertical;
			background: rgba(255, 255, 255, 0.39);
			color: rgba(32, 32, 32, 0.95);
			padding: 10px;
			line-height: 1.46;
			font-size: 12px;
			font-family: "Segoe UI Variable Text", "Segoe UI", "Trebuchet MS", sans-serif;
		}

		.note-editor:focus {
			outline: none;
			border-color: var(--focus);
			background: rgba(255, 255, 255, 0.54);
			box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.2);
		}

		.color-row {
			display: flex;
			align-items: center;
			gap: 6px;
		}

		.color-button {
			width: 20px;
			height: 20px;
			border-radius: 999px;
			border: 1px solid rgba(100, 100, 100, 0.3);
			cursor: pointer;
			transition: transform 0.12s ease, border-color 0.12s ease, box-shadow 0.12s ease;
		}

		.color-button:hover {
			transform: scale(1.08);
			border-color: rgba(50, 50, 50, 0.55);
		}

		.color-button.active {
			box-shadow: 0 0 0 2px rgba(35, 35, 35, 0.18);
			border-color: rgba(20, 20, 20, 0.58);
		}

		.color-yellow { background: #f4eabf; }
		.color-blue { background: #dbe8f6; }
		.color-green { background: #dceddb; }
		.color-pink { background: #f2dfe9; }

		.note-yellow { background: linear-gradient(160deg, #f8f0ca, #efe3b8); }
		.note-blue { background: linear-gradient(160deg, #e5eefb, #d6e3f2); }
		.note-green { background: linear-gradient(160deg, #e6f2e2, #d7e6d1); }
		.note-pink { background: linear-gradient(160deg, #f7e8f0, #ecdbe4); }

		.empty-state {
			border-radius: 10px;
			padding: 18px 16px;
			text-align: center;
			color: var(--surface-muted);
			font-size: 12px;
			line-height: 1.45;
			border: 1px dashed rgba(120, 120, 120, 0.4);
			background: rgba(120, 120, 120, 0.06);
		}

		@keyframes card-in {
			to {
				opacity: 1;
				transform: translateY(0);
			}
		}

		@keyframes panel-load {
			from {
				opacity: 0;
				transform: translateY(4px);
			}

			to {
				opacity: 1;
				transform: translateY(0);
			}
		}

		@media (max-width: 420px) {
			body {
				padding: 10px;
			}

			.panel-head {
				align-items: flex-start;
				flex-direction: column;
				gap: 4px;
			}

			.toolbar {
				grid-template-columns: 1fr;
				padding: 7px;
			}

			.add-button {
				width: 100%;
			}
		}
	</style>
</head>
<body>
	<div class="panel-head">
		<h1 class="panel-title">FlowNotes</h1>
		<span class="panel-subtitle">Quick Workspace Notes</span>
	</div>
	<div class="toolbar">
		<input id="search-input" class="search-input" type="search" placeholder="Buscar en notas..." aria-label="Buscar notas">
		<button id="add-note-button" class="add-button" type="button">+ Nueva</button>
	</div>
	<p id="results-caption" class="results-caption"></p>
	<section id="notes-list" class="notes-list" aria-live="polite"></section>

	<script nonce="${nonce}">
		const vscodeApi = acquireVsCodeApi();
		const notesList = document.getElementById('notes-list');
		const searchInput = document.getElementById('search-input');
		const addNoteButton = document.getElementById('add-note-button');
		const resultsCaption = document.getElementById('results-caption');

		const COLOR_LABELS = {
			yellow: 'Amarillo',
			blue: 'Azul',
			green: 'Verde',
			pink: 'Rosa'
		};

		const COLOR_KEYS = Object.keys(COLOR_LABELS);
		const ICON_PIN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 3l5 5-2.8 2.8.7 5.7-1.4 1.4-5.7-.7L8 21l-1.4-1.4 3.8-3.8-.7-5.7L8.3 8 13.3 3H16zm-1.9 2h-.9l-2.7 2.7 1.3 1.3.8 6 6 .8 1.3 1.3 2.7-2.7v-.9L18.9 8l-4.8-3z"/></svg>';
		const ICON_UNPIN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.3 3l5.7 5.7-2.4 2.4.8 5-1.4 1.4-5-.8L8 20l-1.4-1.4 4.1-4.1-.8-5L7.5 7.1 13.1 1.5 14.3 3zm-.7 2.8l-3.3 3.3 1.3 1.3.8 5.2-3.5 3.5.1.1 3.5-3.5 5.2.8 1.3-1.3-.8-5.2 3.3-3.3-3-3-2.9 2.9-2-2-1 .9 2 2-1.9 1.9z"/></svg>';
		const ICON_DELETE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6l1 2h4v2H4V5h4l1-2zm1 6h2v9h-2V9zm4 0h2v9h-2V9zM7 9h2v9H7V9z"/></svg>';

		let allNotes = [];
		let searchText = '';
		let hasRenderedOnce = false;
		const pendingUpdates = new Map();

		addNoteButton.addEventListener('click', () => {
			vscodeApi.postMessage({ type: 'createNote' });
		});

		searchInput.addEventListener('input', (event) => {
			searchText = String(event.target.value || '').toLowerCase();
			render();
		});

		window.addEventListener('message', (event) => {
			const message = event.data;
			if (!message || message.type !== 'notes' || !Array.isArray(message.notes)) {
				return;
			}

			allNotes = message.notes;
			render();
		});

		vscodeApi.postMessage({ type: 'ready' });

		function render() {
			const activeEditorState = getActiveEditorState();
			const animateCards = !hasRenderedOnce;
			notesList.replaceChildren();

			const filteredNotes = allNotes.filter((note) => {
				if (!searchText) {
					return true;
				}

				return String(note.text || '').toLowerCase().includes(searchText);
			});

			const totalLabel = filteredNotes.length === allNotes.length
				? String(allNotes.length) + ' nota(s)'
				: String(filteredNotes.length) + ' de ' + String(allNotes.length) + ' nota(s)';
			resultsCaption.textContent = totalLabel;

			if (filteredNotes.length === 0) {
				const empty = document.createElement('div');
				empty.className = 'empty-state';
				empty.textContent = allNotes.length === 0
					? 'No hay notas todavia. Crea la primera con + Nueva.'
					: 'No hay resultados para tu busqueda.';
				notesList.appendChild(empty);
				hasRenderedOnce = true;
				return;
			}

			filteredNotes.forEach((note, index) => {
				notesList.appendChild(createNoteElement(note, index, animateCards));
			});

			restoreActiveEditorState(activeEditorState);
			hasRenderedOnce = true;
		}

		function createNoteElement(note, index, animateCards) {
			const card = document.createElement('article');
			const noteColor = COLOR_KEYS.includes(note.color) ? note.color : 'yellow';
			card.className = 'note-card note-' + noteColor + (animateCards ? ' animate-in' : '');
			if (animateCards) {
				card.style.setProperty('--delay', String(Math.min(index * 40, 320)) + 'ms');
			}

			const header = document.createElement('div');
			header.className = 'note-header';

			const chip = document.createElement('span');
			chip.className = 'note-chip';
			chip.textContent = note.pinned ? 'Fijada' : 'Nota';

			const actions = document.createElement('div');
			actions.className = 'note-actions';

			const pinButton = document.createElement('button');
			pinButton.type = 'button';
			pinButton.className = note.pinned ? 'icon-button pinned' : 'icon-button';
			pinButton.title = note.pinned ? 'Quitar de fijadas' : 'Fijar nota';
			pinButton.setAttribute('aria-label', pinButton.title);
			pinButton.innerHTML = note.pinned ? ICON_UNPIN : ICON_PIN;
			pinButton.addEventListener('click', () => {
				vscodeApi.postMessage({
					type: 'togglePin',
					id: note.id
				});
			});

			const deleteButton = document.createElement('button');
			deleteButton.type = 'button';
			deleteButton.className = 'icon-button';
			deleteButton.title = 'Borrar nota';
			deleteButton.setAttribute('aria-label', 'Borrar nota');
			deleteButton.innerHTML = ICON_DELETE;
			deleteButton.addEventListener('click', () => {
				clearPendingUpdate(note.id);
				vscodeApi.postMessage({
					type: 'deleteNote',
					id: note.id
				});
			});

			actions.append(pinButton, deleteButton);
			header.append(chip, actions);

			const editor = document.createElement('textarea');
			editor.className = 'note-editor';
			editor.dataset.noteId = note.id;
			editor.value = typeof note.text === 'string' ? note.text : '';
			editor.placeholder = 'Escribe una nota...';
			editor.addEventListener('input', () => {
				queueTextUpdate(note.id, editor.value);
			});
			editor.addEventListener('blur', () => {
				flushTextUpdate(note.id, editor.value);
			});

			const colorRow = document.createElement('div');
			colorRow.className = 'color-row';
			COLOR_KEYS.forEach((colorName) => {
				const colorButton = document.createElement('button');
				colorButton.type = 'button';
				colorButton.className = 'color-button color-' + colorName + (noteColor === colorName ? ' active' : '');
				colorButton.title = 'Color ' + COLOR_LABELS[colorName];
				colorButton.setAttribute('aria-label', colorButton.title);
				colorButton.addEventListener('click', () => {
					vscodeApi.postMessage({
						type: 'setColor',
						id: note.id,
						color: colorName
					});
				});
				colorRow.appendChild(colorButton);
			});

			card.append(header, editor, colorRow);
			return card;
		}

		function queueTextUpdate(noteId, text) {
			applyLocalTextUpdate(noteId, text);
			clearPendingUpdate(noteId);
			const timer = setTimeout(() => {
				pendingUpdates.delete(noteId);
				vscodeApi.postMessage({
					type: 'updateNote',
					id: noteId,
					text,
					refresh: false
				});
			}, 340);
			pendingUpdates.set(noteId, timer);
		}

		function flushTextUpdate(noteId, text) {
			applyLocalTextUpdate(noteId, text);
			clearPendingUpdate(noteId);
			vscodeApi.postMessage({
				type: 'updateNote',
				id: noteId,
				text,
				refresh: true
			});
		}

		function clearPendingUpdate(noteId) {
			if (!pendingUpdates.has(noteId)) {
				return;
			}

			clearTimeout(pendingUpdates.get(noteId));
			pendingUpdates.delete(noteId);
		}

		function applyLocalTextUpdate(noteId, text) {
			const note = allNotes.find((item) => item.id === noteId);
			if (!note) {
				return;
			}

			note.text = text;
			note.updatedAt = Date.now();
		}

		function getActiveEditorState() {
			const activeElement = document.activeElement;
			if (!(activeElement instanceof HTMLTextAreaElement) || !activeElement.dataset.noteId) {
				return null;
			}

			return {
				noteId: activeElement.dataset.noteId,
				selectionStart: activeElement.selectionStart,
				selectionEnd: activeElement.selectionEnd,
				scrollTop: activeElement.scrollTop
			};
		}

		function restoreActiveEditorState(state) {
			if (!state) {
				return;
			}

			const editor = Array.from(notesList.querySelectorAll('textarea.note-editor'))
				.find((item) => item.dataset.noteId === state.noteId);
			if (!editor) {
				return;
			}

			editor.focus();
			const maxLength = editor.value.length;
			const start = Math.min(state.selectionStart, maxLength);
			const end = Math.min(state.selectionEnd, maxLength);
			editor.setSelectionRange(start, end);
			editor.scrollTop = state.scrollTop;
		}
	</script>
</body>
</html>`;
	}
}

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
	const provider = new FlowNotesViewProvider(context);

	const viewRegistration = vscode.window.registerWebviewViewProvider(
		FlowNotesViewProvider.viewType,
		provider,
		{
			webviewOptions: {
				retainContextWhenHidden: true
			}
		}
	);

	const addNoteCommand = vscode.commands.registerCommand('flownotes.addNote', async () => {
		await provider.createNote('');
		await vscode.commands.executeCommand('workbench.view.extension.flownotes');
		await vscode.commands.executeCommand('flownotes.notesView.focus');
	});

	const refreshNotesCommand = vscode.commands.registerCommand('flownotes.refreshNotes', async () => {
		await provider.refresh();
	});

	context.subscriptions.push(viewRegistration, addNoteCommand, refreshNotesCommand);
}

function deactivate() {
	return undefined;
}

/**
 * @param {unknown} rawNote
 */
function normalizeNote(rawNote) {
	if (!rawNote || typeof rawNote !== 'object') {
		return null;
	}

	const note = /** @type {{
	 *  id?: string;
	 *  text?: string;
	 *  color?: string;
	 *  pinned?: boolean;
	 *  createdAt?: number;
	 *  updatedAt?: number;
	 * }} */ (rawNote);

	const now = Date.now();
	const createdAt = Number.isFinite(note.createdAt) ? Number(note.createdAt) : now;
	const updatedAt = Number.isFinite(note.updatedAt) ? Number(note.updatedAt) : createdAt;

	return {
		id: typeof note.id === 'string' && note.id.length > 0 ? note.id : generateId(),
		text: typeof note.text === 'string' ? note.text : '',
		color: COLOR_NAMES.has(String(note.color)) ? String(note.color) : DEFAULT_COLOR,
		pinned: Boolean(note.pinned),
		createdAt,
		updatedAt
	};
}

/**
 * @param {Array<{
 *  id: string;
 *  text: string;
 *  color: string;
 *  pinned: boolean;
 *  createdAt: number;
 *  updatedAt: number;
 * }>} notes
 */
function sortNotesForView(notes) {
	return [...notes].sort((left, right) => {
		if (left.pinned !== right.pinned) {
			return left.pinned ? -1 : 1;
		}

		if (left.createdAt !== right.createdAt) {
			return right.createdAt - left.createdAt;
		}

		return left.id.localeCompare(right.id);
	});
}

function generateId() {
	if (typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}

	return String(Date.now()) + '-' + Math.random().toString(16).slice(2);
}

function getNonce() {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let value = '';

	for (let index = 0; index < 32; index += 1) {
		value += chars.charAt(Math.floor(Math.random() * chars.length));
	}

	return value;
}

module.exports = {
	activate,
	deactivate,
	__testables: {
		FlowNotesViewProvider,
		normalizeNote,
		sortNotesForView
	}
};
