#!/bin/bash
echo "Building [HORSE] application..."

if ![ -d "src-tauri" ]; then
  echo "Tauri not found. Storping build."
  exit 1
fi
echo "Running build with Vite..."
npm run build
echo "Finished build."