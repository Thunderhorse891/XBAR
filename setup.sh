#!/bin/bash
set -e

echo "Setting up XBAR web + mobile app..."

if !command -v node >/dev/null 2>&1; then
  echo "Node.js is required."
  exit 1
fi

echo "Installing dependencies..."
npm install

echo "Launching the web app..."
npm run dev
