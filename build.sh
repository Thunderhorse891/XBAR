#!/bin/bash
set -e

echo "🚀 Building XBAR web application..."

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

if [ ! -f "package.json" ]; then
  echo -e "${RED}❌ package.json not found.${NC}"
  exit 1
fi

echo -e "${CYAN}📦 Installing dependencies...${NC}"
npm install

echo -e "${CYAN}🌐 Building web assets with Vite...${NC}"
npm run build

if [ $? -eq 0 ]; then
  echo -e "${GREEN}✅ Build completed successfully!${NC}"
  echo -e "${GREEN}📁 Web bundle: dist/${NC}"
  echo -e "${YELLOW}📱 Run npm run mobile:sync after adding iOS or Android targets.${NC}"
else
  echo -e "${RED}❌ Web build failed!${NC}"
  exit 1
fi
