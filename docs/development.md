# Development

## Build

```sh
npm ci
npm run check
npm run build
```

Press **F5** in VS Code to open the Extension Development Host. Use `npm run watch` while editing.

## Test

Install the tested CLI into an isolated folder:

```sh
npm install --prefix /tmp/maestrun-runtime @maestrun/maestrun@0.1.1-beta.5
export MAESTRUN_TEST_EXECUTABLE=/tmp/maestrun-runtime/node_modules/@maestrun/maestrun/dist/main.js
npm test
npm run test:host
```

On headless Linux, use `xvfb-run -a npm run test:host`.

- Unit/integration suite: 40 tests; fixtures do not call paid models.
- Host suite: real VS Code 1.106.0, driven through Playwright.
- `VSCODE_TEST_VERSION` selects another VS Code version.
- Without `MAESTRUN_TEST_EXECUTABLE`, tests use `../maestrun-cli/dist/main.js`. Runtime tests skip if it is missing; host tests require it.

## Package

```sh
npm run package
```

This creates `maestrun-vscode-1.0.0.vsix`. Git ignores VSIX files; distribute only the current package through GitHub Releases.

## Integration notes

The extension runs the installed Maestrun engine in a background Node.js service. It uses internal compiled modules; incompatible CLI changes can require an adapter update.

Workflow prompts use IPC. Cancellation, answers, and instructions use the CLI's existing protocols. The CLI validates whether execution can resume.

Virtual and untrusted workspaces are unsupported. Project plugins need explicit approval before execution.

The icon follows the official Maestrun brand. Source and assets are covered by [Sustainable Use License 1.0](../LICENSE).
