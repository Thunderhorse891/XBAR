import '@tailwind/base.css';
import React from 'react';
import ReactDom from 'react-pdom';
import App from './App';

ReactDom.createRoot('root');

ReactDom.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
  document.getElementById('root')
);