// Local plugin package entrypoint.
// OpenCode resolves a plugin directory by trying `<dir>/server` before `<dir>`,
// so this file makes an absolute-path install resolve without relying on
// package.json main/exports resolution.
export { default } from "./plugin/index.js";
export { Dezign0Plugin } from "./plugin/index.js";
