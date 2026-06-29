#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'assets', 'readme');
const SOURCE = path.join(OUT, 'source');
const WIDTH = 2560;
const HEIGHT = 1440;
const LANGS = ['en', 'zh-CN'];

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function fail(message) {
  console.error(`readme-diagram-verification failed: ${message}`);
  process.exit(1);
}

function assertFile(file) {
  if (!fs.existsSync(file)) fail(`missing file: ${path.relative(ROOT, file)}`);
}

function pngSize(file) {
  const buffer = fs.readFileSync(file);
  const signature = buffer.subarray(0, 8).toString('hex');
  if (signature !== '89504e470d0a1a0a') fail(`not a png: ${path.relative(ROOT, file)}`);
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  };
}

function stripLabels(svg) {
  return svg
    .replace(/\n?<g id="labels">[\s\S]*?<\/g>\s*/, '')
    .replace(/\s*<\/svg>\s*$/, '\n</svg>\n');
}

function listDiagramIds() {
  assertFile(SOURCE);
  return fs.readdirSync(SOURCE)
    .filter((name) => name.endsWith('.en.svg'))
    .map((name) => name.replace(/\.en\.svg$/, ''))
    .sort();
}

function verify() {
  const ids = listDiagramIds();
  if (ids.length !== 8) fail(`expected 8 diagrams, found ${ids.length}`);

  for (const id of ids) {
    const base = path.join(SOURCE, `${id}.base.svg`);
    assertFile(base);
    const baseHash = sha256(stripLabels(fs.readFileSync(base, 'utf8')));
    const structureHashes = [];

    for (const lang of LANGS) {
      const svg = path.join(SOURCE, `${id}.${lang}.svg`);
      const png = path.join(OUT, lang, `${id}.png`);
      assertFile(svg);
      assertFile(png);

      const size = pngSize(png);
      if (size.width !== WIDTH || size.height !== HEIGHT) {
        fail(`${path.relative(ROOT, png)} is ${size.width}x${size.height}, expected ${WIDTH}x${HEIGHT}`);
      }

      const stripped = stripLabels(fs.readFileSync(svg, 'utf8'));
      const structureHash = sha256(stripped);
      if (structureHash !== baseHash) {
        fail(`${path.relative(ROOT, svg)} does not match its text-free base SVG`);
      }
      structureHashes.push(structureHash);
    }

    if (new Set(structureHashes).size !== 1) {
      fail(`localized structures differ after stripping labels: ${id}`);
    }

    const defaultPng = path.join(OUT, `${id}.png`);
    assertFile(defaultPng);
    const defaultHash = sha256(fs.readFileSync(defaultPng));
    const zhHash = sha256(fs.readFileSync(path.join(OUT, 'zh-CN', `${id}.png`)));
    if (defaultHash !== zhHash) {
      fail(`default README asset must mirror zh-CN asset: ${id}`);
    }
  }

  console.log(`verified ${ids.length} bilingual README diagrams: shared structure, localized text, ${WIDTH}x${HEIGHT} PNGs`);
}

verify();
