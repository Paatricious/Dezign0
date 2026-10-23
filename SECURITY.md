# Security

Dezign0 is a local design toolkit. It contains no server, telemetry or network
calls in the plugin.

## What the plugin does

On setup, the OpenCode plugin:

- copies the bundled `design-os/` kit to `<project>/.design-os` if it is missing;
- writes `.design-os/.dezign0-kit.json` (version and file hashes);
- registers thirteen skills and five tools with OpenCode.

The lifecycle hooks are local: Claude hooks call the CLI on edited HTML;
OpenCode observes file/idle events and only emits a warning. Neither hook sends
data anywhere.

The CLI and MCP server are local entry points over the same tools. The MCP
server uses stdio only, resolves paths inside the project with `realpath`, and
makes no network calls. The plugin, CLI and MCP server do not edit existing
source files, run package install scripts, or send data anywhere.

## Tools

`dezign0_lint`, `dezign0_measure`, `dezign0_doctor`, `dezign0_design_systems` and
`dezign0_addons` only read files inside the current project or the optional pack. Paths are resolved with `realpath` and rejected if they escape
the project directory. They spawn Node with a fixed script path and arguments;
there is no shell, so file names cannot inject commands. Lint and measurement
output is capped and returned to the agent.

`measure-artifact` optionally uses Playwright. Playwright is not bundled; the
project must install it. Its browser process can load the artifact's local
assets and any external URLs the artifact requests. Treat untrusted HTML as
untrusted.

## Publisher and package

The npm package is published from this repository. `prepublishOnly` runs syntax
checks, the plugin smoke test and the installer regression test. The package
contains no third-party design systems, templates, fonts or images.

## Reporting a vulnerability

Use GitHub's private **Security → Report a vulnerability** flow on this
repository. Do not open a public issue with an exploit. Include the affected
version, a minimal artifact or config, and the command that reproduces it.

## Supported versions

Security fixes are applied to the latest published 0.x release. Older versions
may not receive fixes.
