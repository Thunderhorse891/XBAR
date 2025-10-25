#!/bin/bash
set -e  # Exit immediately on any error

echo "🚀 Building XBAR Horse Tracker Desktop Application..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Check if we're in the right directory
if [ ! -d "src-tauri" ]; then
    echo -e "${RED}❌ Tauri directory not found.${NC}"
    echo -e "${YELLOW}💡 Make sure you're in the project root directory.${NC}"
    exit 1
fi

# Check if package.json exists
if [ ! -f "package.json" ]; then
    echo -e "${RED}❌ package.json not found.${NC}"
    exit 1
fi

echo -e "${CYAN}📦 Building web assets with Vite...${NC}"
npm run build

# Check if web build succeeded
if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Web build failed!${NC}"
    exit 1
fi

echo -e "${CYAN}🖥️  Building desktop application with Tauri...${NC}"
npm run tauri build

# Check if Tauri build succeeded
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Build completed successfully!${NC}"
    echo -e "${GREEN}📁 Installer location: src-tauri/target/release/bundle/${NC}"
else
    echo -e "${RED}❌ Tauri build failed!${NC}"
    exit 1
fi
