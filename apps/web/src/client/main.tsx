import React from 'react';
import ReactDOM from 'react-dom/client';
import '@kurzagin/ui/styles.css';
import './style.css';
import App from './App';
import faviconUrl from '@kurzagin/ui/assets/favicon.png';

// Dynamically bind the favicon from @kurzagin/ui package assets
const link = document.querySelector<HTMLLinkElement>("link[rel~='icon']") || document.createElement('link');
link.type = 'image/png';
link.rel = 'icon';
link.href = faviconUrl;
document.head.appendChild(link);

const rootElement = document.getElementById('root');
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
