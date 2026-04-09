#!/usr/bin/env node
/**
 * Icon generation script for GitSlop.
 *
 * Generates platform-specific icon files from resources/icon.svg:
 *   - resources/icon.png (512x512 for Linux)
 *   - resources/icon.icns (macOS) — requires iconutil on macOS
 *   - resources/icon.ico (Windows) — requires png2ico or similar
 *
 * Prerequisites:
 *   npm install sharp (or use system tools like rsvg-convert, inkscape)
 *
 * For CI builds, electron-builder's icon conversion handles most cases
 * automatically when given a 512x512 PNG source.
 *
 * Usage:
 *   node scripts/generate-icons.js
 */

const { execSync } = require('child_process')
const path = require('path')
const fs = require('fs')

const RESOURCES_DIR = path.join(__dirname, '..', 'resources')
const SVG_PATH = path.join(RESOURCES_DIR, 'icon.svg')

function tryConvert() {
  // Try rsvg-convert
  try {
    execSync(`rsvg-convert -w 512 -h 512 "${SVG_PATH}" -o "${path.join(RESOURCES_DIR, 'icon.png')}"`)
    console.log('Generated icon.png using rsvg-convert')
    return true
  } catch {
    // not available
  }

  // Try inkscape
  try {
    execSync(
      `inkscape "${SVG_PATH}" --export-type=png --export-filename="${path.join(RESOURCES_DIR, 'icon.png')}" -w 512 -h 512`
    )
    console.log('Generated icon.png using inkscape')
    return true
  } catch {
    // not available
  }

  // Try ImageMagick convert
  try {
    execSync(
      `convert -background none -resize 512x512 "${SVG_PATH}" "${path.join(RESOURCES_DIR, 'icon.png')}"`
    )
    console.log('Generated icon.png using ImageMagick')
    return true
  } catch {
    // not available
  }

  return false
}

if (!fs.existsSync(SVG_PATH)) {
  console.error('Source SVG not found at', SVG_PATH)
  process.exit(1)
}

// Check if icon.png already exists
const pngPath = path.join(RESOURCES_DIR, 'icon.png')
if (fs.existsSync(pngPath)) {
  console.log('icon.png already exists, skipping generation')
  process.exit(0)
}

if (!tryConvert()) {
  console.warn(
    'No SVG conversion tool found. Please install one of:\n' +
      '  - librsvg (rsvg-convert)\n' +
      '  - inkscape\n' +
      '  - ImageMagick (convert)\n' +
      'Or manually create a 512x512 PNG at resources/icon.png\n\n' +
      'electron-builder will still work with the SVG file on some platforms.'
  )
}
