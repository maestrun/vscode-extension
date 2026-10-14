# Maestrun for VS Code

**[Download v1.0.0](https://github.com/maestrun/vscode-extension/releases/latest)** · [Website](https://maestrun.com) · [Quick guide](docs/usage.md) · [Português](docs/guia-pt-br.md)

Plan, run, and follow Maestrun tasks inside VS Code.

![Task dashboard with Projects and Tasks in the Secondary Side Bar](docs/images/dashboard.png)

*Version 1.0.0. Real interface with demonstration data; no paid model run is shown.*

## Install

1. Install **Node.js 24 LTS** and an authenticated executor supported by Maestrun.
2. Install the tested CLI:

   ```sh
   npm install --global @maestrun/maestrun@0.1.1-beta.5
   ```

3. Download `maestrun-vscode-1.0.0.vsix` from the [release](https://github.com/maestrun/vscode-extension/releases/latest).
4. In VS Code, run **Extensions: Install from VSIX…** and select the file.
5. Open your project folder and click the **Maestrun** icon.

Requires **VS Code 1.106+** and a trusted workspace. Use Linux, macOS, WSL, or SSH. On Windows, open the project through **WSL**. Install the CLI and executor in the same environment as your project.

The extension is stable **1.0.0**. Its tested CLI is **0.1.1-beta.5**, installed separately. See [maestrun.com](https://maestrun.com) for CLI installation and product information.

## Run your first workflow

1. Open **More → Set up workflow**.
2. Choose your executor, model, and steps.
3. Click **Generate plan** and describe the work.
4. Review the tasks.
5. Click **Run / resume**.

**Try an example:** run **Maestrun: Run example** from the Command Palette. Examples use your executor account's usage.

## Find what you need

| Action | Where |
| --- | --- |
| Follow tasks | **Projects / Tasks** in the Secondary Side Bar |
| Inspect a step | **Flowchart** → click a stage |
| Compare projects | **All flowcharts** |
| Read an error | Expand the notice → **View execution log** |
| Remove a configuration or example | Hover a project → trash icon → confirm |

[Illustrated usage guide](docs/usage.md) · [Guia em português](docs/guia-pt-br.md) · [Development](docs/development.md)

## Help

- Missing CLI? Open [maestrun.com](https://maestrun.com), install it, then click **Refresh**.
- Hidden panel? Click the Maestrun icon or run **Maestrun: Open Maestrun**.
- Found a bug? [Open an issue](https://github.com/maestrun/vscode-extension/issues) with the error and extension/CLI versions. Remove secrets from logs before sharing.

[Release notes](CHANGELOG.md) · [Sustainable Use License 1.0](LICENSE)
