#!/usr/bin/env node
// Verify the Storybook subtree shipped with the documentation, including subpath-safe entry assets.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseHTML } from 'linkedom'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const artifact = path.join(root, 'docs/.vitepress/dist')
const dist = path.join(artifact, 'storybook')
const inside = (base, target) => {
  const relative = path.relative(base, target)
  return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)
}
const distReal = fs.realpathSync(dist)
assert(inside(fs.realpathSync(artifact), distReal), 'Storybook must belong to the shipped documentation artifact')
const isArtifactFile = (file) => {
  if (!inside(dist, file)) return false
  try {
    return fs.statSync(file).isFile() && inside(distReal, fs.realpathSync(file))
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false
    throw error
  }
}
assert(isArtifactFile(path.join(dist, 'index.json')), 'Story index must belong to the shipped Storybook artifact')
const index = JSON.parse(fs.readFileSync(path.join(dist, 'index.json'), 'utf8'))
const entries = Object.values(index.entries)
assert(index.entries['foundations-colors--docs']?.type === 'docs', 'The documentation entry link must resolve to the colors docs')
const titles = ['Overview/Introduction', 'Foundations/Colors', 'Foundations/Typography', 'Foundations/Surfaces', 'UI/Select', 'UI/FeatureEnableCard', 'UI/DownloadProgress', 'UI/ServiceIcon', 'UI/UiIcon', 'UI/TranslationLoading', 'UI/Controls', 'Examples/Settings']
for (const title of titles) {
  assert(entries.some((entry) => entry.title === title && entry.type === 'story'), `Missing stories: ${title}`)
  assert(entries.some((entry) => entry.title === title && entry.type === 'docs'), `Missing component documentation: ${title}`)
}
let assets = 0
for (const file of ['index.html', 'iframe.html']) {
  assert(isArtifactFile(path.join(dist, file)), `HTML must belong to the shipped Storybook artifact: ${file}`)
  const document = parseHTML(fs.readFileSync(path.join(dist, file), 'utf8')).document
  for (const element of document.querySelectorAll('script[src],link[href]')) {
    const url = element.getAttribute('src') || element.getAttribute('href')
    if (!url || /^(?:https?:|data:|#)/.test(url)) continue
    assert(!url.startsWith('/'), `Asset must work under /storybook/: ${url}`)
    const target = path.resolve(dist, url.split(/[?#]/)[0])
    assert(isArtifactFile(target), `Missing entry asset in shipped Storybook artifact: ${url}`)
    assets++
  }
}
console.log(JSON.stringify({ groups: titles.length, stories: entries.filter((entry) => entry.type === 'story').length, docs: entries.filter((entry) => entry.type === 'docs').length, assets }, null, 2))
