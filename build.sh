#!/bin/bash
echo "Building XBAR Horse Tracker application..."

if [ ! -d "src-tauri" ]; then
  echo "Tauri not found. Stopping build."
  exit 1
fi

echo "Running build with Vite..."
npm run build

echo "Building Tauri desktop app..."
npm run tauri build

echo "Build finished successfully!"
