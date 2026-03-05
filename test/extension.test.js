const assert = require('assert');
const vm = require('node:vm');
const vscode = require('vscode');
const { JSDOM } = require('jsdom');
const extension = require('../extension');

const { __testables } = extension;

function createContextMock() {
	return {
		extensionUri: vscode.Uri.file('c:/tmp/flownotes'),
		subscriptions: [],
		globalState: {
			get() {
				return [];
			},
			update() {
				return Promise.resolve();
			}
		}
	};
}

function createStatefulContextMock(initialNotes) {
	let storedNotes = initialNotes.map((note) => ({ ...note }));
	const updateCalls = [];

	return {
		context: {
			extensionUri: vscode.Uri.file('c:/tmp/flownotes'),
			subscriptions: [],
			globalState: {
				get() {
					return storedNotes;
				},
				update(_key, value) {
					storedNotes = value;
					updateCalls.push(value);
					return Promise.resolve();
				}
			}
		},
		getStoredNotes() {
			return storedNotes;
		},
		getUpdateCalls() {
			return updateCalls;
		}
	};
}

function extractInlineScript(html) {
	const match = html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/);
	assert.ok(match, 'Expected FlowNotes webview HTML to include an inline script');
	return match[1];
}

function stripInlineScript(html) {
	return html.replace(/<script nonce="[^"]+">[\s\S]*?<\/script>/, '');
}

function wait(ms) {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('normalizeNote applies safe defaults', () => {
		const normalized = __testables.normalizeNote({});
		assert.ok(normalized);
		assert.strictEqual(typeof normalized.id, 'string');
		assert.ok(normalized.id.length > 0);
		assert.strictEqual(normalized.text, '');
		assert.strictEqual(normalized.color, 'yellow');
		assert.strictEqual(normalized.pinned, false);
		assert.ok(Number.isFinite(normalized.createdAt));
		assert.ok(Number.isFinite(normalized.updatedAt));
	});

	test('normalizeNote keeps valid input and sanitizes color', () => {
		const normalized = __testables.normalizeNote({
			id: 'note-1',
			text: 'hola',
			color: 'purple',
			pinned: true,
			createdAt: 10,
			updatedAt: 20
		});

		assert.ok(normalized);
		assert.strictEqual(normalized.id, 'note-1');
		assert.strictEqual(normalized.text, 'hola');
		assert.strictEqual(normalized.color, 'yellow');
		assert.strictEqual(normalized.pinned, true);
		assert.strictEqual(normalized.createdAt, 10);
		assert.strictEqual(normalized.updatedAt, 20);
	});

	test('sortNotesForView prioritizes pinned and then latest creations', () => {
		const ordered = __testables.sortNotesForView([
			{ id: '1', text: '', color: 'yellow', pinned: false, createdAt: 2, updatedAt: 999 },
			{ id: '2', text: '', color: 'yellow', pinned: true, createdAt: 6, updatedAt: 1 },
			{ id: '3', text: '', color: 'yellow', pinned: true, createdAt: 4, updatedAt: 9999 },
			{ id: '4', text: '', color: 'yellow', pinned: false, createdAt: 5, updatedAt: 0 }
		]);

		assert.deepStrictEqual(ordered.map((note) => note.id), ['2', '3', '4', '1']);
	});

	test('sortNotesForView does not move notes based on updatedAt', () => {
		const ordered = __testables.sortNotesForView([
			{ id: 'old', text: '', color: 'yellow', pinned: false, createdAt: 3, updatedAt: 9999 },
			{ id: 'new', text: '', color: 'yellow', pinned: false, createdAt: 4, updatedAt: 1 }
		]);

		assert.deepStrictEqual(ordered.map((note) => note.id), ['new', 'old']);
	});

	test('webview HTML keeps cards visible after first render', () => {
		const provider = new __testables.FlowNotesViewProvider(/** @type {any} */ (createContextMock()));
		const html = provider.getHtml(/** @type {any} */ ({ cspSource: 'vscode-resource' }));

		assert.ok(html.includes('.note-card.animate-in'));
		assert.ok(html.includes('let hasRenderedOnce = false;'));
		assert.ok(html.includes('const animateCards = !hasRenderedOnce;'));
		assert.ok(html.includes('opacity: 1;'));
	});

	test('updateNote with refresh false persists without rerendering the webview', async () => {
		const state = createStatefulContextMock([
			{ id: 'note-1', text: 'A', color: 'yellow', pinned: false, createdAt: 1, updatedAt: 1 }
		]);
		const provider = new __testables.FlowNotesViewProvider(/** @type {any} */ (state.context));
		const postedMessages = [];
		provider.view = /** @type {any} */ ({
			webview: {
				postMessage(message) {
					postedMessages.push(message);
				}
			}
		});

		await provider.updateNote('note-1', 'AB', false);

		assert.strictEqual(state.getUpdateCalls().length, 1);
		assert.strictEqual(state.getStoredNotes()[0].text, 'AB');
		assert.strictEqual(postedMessages.length, 0);

		await provider.updateNote('note-1', 'ABC', true);
		assert.strictEqual(postedMessages.length, 1);
	});

	test('webview typing with spaces keeps note visible and focused after rerender', async () => {
		const provider = new __testables.FlowNotesViewProvider(/** @type {any} */ (createContextMock()));
		const html = provider.getHtml(/** @type {any} */ ({ cspSource: 'vscode-resource' }));
		const scriptCode = extractInlineScript(html);

		const dom = new JSDOM(stripInlineScript(html), {
			runScripts: 'outside-only',
			pretendToBeVisual: true,
			url: 'https://flownotes.local'
		});

		const sentMessages = [];
		dom.window.acquireVsCodeApi = () => ({
			postMessage(message) {
				sentMessages.push(message);
			}
		});

		vm.runInContext(scriptCode, dom.getInternalVMContext());

		const initialNote = {
			id: 'note-1',
			text: '',
			color: 'yellow',
			pinned: false,
			createdAt: 1,
			updatedAt: 1
		};

		dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
			data: {
				type: 'notes',
				notes: [initialNote]
			}
		}));

		let card = dom.window.document.querySelector('.note-card');
		let editor = /** @type {any} */ (dom.window.document.querySelector('textarea.note-editor'));
		assert.ok(card, 'Expected first note card to render');
		assert.ok(editor, 'Expected note textarea to render');
		assert.ok(card.classList.contains('animate-in'), 'Expected first render to animate note cards');

		editor.focus();
		editor.value = 'hola mundo ';
		editor.selectionStart = editor.value.length;
		editor.selectionEnd = editor.value.length;
		editor.dispatchEvent(new dom.window.Event('input', { bubbles: true }));

		await wait(350);

		const updateMessage = sentMessages.find((message) => message.type === 'updateNote' && message.id === 'note-1');
		assert.ok(updateMessage, 'Expected webview to send updateNote after typing');
		assert.strictEqual(updateMessage.text, 'hola mundo ');
		assert.strictEqual(updateMessage.refresh, false);

		editor.dispatchEvent(new dom.window.Event('blur', { bubbles: true }));
		const commitMessage = sentMessages.find((message) => message.type === 'updateNote' && message.id === 'note-1' && message.refresh === true);
		assert.ok(commitMessage, 'Expected blur to send committed updateNote with refresh=true');

		dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
			data: {
				type: 'notes',
				notes: [{ ...initialNote, text: 'hola mundo ', updatedAt: 2 }]
			}
		}));

		card = dom.window.document.querySelector('.note-card');
		editor = /** @type {any} */ (dom.window.document.querySelector('textarea.note-editor'));
		assert.ok(card, 'Expected note card to remain rendered after rerender');
		assert.ok(editor, 'Expected note textarea to remain rendered after rerender');
		assert.strictEqual(editor.value, 'hola mundo ');
		assert.strictEqual(dom.window.document.activeElement, editor, 'Expected textarea focus to be restored after rerender');
		assert.ok(!card.classList.contains('animate-in'), 'Expected rerendered card to stay visible without entry animation');

		dom.window.close();
	});
});
