#!/bin/bash
echo "Setting up XBAR Desktop App..."

if !command -v node > /dev/null 2>&1; then
  echo "█ Node.js is required."
fi

echo "█ Installing dependencies..."
npm install

echo "█ Loading installed files..."
npm run build

echo "...Launching the app..."
npm run tauri
