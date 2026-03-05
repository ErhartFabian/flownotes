const cp = require('child_process');
const os = require('os');
const path = require('path');
const { downloadAndUnzipVSCode } = require('@vscode/test-electron');

async function main() {
	const extensionDevelopmentPath = path.resolve(__dirname, '..');
	const extensionTestsPath = path.resolve(
		extensionDevelopmentPath,
		'node_modules',
		'@vscode',
		'test-cli',
		'out',
		'runner.cjs'
	);
	const testFilePath = path.resolve(__dirname, 'extension.test.js');

	const testOptions = JSON.stringify({
		mochaOpts: {
			timeout: 20000
		},
		files: [testFilePath],
		preload: [],
		colorDefault: true
	});

	const vscodeExecutablePath = await downloadAndUnzipVSCode('stable');
	const userDataDir = path.join(os.tmpdir(), 'flownotes-vscode-test-user-data');
	const extensionsDir = path.join(os.tmpdir(), 'flownotes-vscode-test-extensions');

	const args = [
		extensionDevelopmentPath,
		'--no-sandbox',
		'--disable-gpu-sandbox',
		'--disable-updates',
		'--skip-welcome',
		'--skip-release-notes',
		'--disable-workspace-trust',
		`--user-data-dir=${userDataDir}`,
		`--extensions-dir=${extensionsDir}`,
		`--extensionDevelopmentPath=${extensionDevelopmentPath}`,
		`--extensionTestsPath=${extensionTestsPath}`
	];

	const child = cp.spawn(vscodeExecutablePath, args, {
		env: {
			...process.env,
			VSCODE_TEST_OPTIONS: testOptions,
			ELECTRON_RUN_AS_NODE: undefined
		},
		shell: false,
		stdio: 'inherit'
	});

	child.on('error', (error) => {
		console.error(error);
		process.exit(1);
	});

	child.on('exit', (code, signal) => {
		if (typeof code === 'number') {
			process.exit(code);
			return;
		}

		console.error(`Test process exited with signal ${signal || 'unknown'}.`);
		process.exit(1);
	});
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
