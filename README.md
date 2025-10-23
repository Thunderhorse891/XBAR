# XBar Horse Management App

A tailwind-based React Ts web and tauri desktop application for horse management.

\n## Features

\n- Horses database with name, color, birth date, status, gender
- Interactive tables and cards view
- Search, edit, and export to csv
- Onboard horses from Torch App
- Cross-platform deployment via Tauri

## Setup

Requires Tauri, Vite, Node.js, and Netlify v2:

```
npm i
npm run prisma seed
vite build 

npm run tauri dev

```

Verify tauri opens with:

```
nux run tauri open
```