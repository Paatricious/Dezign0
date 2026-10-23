/**
 * Validate the optional addon index and every referenced file.
 */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const root = path.resolve(import.meta.dirname, "..");
const pack = path.join(root, "design-languages");
const indexPath = path.join(pack, "addons", "index.json");
const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));

assert.equal(index.schema, "dezign0/addons/v1");
assert.ok(Array.isArray(index.items) && index.items.length >= 5, "addon items");
const sections = new Set(index.items.map((item) => item.section));
for (const required of ["templates", "figma", "handoff", "review", "media"]) {
  assert.ok(sections.has(required), `missing addon section: ${required}`);
}
const ids = new Set();
for (const item of index.items) {
  assert.ok(/^[a-z0-9-]+$/.test(item.id), `bad id ${item.id}`);
  assert.ok(!ids.has(item.id), `duplicate id ${item.id}`);
  ids.add(item.id);
  assert.ok(typeof item.title === "string" && item.title.length > 0, `${item.id}: title`);
  assert.ok(typeof item.description === "string" && item.description.length > 0, `${item.id}: description`);
  const file = path.join(pack, item.path);
  assert.ok(file.startsWith(pack + path.sep), `${item.id}: path escapes pack`);
  assert.ok(fs.existsSync(file), `${item.id}: missing ${item.path}`);
}
const templates = JSON.parse(fs.readFileSync(path.join(pack, "templates", "manifest.json"), "utf8"));
assert.equal(templates.length, 3, "template manifest count");
const templateIds = new Set(templates.map((entry) => entry.id));
for (const id of ["template-deck", "template-live-dashboard", "template-mobile-prototype"]) {
  assert.ok(templateIds.has(id), `template manifest missing ${id}`);
}
const images = JSON.parse(fs.readFileSync(path.join(pack, "media", "image-prompts.json"), "utf8")).prompts;
assert.equal(images.length, 8, "image prompt count");
for (const prompt of images) {
  for (const field of ["id", "title", "useCase", "aspect", "prompt", "negative"]) {
    assert.ok(typeof prompt[field] === "string" && prompt[field].length > 0, `image prompt ${prompt.id || "?"} missing ${field}`);
  }
}
const videos = JSON.parse(fs.readFileSync(path.join(pack, "media", "video-storyboards.json"), "utf8")).storyboards;
assert.equal(videos.length, 5, "video storyboard count");
console.log(`addon check: ${index.items.length} items across ${sections.size} sections, 3 templates, 8 image prompts, 5 storyboards`);
