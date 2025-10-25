name: Trigger Tauri Build

on:
  push:
    branches: [ main ]
  pull_request:
    branches: [ main ]
  workflow_dispatch:

jobs:
  build:
    runs-on: windows-latest
    
    steps:
    - name: Checkout code
      uses: actions/checkout@v4
      
    - name: Setup Node.js
      uses: actions/setup-node@v4
      with:
        node-version: '18'
        
    - name: Install Rust
      uses: dtolnay/rust-toolchain@stable
      with:
        toolchain: stable
        
    - name: Install pnpm
      run: npm install -g pnpm
      
    - name: Install dependencies
      run: pnpm install
      
    - name: Install Tauri CLI
      run: cargo install tauri-cli
      
    - name: Build Tauri Application
      run: cargo tauri build
      
    - name: Upload Windows Installer
      uses: actions/upload-artifact@v4
      with:
        name: xbar-horse-installer
        path: src-tauri/target/release/bundle/nsis/*.exe
